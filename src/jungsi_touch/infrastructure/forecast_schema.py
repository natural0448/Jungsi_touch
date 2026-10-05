"""Read-only 002 schema inspection. No migration or private row access."""
import re

TABLES=('forecast_authorities','forecast_drafts','forecast_revisions','forecast_releases','forecast_requests')
COLUMN_TYPES={
    ('forecast_authorities','subject_id'):'text', ('forecast_authorities','university_id'):'text',
    ('forecast_authorities','can_edit'):'bool', ('forecast_authorities','can_approve'):'bool',
    ('forecast_drafts','draft_id'):'text', ('forecast_drafts','revision'):'int8',
    ('forecast_drafts','body'):'jsonb', ('forecast_drafts','updated_at'):'timestamptz',
    ('forecast_revisions','draft_id'):'text', ('forecast_revisions','revision'):'int8',
    ('forecast_revisions','body'):'jsonb', ('forecast_revisions','created_at'):'timestamptz',
    ('forecast_releases','release_id'):'text', ('forecast_releases','offering_id'):'text',
    ('forecast_releases','body'):'jsonb', ('forecast_releases','published_at'):'timestamptz',
    ('forecast_requests','subject_id'):'text', ('forecast_requests','operation'):'text',
    ('forecast_requests','request_key'):'text', ('forecast_requests','request_hash'):'text',
    ('forecast_requests','result'):'jsonb', ('forecast_requests','created_at'):'timestamptz',
}
CONSTRAINTS={
    ('forecast_authorities','p'):'PRIMARY KEY (subject_id, university_id)',
    ('forecast_drafts','p'):'PRIMARY KEY (draft_id)',
    ('forecast_drafts','c'):'CHECK (revision > 0)',
    ('forecast_revisions','p'):'PRIMARY KEY (draft_id, revision)',
    ('forecast_revisions','c'):'CHECK (revision > 0)',
    ('forecast_revisions','f'):'FOREIGN KEY (draft_id) REFERENCES jungsi_backend.forecast_drafts(draft_id)',
    ('forecast_releases','p'):'PRIMARY KEY (release_id)',
    ('forecast_requests','p'):'PRIMARY KEY (subject_id, operation, request_key)',
}


def normalize(value):
    return re.sub(r'[\s()"]','',value).lower()


def probe_forecast(c):
    found=c.execute('SELECT '+','.join("to_regclass('jungsi_backend."+name+"')" for name in TABLES)).fetchone()
    tables=bool(found and len(found)==len(TABLES) and all(found))
    migration=bool(c.execute("SELECT EXISTS(SELECT 1 FROM jungsi_backend.schema_versions WHERE version='002_forecast_policy')").fetchone()[0]) if tables else False
    columns=c.execute('SELECT table_name,column_name,udt_name,is_nullable FROM information_schema.columns WHERE table_schema=%s AND table_name=ANY(%s)',('jungsi_backend',list(TABLES))).fetchall() if tables else []
    actual={(t,col):(kind,nullable) for t,col,kind,nullable in columns}
    column_errors=['.'.join(k) for k,kind in COLUMN_TYPES.items() if actual.get(k)!=(kind,'NO')]
    security=c.execute('SELECT relname,relrowsecurity FROM pg_class JOIN pg_namespace n ON n.oid=relnamespace WHERE n.nspname=%s AND relname=ANY(%s)',('jungsi_backend',list(TABLES))).fetchall() if tables else []
    flags=dict(security);rls=all(flags.get(t) is True for t in TABLES)
    constraints=c.execute('SELECT r.relname,c.contype,pg_get_constraintdef(c.oid) FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname=%s AND r.relname=ANY(%s) AND c.convalidated',('jungsi_backend',list(TABLES))).fetchall() if tables else []
    definitions={(t,kind,normalize(definition)) for t,kind,definition in constraints}
    constraint_errors=['.'.join(key) for key,definition in CONSTRAINTS.items() if (*key,normalize(definition)) not in definitions]
    privileges=c.execute("SELECT t,role,has_table_privilege(role,'jungsi_backend.'||t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') FROM unnest(%s::text[]) t CROSS JOIN unnest(ARRAY['anon','authenticated']) role",(list(TABLES),)).fetchall() if tables else []
    grants={(t,role):value for t,role,value in privileges}
    restricted=all(grants.get((t,role)) is False for t in TABLES for role in ('anon','authenticated'))
    verified=tables and migration and not column_errors and rls and not constraint_errors and restricted
    return dict(status='verified' if verified else 'failed',migration_002=migration,tables_present=tables,
        columns='verified' if not column_errors else 'mismatched',column_mismatches=column_errors,
        row_level_security='verified' if rls else 'missing',constraints='verified' if not constraint_errors else 'mismatched',
        constraint_mismatches=constraint_errors,client_privileges='restricted' if restricted else 'unverified_or_granted')
