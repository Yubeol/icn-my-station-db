"""출국장 혼잡도. DATA_MODE에 따라 mock 또는 DB 구현을 쓴다."""

from app.core.config import settings

if settings.data_mode == "db":
    from app.services.db.congestion import get_congestion, get_congestion_hourly
else:
    from app.services.mock.congestion import get_congestion, get_congestion_hourly

__all__ = ["get_congestion", "get_congestion_hourly"]