"""운항 현황. DATA_MODE에 따라 mock 또는 DB 구현을 쓴다.

라우터와 다른 서비스는 항상 이 모듈만 import한다. mock/db 두 구현은 같은 함수 이름과 반환 타입을 가진다.
"""

from app.core.config import settings
from app.core.errors import FlightNotFoundError

if settings.data_mode == "db":
    from app.services.db.flights import (
        get_flight,
        list_flights,
        list_upcoming_flights,
        resolve_my_flight_no,
    )
else:
    from app.services.mock.flights import (
        get_flight,
        list_flights,
        list_upcoming_flights,
        resolve_my_flight_no,
    )

__all__ = [
    "FlightNotFoundError",
    "get_flight",
    "list_flights",
    "list_upcoming_flights",
    "resolve_my_flight_no",
]