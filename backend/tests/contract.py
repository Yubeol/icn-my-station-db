"""docs/api-contract.md의 필드 표를 읽어 모델별 필드 경로 집합을 만든다."""

import re
from pathlib import Path

CONTRACT_PATH = Path(__file__).resolve().parents[2] / "docs" / "api-contract.md"


def _model_name(heading: str) -> str:
    """'메인 요약 (DashboardSummary)' -> DashboardSummary, 'Flight (운항 현황 항목)' -> Flight."""
    paren = re.search(r"\(([A-Za-z]+)\)", heading)
    if paren:
        return paren.group(1)
    return heading.split()[0]


def load_contract_fields() -> dict[str, set[str]]:
    models: dict[str, set[str]] = {}
    current: str | None = None
    previous_line = ""
    for raw in CONTRACT_PATH.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if line.startswith("## "):
            current = _model_name(line[3:])
        elif line and not line.startswith(("|", "-", "#")) and previous_line == "":
            # "Hall", "Breakdown", "Hourly"처럼 표 앞에 단독으로 놓인 모델 이름
            if re.fullmatch(r"[A-Z][A-Za-z]+", line):
                current = line
        elif line.startswith("|") and current:
            first = line.strip("|").split("|")[0].strip()
            if first in ("필드", "") or set(first) <= {"-"}:
                continue
            models.setdefault(current, set()).add(first)
        previous_line = line if line else ""
    return models


def response_paths(data: dict, documented: set[str], prefix: str = "") -> set[str]:
    """응답 JSON의 키를 계약의 점(.) 표기로 펼친다. 계약에 하위 경로가 있는 객체만 내려간다."""
    paths: set[str] = set()
    for key, value in data.items():
        path = f"{prefix}{key}"
        has_children = any(d.startswith(path + ".") for d in documented)
        if isinstance(value, dict) and has_children:
            paths |= response_paths(value, documented, path + ".")
        else:
            paths.add(path)
    return paths
