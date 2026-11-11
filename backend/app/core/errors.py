"""서비스 공통 예외. mock과 db 구현이 같은 예외를 써야 main.py의 404 처리가 하나로 유지된다."""


class FlightNotFoundError(Exception):
    def __init__(self, flight_no: str):
        super().__init__(f"편명 {flight_no}을(를) 찾을 수 없습니다.")
        self.flight_no = flight_no


class YoloEventNotFoundError(Exception):
    def __init__(self, event_id: int):
        super().__init__(f"이벤트 {event_id}을(를) 찾을 수 없습니다.")
        self.event_id = event_id


class YoloEventReviewedError(Exception):
    def __init__(self, event_id: int):
        super().__init__(f"이벤트 {event_id}은(는) 이미 판정되었습니다.")
        self.event_id = event_id


class YoloWriteDisabledError(Exception):
    def __init__(self):
        super().__init__("YOLO_WRITE_ENABLED가 꺼져 있어 저장할 수 없습니다.")
