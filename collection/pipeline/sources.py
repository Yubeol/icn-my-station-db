import json
from pathlib import Path
CONFIG = Path(__file__).resolve().parents[1] / 'config' / 'apis.json'
def load_sources():
    return {s['id']:s for s in json.loads(CONFIG.read_text(encoding='utf-8'))['sources']}
