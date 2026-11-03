"""편의시설. DATA_MODE에 따라 mock 또는 DB 구현을 쓴다."""

from app.core.config import settings

if settings.data_mode == "db":
    from app.services.db.facilities import list_facilities
else:
    from app.services.mock.facilities import list_facilities

__all__ = ["list_facilities"]