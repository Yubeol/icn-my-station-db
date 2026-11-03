"""서비스 공통 예외. mock과 db 구현이 같은 예외를 써야 main.py의 404 처리가 하나로 유지된다."""


class FlightNotFoundError(Exception):
    def __init__(self, flight_no: str):
        super().__init__(f"편명 {flight_no}을(를) 찾을 수 없습니다.")
        self.flight_no = flight_no