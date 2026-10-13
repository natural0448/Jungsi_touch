"""Supabase Auth getUser verification; client identity/paid metadata is ignored."""
import base64
import json
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit,urlencode
from datetime import datetime
from uuid import UUID
from ..application.platform_ports import PlatformError, VerifiedSession
from ..application.time_contract import UTC


class SupabaseSessionProvider:
    def __init__(self,url,key,*,opener=urlopen):
        self._url,self._key,self._opener=url,key,opener

    def _account_status(self,token,subject):
        # Use the already verified exact bearer and authenticated own-row RLS.
        # No app-role GRANT, profile-admin override or service-role key is used.
        query=urlencode({'select':'status','id':'eq.'+subject,'limit':'1'})
        request=Request(self._url.rstrip('/')+'/rest/v1/profiles?'+query,
                        headers={'Authorization':'Bearer '+token,'apikey':self._key})
        try:
            with self._opener(request,timeout=5) as response:
                content=response.read(2049)
            if len(content)>2048:return None
            def unique(pairs):
                row={}
                for key,value in pairs:
                    if key in row:raise ValueError('duplicate profile field')
                    row[key]=value
                return row
            rows=json.loads(content,object_pairs_hook=unique)
            if not isinstance(rows,list) or len(rows)!=1 or type(rows[0]) is not dict or set(rows[0])!={'status'}:
                return None
            status=rows[0]['status']
            return status if type(status) is str and status.strip() and len(status)<=64 else None
        except (OSError,URLError,HTTPError,ValueError,TypeError):
            # Unknown status closes management only; ordinary score results are
            # not discarded because this separate management probe is unavailable.
            return None

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
        # Expiry and AAL decoding occur only AFTER server verification of this exact JWT.
        # It never verifies signatures itself or consumes client-paid claims.
        try:
            uid=str(UUID(data['id']))
            claims=json.loads(base64.urlsafe_b64decode(token.split('.')[1]+'==='))
            if str(UUID(claims['sub']))!=uid or type(claims['exp']) is not int:return None
            expires=datetime.fromtimestamp(claims['exp'],UTC)
            if expires<=now:return None
            assurance=claims.get('aal')
            if assurance is not None and (type(assurance) is not str or assurance not in ('aal1','aal2')):
                return None
            return VerifiedSession(uid,expires,assurance,self._account_status(token,uid))
        except (KeyError,ValueError,IndexError,TypeError,OverflowError):return None
