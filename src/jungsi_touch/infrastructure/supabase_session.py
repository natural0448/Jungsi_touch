"""Supabase Auth getUser verification; client identity/paid metadata is ignored."""
import base64
import json
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from datetime import datetime
from uuid import UUID
from ..application.platform_ports import PlatformError, VerifiedSession
from ..application.time_contract import UTC


class SupabaseSessionProvider:
    def __init__(self,url,key,*,opener=urlopen):
        self._url,self._key,self._opener=url,key,opener

    def verify(self,token,now):
        if not self._url or not self._key: raise PlatformError('auth_not_configured',503)
        parsed=urlsplit(self._url)
        if parsed.scheme!='https' or not parsed.hostname or parsed.username or parsed.query or parsed.fragment:
            raise PlatformError('auth_configuration_invalid',503)
        request=Request(self._url.rstrip('/')+'/auth/v1/user',headers={'Authorization':'Bearer '+token,'apikey':self._key})
        try:
            with self._opener(request,timeout=5) as response:data=json.loads(response.read(65537))
        except HTTPError as error:
            if error.code in (400,401,403):return None
            raise PlatformError('auth_unavailable',503) from error
        except (OSError,URLError,ValueError) as error:raise PlatformError('auth_unavailable',503) from error
        # Expiry decoding occurs only AFTER server verification of this exact JWT.
        # It never verifies signatures itself or consumes client-paid claims.
        try:
            uid=str(UUID(data['id']))
            claims=json.loads(base64.urlsafe_b64decode(token.split('.')[1]+'==='))
            if str(UUID(claims['sub']))!=uid or type(claims['exp']) is not int:return None
            expires=datetime.fromtimestamp(claims['exp'],UTC)
            if expires<=now:return None
            return VerifiedSession(uid,expires)
        except (KeyError,ValueError,IndexError,TypeError,OverflowError):return None
