"""Synthetic FastAPI service-end tests. No real accounts, DB, Storage or remote network."""
import asyncio
import json
import os
import selectors
import socket
import sys
import time
import unittest
from asyncio import selector_events
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

SOURCE=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(SOURCE/"src"))
sys.path.insert(0,str(SOURCE/"tests"))
SOCKETLESS=(os.name=="nt" and os.environ.get("JUNGSI_SYNTHETIC_SOCKETLESS")=="1")
_LOOP_STATE=None
def _restore_loop_state():
 global _LOOP_STATE
 if _LOOP_STATE is None:
  return
 previous=_LOOP_STATE
 selector_events.BaseSelectorEventLoop._make_self_pipe=previous[1]
 selector_events.BaseSelectorEventLoop._close_self_pipe=previous[2]
 selector_events.BaseSelectorEventLoop._write_to_self=previous[3]
 selectors.SelectSelector.select=previous[4]
 asyncio.set_event_loop_policy(previous[0])
 _LOOP_STATE=None

def setUpModule():
 global _LOOP_STATE
 if not SOCKETLESS:
  return
 _LOOP_STATE=(asyncio.get_event_loop_policy(),selector_events.BaseSelectorEventLoop._make_self_pipe,
  selector_events.BaseSelectorEventLoop._close_self_pipe,selector_events.BaseSelectorEventLoop._write_to_self,
  selectors.SelectSelector.select)
 try:
  asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
  selector_events.BaseSelectorEventLoop._make_self_pipe=lambda self:None
  selector_events.BaseSelectorEventLoop._close_self_pipe=lambda self:None
  selector_events.BaseSelectorEventLoop._write_to_self=lambda self:None
  original_select=_LOOP_STATE[4]
  def local_poll(self,timeout=None):
   if not self.get_map():
    time.sleep(min(timeout,0.001) if timeout is not None else 0.001)
    return []
   return original_select(self,timeout)
  selectors.SelectSelector.select=local_poll
 except BaseException:
  _restore_loop_state()
  raise

def tearDownModule():
 _restore_loop_state()

from fastapi.testclient import TestClient
from backend_synthetic_fixture import SyntheticRepository, SyntheticSessions, SyntheticData, score_input
from jungsi_touch.application import service_end_admission as policy
from jungsi_touch.application.platform_ports import PlatformError
from jungsi_touch.infrastructure import http_api as http
from jungsi_touch.infrastructure import secured_http as secured
from jungsi_touch.infrastructure import supabase_runtime as supabase
from jungsi_touch.infrastructure import official_history_display as official
from jungsi_touch.infrastructure import local_verification as local
from jungsi_touch.infrastructure.drive_provider import MissingDataProvider
from jungsi_touch.infrastructure.settings import ServerSettings
from jungsi_touch.infrastructure.secured_http import SecuritySettings as OriginalSecurity
from jungsi_touch.infrastructure.supabase_storage import SupabaseStorageClient, SupabaseStorageDataProvider

TOKEN="SYNTHETIC-relay-only-"+"x"*40
END=datetime(2027,1,7,15,0,tzinfo=timezone.utc)

class Clock:
 def __init__(self,value):self.value=value
 def now(self):return self.value
class Repository(SyntheticRepository):
 def __init__(self):super().__init__();self.probes=0
 def probe(self):self.probes+=1;return {"status":"verified"}
class Sessions(SyntheticSessions):
 def __init__(self,clock):super().__init__(clock);self.calls=0;self.cross=False
 def verify(self,token,now):
  self.calls+=1
  if self.cross:self.clock.value=END+timedelta(microseconds=1)
  return super().verify(token,now)

def components(value,allowed=()):
 clock=Clock(value);repo=Repository();sessions=Sessions(clock)
 settings=ServerSettings(database_url="SYNTHETIC",allowed_origins=tuple(allowed))
 return clock,repo,sessions,settings

def create(which,value,allowed=(),mode="legacy_synthetic"):
 clock,repo,sessions,settings=components(value,allowed)
 shared=dict(settings=settings,repository=repo,sessions=sessions,clock=clock,operating_mode=mode)
 if which=="open":
  app=http.create_app(data=MissingDataProvider(),**shared)
 elif which=="secured":
  app=secured.create_secured_app(security=secured.SecuritySettings(TOKEN),data=MissingDataProvider(),**shared)
 elif which=="supabase":
  data=object.__new__(SupabaseStorageDataProvider)
  data.client=object.__new__(SupabaseStorageClient)
  selection=supabase.RuntimeArtifactSelection((("catalog","SYNTHETIC-reference"),))
  app=supabase.create_supabase_secured_app(security=OriginalSecurity(TOKEN),data=data,selection=selection,**shared)
 else:raise AssertionError("unknown synthetic factory")
 return app,clock,repo,sessions

