"""Request admission only; preserve the existing per-request auth and transaction checks."""
from datetime import datetime, timezone
from .platform_ports import PlatformError

SERVICE_END_UTC = datetime(2027, 1, 7, 15, 0, tzinfo=timezone.utc)

def assert_service_admission(value):
    try:
        if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("invalid_clock")
        now = value.astimezone(timezone.utc)
    except (ValueError, TypeError, OverflowError) as error:
        raise PlatformError("security_policy_unavailable", 503) from error
    if now >= SERVICE_END_UTC:
        raise PlatformError("service_ended", 403)
