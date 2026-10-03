"""UTC instants and source-local calendar dates, without machine-local time."""
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo
import re

UTC = timezone.utc
SEOUL = ZoneInfo('Asia/Seoul')


def utc_instant(value, *, source_timezone=None):
    if isinstance(value, str):
        if 'T' not in value and ' ' not in value:
            raise ValueError('A calendar date is not an instant')
        if re.search(r'\.\d{7,}', value):
            raise ValueError('Instant precision exceeds six fractional digits')
        if not re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,6})?(?:Z|[+-](?:[01][0-9]|2[0-3]):[0-5][0-9])?', value):
            raise ValueError('Invalid ISO instant or offset')
        value = datetime.fromisoformat(value)
    if not isinstance(value, datetime):
        raise ValueError('An ISO datetime is required')
    if value.tzinfo is None or value.utcoffset() is None:
        if source_timezone != 'Asia/Seoul':
            raise ValueError('Naive datetime requires the explicit Asia/Seoul source contract')
        value = value.replace(tzinfo=SEOUL)
    return value.astimezone(UTC)


def utc_text(value):
    return utc_instant(value).isoformat().replace('+00:00', 'Z')


def calendar_date(value):
    if isinstance(value, datetime):
        raise ValueError('An instant cannot silently become a calendar date')
    if isinstance(value, str):
        value = date.fromisoformat(value)
    if type(value) is not date:
        raise ValueError('An ISO calendar date is required')
    return value


def seoul_date_range(start, end):
    """Inclusive calendar days -> half-open UTC query bounds."""
    start, end = calendar_date(start), calendar_date(end)
    if start > end:
        raise ValueError('Reversed calendar interval')
    return (datetime.combine(start, datetime.min.time(), SEOUL).astimezone(UTC),
            datetime.combine(end + timedelta(days=1), datetime.min.time(), SEOUL).astimezone(UTC))


class UtcClock:
    def now(self):
        return datetime.now(UTC)