def request(client,path="/api/v1/me",relay=True,origin=None,auth=True,method="GET"):
 headers={}
 if relay:headers["X-Jungsi-Relay-Token"]=TOKEN
 if origin:headers["Origin"]=origin
 if auth:headers["Authorization"]="Bearer SYNTHETIC-user"
 return client.request(method,path,headers=headers)

class PythonDeadlineTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.network=patch.object(socket,"create_connection",side_effect=AssertionError("synthetic network denied"))
  cls.network.start()
  cls.direct_socket=None
  if SOCKETLESS:
   try:
    cls.direct_socket=patch.object(socket.socket,"connect",side_effect=AssertionError("synthetic network denied"))
    cls.direct_socket.start()
   except BaseException:
    cls.network.stop()
    raise
 @classmethod
 def tearDownClass(cls):
  if cls.direct_socket is not None:cls.direct_socket.stop()
  cls.network.stop()

 def test_policy_half_open_timezone_and_invalid_clock(self):
  policy.assert_service_admission(END-timedelta(microseconds=1))
  with self.assertRaises(PlatformError) as e:policy.assert_service_admission(END)
  self.assertEqual((e.exception.code,e.exception.http_status),("service_ended",403))
  with self.assertRaises(PlatformError) as e:policy.assert_service_admission(datetime(2027,1,8,0,0,tzinfo=timezone(timedelta(hours=9))))
  self.assertEqual(e.exception.code,"service_ended")
  for value in [None,datetime(2027,1,7,15),-1]:
   with self.assertRaises(PlatformError) as e:policy.assert_service_admission(value)
   self.assertEqual(e.exception.http_status,503)

 def test_all_registered_python_routes_block_before_user_and_work(self):
  catalog=json.loads((SOURCE/"src/jungsi_touch/application/route_catalog.json").read_bytes())["operations"]
  excluded={"history.snapshot.head","history.snapshot.read","report.list-own","member-shortlist.read","member-shortlist.update",
            "score-input.status.read","score-input.correction.grant","report.sample.read"}
  selected=[o for o in catalog if o["id"] not in excluded]
  self.assertEqual(len(selected),22)
  for factory in ["open","secured","supabase"]:
   app,clock,repo,sessions=create(factory,END)
   with TestClient(app) as c:
    for op in selected:
     path=op["path"]
     import re
     path=re.sub(r"\{[^}]+\}","SYNTHETIC-id",path)
     result=request(c,path,method=op["method"])
     self.assertEqual((result.status_code,result.json()["error"]["code"]),(403,"service_ended"),factory+" "+op["id"])
    self.assertEqual(sessions.calls,0);self.assertEqual(repo.access_calls,[]);self.assertEqual(repo.probes,0)

 def test_secured_and_supabase_relay_before_end_and_open_has_no_relay(self):
  for factory in ["secured","supabase"]:
   app,clock,repo,sessions=create(factory,END)
   with TestClient(app) as c:
    r=request(c,relay=False)
    self.assertEqual((r.status_code,r.json()["error"]["code"]),(403,"relay_authentication_failed"))
    self.assertEqual(sessions.calls,0)
  app,clock,repo,sessions=create("open",END)
  with TestClient(app) as c:
   r=request(c,relay=False)
   self.assertEqual((r.status_code,r.json()["error"]["code"]),(403,"service_ended"))
   self.assertEqual(sessions.calls,0)

 def test_before_end_original_session_and_relay_failures_survive(self):
  for factory in ["open","secured","supabase"]:
   app,clock,repo,sessions=create(factory,END-timedelta(microseconds=1))
   with TestClient(app) as c:
    r=request(c)
    self.assertEqual(r.status_code,200,(factory,r.text))
    self.assertEqual(sessions.calls,1)
    r=request(c,auth=False)
    self.assertEqual((r.status_code,r.json()["error"]["code"]),(401,"authentication_required"))
   if factory!="open":
    app,clock,repo,sessions=create(factory,END-timedelta(microseconds=1))
    with TestClient(app) as c:
     r=request(c,relay=False);self.assertEqual((r.status_code,r.json()["error"]["code"]),(403,"relay_authentication_failed"))

 def test_admitted_before_end_can_finish_after_auth_crosses_cutoff(self):
  for factory in ["open","secured","supabase"]:
   app,clock,repo,sessions=create(factory,END-timedelta(microseconds=1));sessions.cross=True
   calls=[];original=http.assert_service_admission
   def capture(value):calls.append(value);return original(value)
   with patch.object(http,"assert_service_admission",capture),TestClient(app) as c:
    r=request(c);self.assertEqual(r.status_code,200,(factory,r.text))
    self.assertEqual(len(calls),1);self.assertGreater(clock.value,END)

 def test_readiness_is_blocked_after_valid_relay_before_probe(self):
  for factory in ["open","secured","supabase"]:
   app,clock,repo,sessions=create(factory,END)
   with TestClient(app) as c:
    r=request(c,"/health/ready",auth=False)
    self.assertEqual((r.status_code,r.json()["error"]["code"]),(403,"service_ended"))
    self.assertEqual(repo.probes,0);self.assertEqual(sessions.calls,0)
    if factory!="open":
     r=request(c,"/health/ready",auth=False,relay=False)
     self.assertEqual((r.status_code,r.json()["error"]["code"]),(403,"relay_authentication_failed"))

 def test_live_endpoint_after_deadline_contains_only_public_minimum(self):
  for factory in ["open","secured","supabase"]:
   app,clock,repo,sessions=create(factory,END)
   with TestClient(app) as c:
    r=request(c,"/health/live",relay=False,auth=False)
    self.assertEqual(r.status_code,200)
    self.assertEqual(set(r.json()),{"status","server_timezone","now"})
    self.assertEqual(r.json()["status"],"alive")
    self.assertEqual(repo.probes,0);self.assertEqual(sessions.calls,0)

 def test_cors_preflight_before_end_and_after_end_allowed_or_denied_origin(self):
  allowed="https://synthetic-allowed.invalid";denied="https://synthetic-denied.invalid"
  app,clock,repo,sessions=create("secured",END-timedelta(microseconds=1),(allowed,))
  with TestClient(app) as c:
   for origin,status in [(allowed,200),(denied,400)]:
    r=c.options("/api/v1/me",headers={"Origin":origin,"Access-Control-Request-Method":"GET"})
    self.assertEqual(r.status_code,status)
   clock.value=END
   for origin in [allowed,denied]:
    r=c.options("/api/v1/me",headers={"Origin":origin,"Access-Control-Request-Method":"GET"})
    self.assertEqual((r.status_code,r.json()["error"]["code"]),(403,"service_ended"))
    self.assertEqual(r.headers.get("access-control-allow-origin"),allowed if origin==allowed else None)
   self.assertEqual(sessions.calls,0)

 def test_allowed_origin_on_service_end_and_relay_error_but_no_denied_origin(self):
  allowed="https://synthetic-allowed.invalid";denied="https://synthetic-denied.invalid"
  app,clock,repo,sessions=create("secured",END,(allowed,))
  with TestClient(app) as c:
   for origin in [allowed,denied]:
    r=request(c,origin=origin)
    self.assertEqual((r.status_code,r.json()["error"]["code"]),(403,"service_ended"))
    self.assertEqual(r.headers.get("access-control-allow-origin"),allowed if origin==allowed else None)
   r=request(c,relay=False,origin=allowed)
   self.assertEqual((r.status_code,r.json()["error"]["code"]),(403,"relay_authentication_failed"))
   self.assertEqual(r.headers.get("access-control-allow-origin"),allowed)

 def test_local_ready_shortcut_cannot_bypass_cutoff(self):
  app,clock,repo,sessions=create("open",END-timedelta(microseconds=1))
  boundary=local.LocalBoundary(app,origins=(),port=8000,diagnostic=lambda:False)
  with TestClient(boundary,base_url="http://127.0.0.1:8000",client=("127.0.0.1",7777)) as c:
   self.assertEqual(c.get("/health/ready").status_code,200)
   clock.value=END;r=c.get("/health/ready")
   self.assertEqual((r.status_code,r.json()["error"]["code"]),(403,"service_ended"))
   self.assertEqual(repo.probes,0);self.assertEqual(sessions.calls,0)

 def test_official_display_factory_is_covered_through_shared_composition(self):
  clock,repo,sessions,settings=components(END)
  provider=object.__new__(official.PostgresOfficialHistoryDisplayProvider);provider.scope=object()
  app=official.create_official_history_display_app(provider=provider,security=OriginalSecurity(TOKEN),
   settings=settings,repository=repo,sessions=sessions,clock=clock)
  with TestClient(app) as c:
   r=request(c);self.assertEqual((r.status_code,r.json()["error"]["code"]),(403,"service_ended"))
   self.assertEqual(sessions.calls,0)


 def test_all_25_rights_mode_routes_are_closed_after_end(self):
  catalog=json.loads((SOURCE/"src/jungsi_touch/application/route_catalog.json").read_bytes())["operations"]
  excluded={"history.snapshot.head","history.snapshot.read","report.list-own","member-shortlist.read","member-shortlist.update"}
  selected=[o for o in catalog if o["id"] not in excluded]
  self.assertEqual(len(selected),25)
  import re
  for factory in ["open","secured","supabase"]:
   app,clock,repo,sessions=create(factory,END,mode="rights")
   with TestClient(app) as c:
    for op in selected:
     path=re.sub(r"\{[^}]+\}","SYNTHETIC-id",op["path"])
     r=request(c,path,method=op["method"])
     self.assertEqual((r.status_code,r.json()["error"]["code"]),(403,"service_ended"),factory+" "+op["id"])
    self.assertEqual(sessions.calls,0);self.assertEqual(repo.probes,0);self.assertEqual(repo.access_calls,[])

 def test_actual_synthetic_write_before_deadline_commits_and_replay_after_deadline_is_rejected(self):
  for factory in ["open","secured"]:
   clock,repo,sessions,settings=components(END-timedelta(microseconds=1))
   repo.entitlements["SYNTHETIC-user"]={"active":True,"starts_at":END-timedelta(days=1),"expires_at":END+timedelta(days=1)}
   original=repo.create_profile
   def commit_then_cross(*args,**kwargs):
    result=original(*args,**kwargs);clock.value=END+timedelta(microseconds=1);return result
   repo.create_profile=commit_then_cross
   data=SyntheticData(clock)
   if factory=="open":
    app=http.create_app(settings=settings,repository=repo,data=data,sessions=sessions,clock=clock,operating_mode="legacy_synthetic")
   else:
    app=secured.create_secured_app(security=secured.SecuritySettings(TOKEN),settings=settings,
     repository=repo,data=data,sessions=sessions,clock=clock,operating_mode="legacy_synthetic")
   headers={"X-Jungsi-Relay-Token":TOKEN,"Authorization":"Bearer SYNTHETIC-user","Idempotency-Key":"SYNTHETIC-same"}
   body={"scores":score_input(),"confirmed":True}
   with TestClient(app) as c:
    r=c.post("/api/v1/score-profiles",json=body,headers=headers)
    self.assertEqual(r.status_code,201,(factory,r.text))
    self.assertEqual(len(repo.profiles),1);self.assertGreater(clock.value,END)
    r=c.post("/api/v1/score-profiles",json=body,headers=headers)
    self.assertEqual((r.status_code,r.json()["error"]["code"]),(403,"service_ended"))
    self.assertEqual(len(repo.profiles),1)

 def test_invalid_clock_fails_closed_before_session_for_each_factory(self):
  for factory in ["open","secured","supabase"]:
   app,clock,repo,sessions=create(factory,END);clock.value=None
   with TestClient(app) as c:
    r=request(c);self.assertEqual(r.status_code,503)
    self.assertIn(r.json()["error"]["code"],("security_policy_unavailable","backend_dependency_unavailable"))
    self.assertEqual(sessions.calls,0);self.assertEqual(repo.probes,0)

 def test_before_end_cors_allowed_or_denied_origin_keeps_normal_business(self):
  allowed="https://synthetic-allowed.invalid";denied="https://synthetic-denied.invalid"
  app,clock,repo,sessions=create("secured",END-timedelta(microseconds=1),(allowed,))
  with TestClient(app) as c:
   for origin in [allowed,denied]:
    r=request(c,origin=origin)
    self.assertEqual(r.status_code,200)
    self.assertEqual(r.headers.get("access-control-allow-origin"),allowed if origin==allowed else None)

if __name__=="__main__":unittest.main(verbosity=2)
