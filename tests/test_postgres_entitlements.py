"""Synthetic schema/role fixtures and in-memory SQL predicate execution.

SQLite verifies the common SELECT predicate, not PostgreSQL RLS/DDL deployment.
No real account, entitlement, database URL or filesystem fixture is used.
"""
from datetime import datetime, timedelta, timezone
import json
import sqlite3
import unittest
from uuid import UUID

from jungsi_touch.application.platform_ports import PlatformError
from jungsi_touch.infrastructure.postgres_entitlements import PASS_STATE_SQL, PostgresJeongsiPassesRepository


OWNER = '00000000-0000-4000-8000-000000000001'
OTHER = '00000000-0000-4000-8000-000000000002'
NOW = datetime(2026, 10, 1, tzinfo=timezone.utc)
COLUMNS = [('id','int8','NO'),('user_id','uuid','NO'),('starts_at','timestamptz','NO'),
           ('ends_at','timestamptz','NO'),('note','text','YES'),('granted_by','uuid','YES'),
           ('revoked_at','timestamptz','YES'),('revoked_by','uuid','YES'),('created_at','timestamptz','NO')]
CONSTRAINTS = [('jeongsi_passes_pkey','p',True,'PRIMARY KEY (id)'),
               ('jeongsi_passes_period','c',True,'CHECK ((ends_at > starts_at))'),
               ('jeongsi_passes_user_id_fkey','f',True,'FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE')]
POLICIES = [('jeongsi_passes: select own or admin','r',True,['public'],'((auth.uid() = user_id) OR is_admin())',None),
            ('jeongsi_passes: jungsi backend read','r',True,['jungsi_backend_app','jungsi_backend_owner'],'true',None)]


class Rows:
    def __init__(self, rows): self.rows = rows
    def fetchone(self): return self.rows[0] if self.rows else None
    def fetchall(self): return self.rows


class SyntheticConnection:
    def __init__(self):
        self.calls = []; self.columns = list(COLUMNS); self.constraints = list(CONSTRAINTS)
        self.role = (True,False,False,False,True,False,False); self.policies = list(POLICIES)
        self.exists = True; self.failure = False
        self.role_name = 'jungsi_backend_app'
        self.sql = sqlite3.connect(':memory:')
        self.sql.execute("ATTACH DATABASE ':memory:' AS public")
        self.sql.execute('CREATE TABLE public.jeongsi_passes(user_id TEXT,starts_at TEXT,ends_at TEXT,revoked_at TEXT)')

    def add(self, owner, start, end, revoked=None):
        self.sql.execute('INSERT INTO public.jeongsi_passes VALUES(?,?,?,?)',
                         (owner,(NOW+timedelta(seconds=start)).isoformat(),
                          (NOW+timedelta(seconds=end)).isoformat(),revoked))

    def __enter__(self): return self
    def __exit__(self,*args): return False

    def execute(self, query, params=()):
        self.calls.append((query,params))
        if self.failure: raise RuntimeError('SYNTHETIC-private-connection-detail')
        if query.startswith('SET '): return Rows([])
        if 'set_config' in query: return Rows([(params[0],params[1])])
        if query == PASS_STATE_SQL:
            # Execute the submitted statement's actual subject/time predicate in
            # SQLite; catalog/RLS data remain synthetic PostgreSQL metadata.
            role,subject,start,end=params
            expiry=None
            if subject is not None:
                predicate=query.split('WHERE user_id=',1)[1].split('\n) paid',1)[0]
                statement='SELECT max(ends_at) FROM public.jeongsi_passes WHERE user_id='+predicate
                values=(str(subject),start.isoformat(),end.isoformat())
                row=self.sql.execute(statement.replace('%s','?'),values).fetchone()
                expiry=datetime.fromisoformat(row[0]) if row[0] else None
            return Rows([(self.exists,self.columns,self.constraints,
                          self.role if role==self.role_name else None,self.policies,expiry)])
        raise AssertionError('Unexpected synthetic query')


