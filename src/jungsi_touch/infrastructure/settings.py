"""Private environment settings; safe readiness exposes names/booleans only."""
from dataclasses import dataclass, field
import os
from urllib.parse import urlsplit


@dataclass(frozen=True)
class ServerSettings:
    supabase_url: str | None = field(default=None,repr=False)
    supabase_key: str | None = field(default=None,repr=False)
    database_url: str | None = field(default=None,repr=False)
    drive_token: str | None = field(default=None,repr=False)
    drive_input_folder: str | None = field(default=None,repr=False)
    drive_output_folder: str | None = field(default=None,repr=False)
    drive_registry: str | None = field(default=None,repr=False)
    allowed_origins: tuple[str,...] = ()

    @classmethod
    def from_environment(cls):
        names=('SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','DATABASE_URL','GOOGLE_DRIVE_ACCESS_TOKEN',
               'GOOGLE_DRIVE_INPUT_FOLDER','GOOGLE_DRIVE_OUTPUT_FOLDER','JUNGSI_DRIVE_REGISTRY')
        return cls(*(os.environ.get(name) or None for name in names),
                   allowed_origins=tuple(x.strip() for x in os.environ.get('JUNGSI_ALLOWED_ORIGINS','').split(',') if x.strip()))

    def missing(self):
        mapping={'SUPABASE_URL':self.supabase_url,'SUPABASE_PUBLISHABLE_KEY':self.supabase_key,'DATABASE_URL':self.database_url,
                 'GOOGLE_DRIVE_ACCESS_TOKEN':self.drive_token,'GOOGLE_DRIVE_INPUT_FOLDER':self.drive_input_folder,
                 'GOOGLE_DRIVE_OUTPUT_FOLDER':self.drive_output_folder,'JUNGSI_DRIVE_REGISTRY':self.drive_registry}
        return [key for key,value in mapping.items() if not value]


class UnavailableRepository:
    def __getattr__(self,name):
        if name.startswith('_'):raise AttributeError(name)
        def unavailable(*args,**kwargs):
            from ..application.platform_ports import PlatformError
            raise PlatformError('storage_not_configured',503)
        return unavailable
