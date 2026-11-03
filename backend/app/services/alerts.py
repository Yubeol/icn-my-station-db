"""스마트 알림. DATA_MODE에 따라 mock 또는 DB 구현을 쓴다."""

from app.core.config import settings

if settings.data_mode == "db":
    from app.services.db.alerts import list_alerts
else:
    from app.services.mock.alerts import list_alerts

__all__ = ["list_alerts"]