class EntitlementAdapterTests(unittest.TestCase):
    def setUp(self):
        self.c = SyntheticConnection(); self.options = []
        def connect(url,**options): self.options.append(options); return self.c
        self.repo = PostgresJeongsiPassesRepository('SYNTHETIC-private-url',connector=connect)

    def tearDown(self): self.c.sql.close()

    def test_active_overlap_max_ignores_future_revoked_and_foreign(self):
        for row in ((OWNER,-10,10,None),(OWNER,-20,30,None),(OWNER,1,200,None),
                    (OWNER,-1,300,'revoked'),(OTHER,-1,400,None)):
            self.c.add(*row)
        self.assertEqual(self.repo.active_paid_until(OWNER,NOW),NOW+timedelta(seconds=30))

    def test_start_is_inclusive_and_end_is_exclusive(self):
        for start,end,expected in ((0,1,True),(-1,0,False),(1,2,False)):
            with self.subTest(start=start,end=end):
                connection=SyntheticConnection(); connection.add(OWNER,start,end)
                repo=PostgresJeongsiPassesRepository('SYNTHETIC',connector=lambda *a,**k:connection)
                self.assertIs(repo.active_paid(OWNER,NOW),expected)
                connection.sql.close()

    def test_zero_rows_is_standard_and_no_future_expiry_projection(self):
        self.assertIs(self.repo.active_paid(OWNER,NOW),False)
        self.assertIsNone(self.repo.active_paid_until(OWNER,NOW))

    def test_read_only_utc_parameterized_subject_and_transaction_claims(self):
        self.c.add(OWNER,-1,1)
        seoul=NOW.astimezone(timezone(timedelta(hours=9)))
        self.assertTrue(self.repo.active_paid(OWNER,seoul))
        self.assertEqual(self.c.calls[0][0],'SET TRANSACTION READ ONLY')
        self.assertEqual(self.c.calls[1][0],"SET LOCAL TIME ZONE 'UTC'")
        claim=next(params for query,params in self.c.calls if 'set_config' in query)
        self.assertEqual(claim[0],OWNER); self.assertEqual(json.loads(claim[1]),{'sub':OWNER,'role':'authenticated'})
        query,params=self.c.calls[-1]; self.assertNotIn(OWNER,query)
        self.assertEqual(params,('jungsi_backend_app',UUID(OWNER),NOW,NOW))
        self.assertEqual(self.options[0],dict(sslmode='require',connect_timeout=5,prepare_threshold=None))
        self.assertFalse(any(query.startswith(('INSERT','UPDATE','DELETE','DROP','ALTER','GRANT')) for query,_ in self.c.calls))

    def test_metadata_and_current_expiry_use_one_joined_statement(self):
        self.c.add(OWNER,-1,1)
        self.assertTrue(self.repo.active_paid(OWNER,NOW))
        state=[query for query,_ in self.c.calls if query==PASS_STATE_SQL]
        self.assertEqual(len(state),1)
        self.assertIn('LEFT JOIN LATERAL',state[0])
        self.assertEqual(len(self.c.calls),4)  # READ ONLY, UTC, claims, joined read

    def test_grant_revoke_and_schema_drift_are_visible_on_the_next_read(self):
        self.assertIsNone(self.repo.active_paid_until(OWNER,NOW))
        self.c.add(OWNER,-1,30)
        self.assertEqual(self.repo.active_paid_until(OWNER,NOW),NOW+timedelta(seconds=30))
        self.c.sql.execute('UPDATE public.jeongsi_passes SET revoked_at=? WHERE user_id=?',('revoked',OWNER))
        self.assertIsNone(self.repo.active_paid_until(OWNER,NOW))
        self.c.columns=COLUMNS+[('status','text','YES')]
        with self.assertRaises(PlatformError) as caught:self.repo.active_paid_until(OWNER,NOW)
        self.assertEqual(caught.exception.code,'entitlement_schema_unverified')

    def test_invalid_joined_metadata_shape_fails_closed(self):
        original=self.c.execute
        for state in ([],[(True,)],[(True,COLUMNS,CONSTRAINTS,self.c.role,POLICIES)]):
            def execute(query,params=()):
                return Rows(state) if query==PASS_STATE_SQL else original(query,params)
            self.c.execute=execute
            with self.subTest(state=state),self.assertRaises(PlatformError) as caught:
                self.repo.active_paid_until(OWNER,NOW)
            self.assertEqual(caught.exception.code,'entitlement_schema_unverified')
        self.c.execute=original

    def test_source_types_nulls_and_unexpected_columns_fail_closed(self):
        cases=[COLUMNS[:-1],COLUMNS+[('status','text','YES')],
               [(name,'text' if name=='user_id' else kind,nullable) for name,kind,nullable in COLUMNS],
               [(name,kind,'YES' if name=='ends_at' else nullable) for name,kind,nullable in COLUMNS]]
        for columns in cases:
            with self.subTest(columns=columns):
                self.c.columns=columns
                with self.assertRaises(PlatformError) as caught:self.repo.active_paid(OWNER,NOW)
                self.assertEqual(caught.exception.code,'entitlement_schema_unverified')

    def test_period_fk_pk_or_validation_drift_fails(self):
        for constraints in (CONSTRAINTS[1:],CONSTRAINTS[:2],CONSTRAINTS[:1]+CONSTRAINTS[2:],
                            [(n,k,False,d) for n,k,v,d in CONSTRAINTS]):
            self.c.constraints=constraints
            with self.assertRaises(PlatformError):self.repo.probe()

    def test_unknown_nullable_metadata_is_not_converted_to_not_null(self):
        for nullable in (None,'UNKNOWN',False,0):
            self.c.columns=[(name,kind,nullable if name=='ends_at' else old) for name,kind,old in COLUMNS]
            with self.subTest(nullable=nullable),self.assertRaises(PlatformError) as caught:self.repo.probe()
            self.assertEqual(caught.exception.code,'entitlement_schema_unverified')

    def test_numeric_role_metadata_does_not_pass_boolean_comparison(self):
        for index in range(7):
            role=list((True,False,False,False,True,False,False));role[index]=int(role[index])
            self.c.role=tuple(role)
            with self.subTest(index=index),self.assertRaises(PlatformError) as caught:self.repo.probe()
            self.assertEqual(caught.exception.code,'entitlement_runtime_role_unverified')

    def test_missing_or_malformed_metadata_rows_are_rejected(self):
        for rows in (None,[],COLUMNS[:-1]+[('created_at','timestamptz')],COLUMNS[:-1]+[None]):
            self.c.columns=rows
            with self.subTest(rows=rows),self.assertRaises(PlatformError) as caught:self.repo.probe()
            self.assertEqual(caught.exception.code,'entitlement_schema_unverified')
        self.c.columns=list(COLUMNS);self.c.role=None
        with self.assertRaises(PlatformError) as caught:self.repo.probe()
        self.assertEqual(caught.exception.code,'entitlement_runtime_role_unverified')

    def test_effective_role_and_column_writer_privilege_are_rejected(self):
        for index in (0,1,2,3,4,5,6):
            role=list((True,False,False,False,True,False,False));role[index]=not role[index]
            self.c.role=tuple(role)
            with self.subTest(index=index),self.assertRaises(PlatformError) as caught:self.repo.probe()
            self.assertEqual(caught.exception.code,'entitlement_runtime_role_unverified')

    def test_unexpected_select_policy_or_rls_predicate_is_rejected(self):
        for policies in ([],POLICIES*2,[('other','r',True,'{0}','true')],
                         [(POLICIES[0][0],'*',True,'{0}',POLICIES[0][4])]):
            self.c.policies=policies
            with self.assertRaises(PlatformError) as caught:self.repo.probe()
            self.assertEqual(caught.exception.code,'entitlement_rls_unverified')

    def test_observed_runtime_policy_and_dedicated_app_role_are_required(self):
        for policies in (POLICIES[:1],POLICIES[:1]+[(POLICIES[1][0],'r',True,['other-role'],'true',None)],
                         POLICIES[:1]+[(POLICIES[1][0],'r',True,POLICIES[1][3],'false',None)],
                         [POLICIES[0],(POLICIES[1][0],'*',True,POLICIES[1][3],'true',None)],
                         [POLICIES[0],(POLICIES[1][0],'r',True,POLICIES[1][3],'true','true')],
                         [POLICIES[0],(POLICIES[1][0],'r',1,POLICIES[1][3],'true',None)]):
            self.c.policies=policies
            with self.assertRaises(PlatformError) as caught:self.repo.probe()
            self.assertEqual(caught.exception.code,'entitlement_rls_unverified')
        self.c.policies=list(POLICIES);self.c.role_name='jungsi_backend_owner'
        with self.assertRaises(PlatformError) as caught:self.repo.probe()
        self.assertEqual(caught.exception.code,'entitlement_runtime_role_unverified')

    def test_invalid_identity_or_naive_time_does_not_connect(self):
        for owner,instant in (('not-a-uuid',NOW),(OWNER,NOW.replace(tzinfo=None))):
            with self.assertRaises(PlatformError):self.repo.active_paid(owner,instant)
        self.assertEqual(self.options,[])

    def test_connector_failure_is_safe_and_probe_has_no_secrets(self):
        self.assertEqual(self.repo.probe()['status'],'verified')
        self.c.failure=True
        with self.assertRaises(PlatformError) as caught:self.repo.active_paid(OWNER,NOW)
        self.assertEqual(str(caught.exception),'storage_unavailable')
        self.assertNotIn('SYNTHETIC-private',str(caught.exception))
