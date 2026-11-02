"""운항 통계. DATA_MODE에 따라 mock 또는 DB 구현을 쓴다."""

from app.core.config import settings

if settings.data_mode == "db":
    from app.services.db.stats import get_flight_stats
else:
    from app.services.mock.stats import get_flight_stats

__all__ = ["get_flight_stats"]