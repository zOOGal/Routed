"""
Timezone and datetime utilities.
"""
from datetime import datetime, timedelta, timezone
from typing import Optional


def utc_now() -> datetime:
    """Get current UTC datetime."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def days_from_now(days: int) -> datetime:
    """Get datetime N days from now."""
    return utc_now() + timedelta(days=days)


def format_date_short(dt: datetime) -> str:
    """Format datetime as short date string."""
    return dt.strftime("%Y-%m-%d")


def is_expired(dt: Optional[datetime]) -> bool:
    """Check if a datetime has passed."""
    if dt is None:
        return False
    return utc_now() > dt
