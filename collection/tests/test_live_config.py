from pipeline.sources import load_sources
from pipeline.collector import extract_records

def test_nested_item_list():
 s=load_sources()['congestion_t1']
 body='{"response":{"header":{"resultCode":"00"},"body":{"items":{"item":[{"gateId":"DG1_W","occurtime":"202610281100","waitLength":"30"}]}}}}'
 out=extract_records(body,s)
 assert len(out)==1 and out[0]['gateId']=='DG1_W'

def test_nested_items_are_list():
 s=load_sources()['congestion_t1']
 body='{"response":{"header":{"resultCode":"00"},"body":{"items":[{"item":[{"gateId":"DG1_W"}]}]}}}'
 assert extract_records(body,s)[0]['gateId']=='DG1_W'
