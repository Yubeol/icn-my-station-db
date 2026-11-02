import json
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from .db import (Session, CollectionRun, RawResponse, CongestionSnapshot,FlightRecord,FlightChange,utcnow)
from .collector import fetch,extract_records
from .normalize import normalize_congestion,normalize_flight

def collect_one(source,mode='mock',date_value=None):
    started=utcnow()
    with Session.begin() as db:
        run=CollectionRun(api_id=source['id'], started_at=started,success=0)
        db.add(run);db.flush();run_id=run.id
    body=None;status=None;ctype=None
    try:
        body,status,ctype=fetch(source, mode,date_value)
        records=extract_records(body,source)
        if not isinstance(records,list): raise ValueError('레코드 배열 아님')
        with Session.begin() as db:
            db.add(RawResponse(run_id=run_id,api_id=source['id'],collected_at=utcnow(),http_status=status,content_type=ctype,raw_body=body))
            inserted=0;updated=0
            if source['kind']=='congestion' and source.get('mapping'):
                for item in records:
                    obj=normalize_congestion(item,source)
                    # SQLite/PostgreSQL 공통 동작을 위한 선조회 (실서비스는 UNIQUE + ON CONFLICT 권장)
                    exists=db.execute(select(CongestionSnapshot.id).where(
                        CongestionSnapshot.terminal_code==obj['terminal_code'],CongestionSnapshot.hall_id==obj['hall_id'],
                        CongestionSnapshot.measured_at==obj['measured_at'],CongestionSnapshot.data_origin=='api'
                    )).first()
                    if not exists: db.add(CongestionSnapshot(**obj));inserted+=1
            elif source['kind']=='flights' and source.get('mapping'):
                for item in records:
                    obj=normalize_flight(item,source,date_value)
                    old=db.execute(select(FlightRecord).where(FlightRecord.flight_no==obj['flight_no'],FlightRecord.service_date==obj['service_date'],FlightRecord.direction==obj['direction'])).scalar_one_or_none()
                    fields=('status','gate','scheduled_at','estimated_at')
                    if old is None:
                        db.add(FlightRecord(**obj,updated_at=utcnow()));inserted+=1
                    else:
                        before={f:getattr(old,f) for f in fields}
                        after={f:obj[f] for f in fields}
                        if before!=after:
                            db.add(FlightChange(flight_no=obj['flight_no'],service_date=obj['service_date'],direction=obj['direction'],changed_at=utcnow(),before_values=before,after_values=after));updated+=1
                            for f in fields:setattr(old,f,obj[f])
                        old.updated_at=utcnow()
            run=db.get(CollectionRun,run_id);run.finished_at=utcnow();run.success=1;run.record_count=len(records)
        return {'source':source['id'],'ok':True,'records':len(records),'normalized_inserted':inserted,'flight_changed':updated,'run_id':run_id,'mode':mode}
    except Exception as exc:
        with Session.begin() as db:
            run=db.get(CollectionRun,run_id);run.finished_at=utcnow();run.error_message=str(exc)[:3000];run.success=0
        return {'source':source['id'],'ok':False,'error':str(exc),'run_id':run_id,'mode':mode}
