"""날씨·운항 여건. DATA_MODE에 따라 mock 또는 DB 구현을 쓴다."""

from app.core.config import settings

if settings.data_mode == "db":
    from app.services.db.weather import get_weather
else:
    from app.services.mock.weather import get_weather

__all__ = ["get_weather"]