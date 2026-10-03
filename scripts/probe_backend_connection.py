"""Read-only live check; no user-table writes, migrations or credential output."""
from datetime import datetime, timezone
import importlib.metadata
import json
import os
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'src'))
from jungsi_touch.infrastructure.settings import ServerSettings
from jungsi_touch.infrastructure.postgres_repository import PostgresRepository
from jungsi_touch.infrastructure.supabase_session import SupabaseSessionProvider
from jungsi_touch.application.platform_ports import PlatformError


def probe():
    settings=ServerSettings.from_environment()
    result=dict(verification_kind='live_environment_probe',checked_at=datetime.now(timezone.utc).isoformat(),
        missing_settings=settings.missing(),database={'status':'not_run_configuration_missing'},
        auth={'status':'not_run_configuration_missing'},drive={'status':'not_run_configuration_missing'},
        runtime={name:importlib.metadata.version(name) for name in ('fastapi','psycopg','uvicorn','tzdata')})
    if settings.database_url:
        try:result['database']=PostgresRepository(settings.database_url).probe()
        except PlatformError as error:result['database']={'status':'failed','reason_code':error.code}
    token=os.environ.get('JUNGSI_PROBE_ACCESS_TOKEN')
    if settings.supabase_url and settings.supabase_key and token:
        try:
            session=SupabaseSessionProvider(settings.supabase_url,settings.supabase_key).verify(token,datetime.now(timezone.utc))
            result['auth']={'status':'verified' if session is not None else 'denied'}
        except PlatformError as error:result['auth']={'status':'failed','reason_code':error.code}
    return result


if __name__=='__main__':print(json.dumps(probe(),ensure_ascii=False,indent=2))
