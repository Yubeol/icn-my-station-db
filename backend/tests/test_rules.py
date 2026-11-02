"""rules.py의 활주로·지연 위험 판정 테스트."""

import pytest

from app.core import rules
from app.schemas import DelayRisk, OperationLevel


@pytest.mark.parametrize(
    ("wind_direction", "expected"),
    [
        (320.0, "33"),
        (150.0, "15"),
        (10.0, "33"),  # 360도 경계: 10°는 330°와 40° 차이, 150°와 140° 차이
        (200.0, "15"),
    ],
)
def test_active_runway(wind_direction, expected):
    assert rules.active_runway(8.0, wind_direction) == expected


def test_active_runway_calm_wind_is_none():
    assert rules.active_runway(0.5, 320.0) is None
    assert rules.active_runway(rules.CALM_WIND_MS - 0.1, 320.0) is None


def test_active_runway_at_calm_threshold():
    assert rules.active_runway(rules.CALM_WIND_MS, 320.0) == "33"


def test_active_runway_unknown_is_none():
    assert rules.active_runway(8.0, None) is None
    assert rules.active_runway(None, 320.0) is None


@pytest.mark.parametrize(
    ("level", "expected"),
    [
        (OperationLevel.HIGH, DelayRisk.LOW),
        (OperationLevel.MID, DelayRisk.MID),
        (OperationLevel.LOW, DelayRisk.HIGH),
        (None, None),
    ],
)
def test_delay_risk_inverts_level(level, expected):
    assert rules.delay_risk(level) == expected
