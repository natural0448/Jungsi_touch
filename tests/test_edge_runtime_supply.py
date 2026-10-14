"""Pinned supply must retain old/failed artifacts and refuse unsafe binaries."""
import copy
import hashlib
import io
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
from uuid import uuid4
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import bootstrap_edge_runtime as supply


class EdgeRuntimeSupplyTests(unittest.TestCase):
    def setUp(self):
        self.root = ROOT / "outputs/edge_runtime_supply_tests" / uuid4().hex
        self.root.mkdir(parents=True, exist_ok=False)
        self.lock = json.loads((ROOT / "edge-runtime.lock.json").read_text(encoding="utf-8"))
        self.payload = self.archive([("deno", b"SYNTHETIC-BINARY-NOT-EXECUTABLE")])
        self.lock["assets"]["linux"].update(bytes=len(self.payload),
            sha256=hashlib.sha256(self.payload).hexdigest())
        self.calls = []

    def archive(self, rows):
        target = io.BytesIO()
        with zipfile.ZipFile(target, "w") as zipped:
            for name, body in rows:
                zipped.writestr(name, body)
        return target.getvalue()

    def run_supply(self, *, payload=None, destination=None, lock=None, probe=None):
        path = self.root / ("lock_" + uuid4().hex + ".json")
        path.write_text(json.dumps(lock or self.lock), encoding="utf-8")
        def download(url, limit):
            self.calls.append((url, limit))
            return self.payload if payload is None else payload
        return supply.bootstrap(destination or self.root / "runtime", path, system="linux",
            machine="x86_64", downloader=download,
            version_probe=probe or (lambda exe, dest: supply.VERSION))

    def test_fresh_supply_binds_archive_and_binary_without_suite_claim(self):
        executable = self.run_supply()
        receipt = json.loads((executable.parent.parent / "receipt.json").read_text())
        self.assertEqual(executable.read_bytes(), b"SYNTHETIC-BINARY-NOT-EXECUTABLE")
        self.assertEqual(receipt["archive"]["sha256"], hashlib.sha256(self.payload).hexdigest())
        self.assertEqual(receipt["executable"]["sha256"], hashlib.sha256(executable.read_bytes()).hexdigest())
        self.assertEqual(receipt["status"], "PINNED_RUNTIME_SUPPLIED_NOT_SUITE_PROOF")
        self.assertFalse(receipt["cleanup"])

    def test_existing_destination_is_preserved_without_download(self):
        destination = self.root / "runtime"
        destination.mkdir()
        sentinel = destination / "retained.txt"
        sentinel.write_text("SYNTHETIC-PRESERVE", encoding="utf-8")
        with self.assertRaises(FileExistsError):
            self.run_supply(destination=destination)
        self.assertEqual(sentinel.read_text(), "SYNTHETIC-PRESERVE")
        self.assertEqual(self.calls, [])

    def test_hash_mismatch_preserves_archive_and_never_probes(self):
        probe_calls = []
        with self.assertRaisesRegex(ValueError, "hash or size"):
            self.run_supply(payload=b"SYNTHETIC-TAMPERED", probe=lambda *args: probe_calls.append(args))
        self.assertEqual(probe_calls, [])
        self.assertEqual((self.root / "runtime" / self.lock["assets"]["linux"]["filename"]).read_bytes(),
                         b"SYNTHETIC-TAMPERED")
        self.assertFalse((self.root / "runtime/bin").exists())

    def test_wrong_size_fails_even_when_hash_matches(self):
        lock = copy.deepcopy(self.lock)
        lock["assets"]["linux"]["bytes"] += 1
        with self.assertRaisesRegex(ValueError, "hash or size"):
            self.run_supply(lock=lock)

    def test_untrusted_url_and_changed_version_fail_before_destination(self):
        for key, value in [("url", "https://SYNTHETIC.invalid/deno.zip"),
                           ("version", "2.9.8")]:
            with self.subTest(key=key):
                lock = copy.deepcopy(self.lock)
                (lock if key == "version" else lock["assets"]["linux"])[key] = value
                with self.assertRaises(ValueError):
                    self.run_supply(lock=lock)
        self.assertEqual(self.calls, [])
        self.assertFalse((self.root / "runtime").exists())

    def test_zip_extra_member_and_traversal_never_extract(self):
        for rows in [[("deno", b"synthetic"), ("extra", b"synthetic")],
                     [("../deno", b"synthetic")]]:
            with self.subTest(rows=rows):
                payload = self.archive(rows)
                lock = copy.deepcopy(self.lock)
                lock["assets"]["linux"].update(bytes=len(payload), sha256=hashlib.sha256(payload).hexdigest())
                destination = self.root / uuid4().hex
                with self.assertRaisesRegex(ValueError, "regular pinned executable"):
                    self.run_supply(payload=payload, lock=lock, destination=destination)
                self.assertFalse((destination / "bin").exists())
                self.assertTrue((destination / lock["assets"]["linux"]["filename"]).exists())

    def test_linked_ancestor_is_rejected_before_download(self):
        with patch.object(Path, "is_symlink", lambda p: p == self.root):
            with self.assertRaisesRegex(ValueError, "traverse a link"):
                self.run_supply()
        self.assertEqual(self.calls, [])

    def test_probe_mismatch_keeps_binary_and_cannot_create_receipt(self):
        def wrong(executable, destination):
            raise RuntimeError("Pinned Deno version or target mismatch")
        with self.assertRaises(RuntimeError):
            self.run_supply(probe=wrong)
        self.assertTrue((self.root / "runtime/bin/deno").exists())
        self.assertFalse((self.root / "runtime/receipt.json").exists())

    def test_version_probe_has_no_inherited_credentials_or_update_check(self):
        result = type("Result", (), {"returncode": 0,
            "stdout": "deno 2.9.7 (stable, release, x86_64-unknown-linux-gnu)\nv8 synthetic\n"})()
        with patch.dict(supply.os.environ, {"SYNTHETIC_SECRET": "never-in-child", "GITHUB_TOKEN": "never-in-child"}), \
                patch.object(supply.subprocess, "run", return_value=result) as run:
            supply.probe_version(self.root / "bin/deno", self.root)
        environment = run.call_args.kwargs["env"]
        self.assertNotIn("SYNTHETIC_SECRET", environment)
        self.assertNotIn("GITHUB_TOKEN", environment)
        self.assertEqual(environment["DENO_NO_UPDATE_CHECK"], "1")


if __name__ == "__main__":
    unittest.main()
