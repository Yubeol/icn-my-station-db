import copy
from pipeline.collector import extract_records
from pipeline.normalize import normalize_congestion,parse_time
from pipeline.sources import load_sources
from pipeline.db import init_db,Session,CongestionSnapshot
from pipeline.storage import collect_one
from sqlalchemy import select,func

def test_normalize():
    cfg=load_sources()['congestion_t1']
    body='{"records":[{"gateId":"3","occurtime":"2026-10-29T09:00:00+09:00","waitLength":123}]}'
    r=normalize_congestion(extract_records(body,cfg)[0],cfg)
    assert r['hall_id']=='3' and r['waiting_count']==123 and r['measured_at'].hour==0

def test_duplicate_is_not_saved_twice():
    init_db()
    cfg=load_sources()['congestion_t1']
    assert collect_one(cfg,'mock')['ok']
    assert collect_one(cfg,'mock')['ok']
    with Session() as db:
        assert db.scalar(select(func.count()).select_from(CongestionSnapshot).where(CongestionSnapshot.terminal_code=='T1'))==6
