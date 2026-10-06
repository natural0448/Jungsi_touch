"""Isolated private-artifact transport fixtures; no cloud/data adoption."""
from copy import deepcopy
from hashlib import sha256
from io import BytesIO
import json
import unittest
from urllib.error import HTTPError

from jungsi_touch.application.platform_ports import PlatformError
from jungsi_touch.infrastructure.supabase_storage import (
    MAX_ARTIFACT_BYTES, SupabaseStorageClient, SupabaseStorageDataProvider, _NoRedirect,
)


URL='https://synthetic-project.supabase.co'
KEY='sb_secret_'+'SYNTHETIC_NOT_A_REAL_KEY'
BUCKET='synthetic-private'
PAYLOAD=json.dumps({'version':'synthetic-v1','format':'jungsi.catalog-release/v1',
                    'status':'approved','as_of':'2026-10-01T00:00:00Z','offerings':[]}).encode()
ENTRY={'kind':'catalog','key':'service','version':'synthetic-v1','sha256':sha256(PAYLOAD).hexdigest(),
       'status':'approved','engine_approved':True,'production_allowed':True,'bucket':BUCKET,
       'object_key':'staged/synthetic/catalog.json','bytes':len(PAYLOAD),'archive_only':False}


class Response(BytesIO):
    def __init__(self,content,url,status=200):super().__init__(content);self.url=url;self.status=status
    def geturl(self):return self.url


class Transport:
    def __init__(self):
        self.requests=[];self.content=PAYLOAD;self.final_url=None;self.status=200
        self.bucket={'id':BUCKET,'public':False,'file_size_limit':50*1024*1024}
        self.failure=False
    def __call__(self,request,**options):
        self.requests.append(request)
        if self.failure:raise OSError('SYNTHETIC private secret or object path')
        content=json.dumps(self.bucket).encode() if '/bucket/' in request.full_url else self.content
        return Response(content,self.final_url or request.full_url,self.status)


