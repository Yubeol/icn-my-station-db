"""접속 로그에서 쿼리 토큰 값을 가린다.

/ws/yolo/camera, /ws/yolo/worker는 token= 쿼리로 인증하는데, uvicorn 접속 로그에 요청 경로가 그대로 찍힌다.
로그는 끄지 않고 token= 뒤의 값만 ***로 바꾼다.
"""

import logging
import re

_TOKEN_RE = re.compile(r"(token=)[^&\s\"']+", re.IGNORECASE)
_LOGGERS = ("uvicorn", "uvicorn.error", "uvicorn.access", "websockets", "websockets.server")


def mask_token(text: str) -> str:
    return _TOKEN_RE.sub(r"\1***", text)


class TokenMaskFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.msg, str):
            record.msg = mask_token(record.msg)
        if isinstance(record.args, tuple):
            record.args = tuple(mask_token(a) if isinstance(a, str) else a for a in record.args)
        elif isinstance(record.args, dict):
            record.args = {
                k: mask_token(v) if isinstance(v, str) else v for k, v in record.args.items()
            }
        return True


def install_token_mask() -> None:
    """여러 번 불러도 필터는 로거마다 하나만 붙는다."""
    for name in _LOGGERS:
        logger = logging.getLogger(name)
        if not any(isinstance(f, TokenMaskFilter) for f in logger.filters):
            logger.addFilter(TokenMaskFilter())
