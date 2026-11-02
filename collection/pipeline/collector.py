import json
from pathlib import Path
from datetime import datetime,timezone
from zoneinfo import ZoneInfo
from xml.etree import ElementTree as ET
import httpx
from .settings import env
FIXTURES=Path(__file__).resolve().parents[1]/'fixtures'

def _json_path(obj,path):
    if not path:return obj
    for key in path.split('.'):
        if isinstance(obj,list):
            if key.isdigit():obj=obj[int(key)]
            else:
                merged=[]
                for entry in obj:
                    if not isinstance(entry,dict):raise ValueError(f'Cannot read {key} on list item')
                    val=entry[key]
                    merged.extend(val if isinstance(val,list) else [val])
                obj=merged
        else:obj=obj[key]
    return obj

def unwrap_items(value):
    if isinstance(value,list):
        result=[]
        for item in value: result.extend(unwrap_items(item))
        return result
    if isinstance(value,dict):
        if 'item' in value:return unwrap_items(value['item'])
        if 'items' in value:return unwrap_items(value['items'])
        # Congestion API can return list of shaped containers; retain a record if it has fields
        if any(k in value for k in ('gateId','occurtime','waitLength')):return [value]
        return [value]
    return [] if value is None else [value]

def extract_records(body,source):
    fmt=source.get('format','json')
    if fmt=='json':
        obj=json.loads(body)
        if isinstance(obj,dict):
            result=obj.get('response',{}).get('header',{}) if isinstance(obj.get('response'),dict) else {}
            code=result.get('resultCode')
            if code is not None and str(code).strip() not in ('00','0'):
                raise ValueError(f'API returned resultCode={code} {result.get("resultMsg", "")}')
        path=source.get('records_path','')
        if isinstance(obj,dict) and 'records' in obj and source.get('kind')=='congestion':path='records'
        val=_json_path(obj,path)
        return unwrap_items(val)
    if fmt=='xml':
        root=ET.fromstring(body)
        return [{child.tag.split('}')[-1]:child.text for child in el} for el in root.findall(source.get('records_path','.//item'))]
    return [{'text':body}]

def fetch(source,mode='mock',date_value=None):
    if mode=='mock':
        f=FIXTURES/source['fixture']
        return f.read_text(encoding='utf-8'),200,'application/json'
    if not source.get('enabled') or not source.get('endpoint'):
        raise ValueError('Live call disabled / endpoint missing')
    url=source['endpoint']
    if not url.startswith('https://'):raise ValueError('HTTPS endpoint required')
    key=env(source.get('key_env',''))
    if not key or key.startswith('YOUR_'):raise ValueError('Missing API key: '+source['key_env'])
    params=dict(source.get('params',{}))
    for k,v in list(params.items()):
        if v=='{KEY}':params[k]=key
        elif v=='{DATE}':
            if not date_value:date_value=datetime.now(ZoneInfo("Asia/Seoul")).date().isoformat()
            params[k]=date_value.replace('-','')
        elif v=='{UTC_HOUR}':params[k]=datetime.now(timezone.utc).strftime('%Y%m%d%H00')
    if source.get('key_parameter') and source['key_parameter'] not in params:
        params[source['key_parameter']]=key
    with httpx.Client(timeout=25,follow_redirects=False) as client:
        r=client.get(url,params=params)
        r.raise_for_status()
        return r.text,r.status_code,r.headers.get('content-type','')