class StorageAdapterTests(unittest.TestCase):
    def setUp(self):
        self.transport=Transport()
        self.client=SupabaseStorageClient(URL,KEY,BUCKET,object_prefix='staged/synthetic/',opener=self.transport)
        self.entry=deepcopy(ENTRY)

    def provider(self):
        return SupabaseStorageDataProvider(self.client,{'format':'jungsi.data-registry/v1','entries':[self.entry]})

    def test_explicit_provider_preserves_catalog_port_and_pinned_release(self):
        catalog=self.provider().get_catalog()
        self.assertEqual(catalog.version,'synthetic-v1');self.assertEqual(catalog.offerings,())
        self.assertEqual(len(self.transport.requests),2)
        for request in self.transport.requests:
            self.assertEqual(request.get_method(),'GET')
            self.assertEqual(request.get_header('Apikey'),KEY)
            self.assertIsNone(request.get_header('Authorization'))
            self.assertIsNone(request.data)
            self.assertNotIn('/public/',request.full_url)

    def test_staging_and_missing_or_false_approval_flags_never_download(self):
        for field,value in (('status','staged'),('engine_approved',False),('production_allowed',False),
                            ('engine_approved',1),('production_allowed','true')):
            self.entry=deepcopy(ENTRY);self.entry[field]=value
            with self.subTest(field=field,value=value),self.assertRaises(PlatformError) as caught:self.provider().get_catalog()
            self.assertEqual(caught.exception.code,'artifact_not_approved')
        self.assertEqual(self.transport.requests,[])

    def test_missing_approval_flags_never_download(self):
        for field in ('engine_approved','production_allowed'):
            self.entry=deepcopy(ENTRY);self.entry.pop(field)
            with self.assertRaises(PlatformError) as caught:self.provider().get_catalog()
            self.assertEqual(caught.exception.code,'artifact_not_approved')
        self.assertEqual(self.transport.requests,[])

    def test_archive_and_reader_limit_are_separate_from_bucket_limit(self):
        for patch,code in (({'archive_only':True},'storage_archive_only'),
                           ({'bytes':MAX_ARTIFACT_BYTES+1},'storage_artifact_too_large')):
            self.entry=deepcopy(ENTRY);self.entry.update(patch)
            with self.assertRaises(PlatformError) as caught:self.provider().get_catalog()
            self.assertEqual(caught.exception.code,code)
        self.assertEqual(self.transport.requests,[])

    def test_provided_archive_flag_is_exact_boolean_false(self):
        for value in (None,0,1,'false','true'):
            self.entry=deepcopy(ENTRY);self.entry['archive_only']=value
            with self.subTest(value=value),self.assertRaises(PlatformError) as caught:self.provider().get_catalog()
            self.assertEqual(caught.exception.code,'storage_reference_invalid')
        self.assertEqual(self.transport.requests,[])

    def test_missing_archive_flag_cannot_implicitly_authorize_runtime(self):
        self.entry.pop('archive_only')
        with self.assertRaises(PlatformError) as caught:self.provider().get_catalog()
        self.assertEqual(caught.exception.code,'storage_reference_invalid')
        self.assertEqual(self.transport.requests,[])

    def test_scope_path_traversal_and_legacy_drive_reference_rejected(self):
        for patch in ({'bucket':'other'},{'object_key':'other/catalog.json'},{'object_key':'staged/synthetic/../x'},
                      {'object_key':'staged/synthetic/%2e%2e/x'},{'object_key':'staged/synthetic//x'},
                      {'object_key':'staged/synthetic/\\x'}):
            self.entry=deepcopy(ENTRY);self.entry.update(patch)
            with self.assertRaises(PlatformError):self.provider()
        self.entry=deepcopy(ENTRY);self.entry.pop('object_key');self.entry['file_id']='SYNTHETIC'
        with self.assertRaises(PlatformError):self.provider()
        self.assertEqual(self.transport.requests,[])

    def test_positive_integer_size_and_hash_contract(self):
        for patch in ({'bytes':True},{'bytes':0},{'bytes':'10'},{'sha256':'not-a-sha256'}):
            self.entry=deepcopy(ENTRY);self.entry.update(patch)
            with self.assertRaises((PlatformError,ValueError)):self.provider()
        self.assertEqual(self.transport.requests,[])

    def test_bucket_must_be_explicitly_private_and_size_bounded(self):
        for patch in ({'public':True},{'public':None},{'id':'other'},{'file_size_limit':None},
                      {'file_size_limit':True},{'file_size_limit':50*1024*1024+1},
                      {'file_size_limit':len(PAYLOAD)-1}):
            self.transport.bucket={'id':BUCKET,'public':False,'file_size_limit':50*1024*1024}
            self.transport.bucket.update(patch);self.transport.requests=[]
            with self.subTest(patch=patch),self.assertRaises(PlatformError):self.provider().get_catalog()
            self.assertEqual(len(self.transport.requests),1)

    def test_hash_short_read_and_extra_byte_are_rejected(self):
        for content,code in ((PAYLOAD.replace(b'approved',b'replaced'),'storage_hash_mismatch'),
                             (PAYLOAD[:-1],'storage_size_mismatch'),
                             (PAYLOAD+b' ','storage_artifact_too_large')):
            self.transport.content=content
            with self.assertRaises(PlatformError) as caught:self.provider().get_catalog()
            self.assertEqual(caught.exception.code,code)

    def test_payload_version_and_json_structure_are_checked(self):
        for payload,code in ((b'{"version":"other"}','artifact_version_mismatch'),
                             (b'{"version":"synthetic-v1","version":"other"}','storage_artifact_invalid'),
                             (b'{"version":NaN}','storage_artifact_invalid'),(b'[]','storage_artifact_invalid')):
            self.transport.content=payload;self.entry.update(bytes=len(payload),sha256=sha256(payload).hexdigest())
            with self.assertRaises(PlatformError) as caught:self.provider().get_catalog()
            self.assertEqual(caught.exception.code,code)

    def test_no_missing_reference_adoption_or_latest_download(self):
        provider=SupabaseStorageDataProvider(self.client,{'format':'jungsi.data-registry/v1','entries':[]})
        self.assertIsNone(provider.get_catalog());self.assertEqual(self.transport.requests,[])

    def test_redirect_and_remote_error_are_safe(self):
        for final,status,failure in (('https://other.invalid',200,False),(None,302,False),(None,200,True)):
            self.transport.final_url=final;self.transport.status=status;self.transport.failure=failure
            with self.assertRaises(PlatformError) as caught:self.provider().get_catalog()
            self.assertEqual(str(caught.exception),'storage_unavailable')
            self.assertNotIn(KEY,str(caught.exception));self.assertNotIn('staged/',str(caught.exception))
        from urllib.request import Request
        with self.assertRaises(HTTPError):
            _NoRedirect().redirect_request(Request(URL),None,302,'redirect',{},'https://other.invalid')

    def test_configuration_rejects_non_server_key_and_untrusted_origin(self):
        for url,key,prefix in ((URL,'sb_publishable_'+'SYNTHETIC','staged/synthetic/'),
                               ('http://synthetic-project.supabase.co',KEY,'staged/synthetic/'),
                               (URL+'/path',KEY,'staged/synthetic/'),(URL,KEY,'')):
            with self.assertRaises(PlatformError):SupabaseStorageClient(url,key,BUCKET,object_prefix=prefix)
