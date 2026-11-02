from datetime import datetime,timezone
from zoneinfo import ZoneInfo

def value(record, name):
    field=name.get('field') if isinstance(name,dict) else name
    if field is None: return None
    return record.get(field)

def parse_time(v):
    if not v: raise ValueError('관측시각 누락')
    s=str(v).strip()
    if len(s)==12 and s.isdigit():
        d=datetime.strptime(s,'%Y%m%d%H%M')
    elif len(s)==14 and s.isdigit():
        d=datetime.strptime(s,'%Y%m%d%H%M%S')
    else:
        d=datetime.fromisoformat(s.replace('Z','+00:00'))
    if d.tzinfo is None: d=d.replace(tzinfo=ZoneInfo('Asia/Seoul'))
    return d.astimezone(timezone.utc)

def normalize_congestion(item,source):
    fields=source.get('mapping',{})
    if not all(k in fields for k in ('hall_id','measured_at','waiting_count')):
        raise ValueError('혼잡도 필드 매핑이 미설정입니다. 실제 응답 샘플을 확인해 config/ap is.json 설정 필요'.replace('ap is','apis'))
    hall=str(value(item,fields['hall_id']))
    if hall in ('None',''): raise ValueError('gateId missing')
    when=parse_time(value(item,fields['measured_at']))
    raw_wait=value(item,fields['waiting_count'])
    if raw_wait in (None,'','-'): raise ValueError('waitLength missing')
    waiting=int(raw_wait)
    if waiting<0: raise ValueError('대기인원 음수')
    return {'terminal_code':source['terminal'], 'hall_id':hall, 'measured_at':when, 'waiting_count':waiting,'data_origin':'api','source_api':source['id']}

def normalize_flight(item,source,day):
    fields=source.get('mapping',{})
    required=['flight_no','direction','status','gate','scheduled_at','estimated_at']
    if not all(k in fields for k in required): raise ValueError('항공편 필드 매핑 미설정')
    result={k:str(value(item,fields[k]) or '') for k in required}
    if not result['flight_no']: raise ValueError('편명 누락')
    result['service_date']=day or str(value(item, fields.get('service_date')))[:10]
    return result
