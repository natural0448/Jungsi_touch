"""Private files implement application ports. Exclusive creation preserves history."""
from dataclasses import fields
from hashlib import sha256
import json
from pathlib import Path
from ..application.estimated_population import EstimationInputs
from ..estimated_profiles import require
from ..application.overall_analysis import _identifier


def private_path(path):
    p=Path(path).resolve()
    # A checkout copied below outputs is still a public-code boundary. Inspect
    # only the path beneath the closest declared checkout, never its ancestors.
    root=next((parent for parent in (p,*p.parents)
        if (parent/'AGENTS.md').is_file() and
           (parent/'docs/current/service_spec.json').is_file()),None)
    require(root is not None,'estimation_private_location_required')
    require(any(v.lower() in ('resource','data','datas','outputs')
        for v in p.relative_to(root).parts),'estimation_private_location_required')
    return p


def bytes_json(payload):
    return json.dumps(payload,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False).encode('utf-8')


class PrivateJsonEstimationInputs:
    def __init__(self,manifest_path):
        self.path=private_path(manifest_path)

    def get_estimation_inputs(self,version):
        manifest=json.loads(self.path.read_text(encoding='utf-8'))
        require(manifest['format']=='jungsi.estimate-inputs/v1' and manifest['version']==version,'estimation_input_version_mismatch')
        values={}
        for key,entry in manifest['artifacts'].items():
            require(key in {f.name for f in fields(EstimationInputs)},'unknown_estimation_input')
            path=private_path(self.path.parent/entry['path'])
            raw=path.read_bytes();require(sha256(raw).hexdigest()==entry['sha256'],'estimation_input_hash_mismatch')
            values[key]=json.loads(raw)
        for key in ('scenarios','independent_references','universities'):
            if key in values:values[key]=tuple(values[key])
        return EstimationInputs(**values)


class PrivateJsonEstimationStore:
    def __init__(self,root):
        self.root=private_path(root)

    def begin(self,run_id,manifest):
        require(_identifier(run_id),'invalid_estimation_run')
        path=self.root/run_id;path.mkdir(parents=True,exist_ok=True)
        self.append(run_id,'frozen_inputs.json',manifest)

    def append(self,run_id,name,payload):
        require(_identifier(run_id) and _identifier(name) and name.endswith('.json'),'invalid_estimation_artifact_name')
        path=self.root/run_id/name
        raw=bytes_json(payload)
        with path.open('xb') as handle:handle.write(raw)
        return dict(name=name,sha256=sha256(raw).hexdigest(),bytes=len(raw))


class PrivateJsonEstimateApproval:
    def __init__(self,path,expected_sha256):
        self.path=private_path(path);self.expected=expected_sha256

    def get_estimate_approval(self,run_id):
        raw=self.path.read_bytes()
        require(sha256(raw).hexdigest()==self.expected,'estimate_approval_hash_mismatch')
        data=json.loads(raw)
        require(data['format']=='jungsi.estimate-approval/v1','estimate_approval_format_invalid')
        return data if data.get('run_id')==run_id else None
