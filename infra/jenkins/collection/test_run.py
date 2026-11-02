import importlib.util
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location('collection_runner', Path(__file__).with_name('run.py'))
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


@pytest.fixture
def configured(monkeypatch, tmp_path):
    path = tmp_path / 'runtime.env'
    path.write_text('DB_HOST=db.example\nDB_NAME=airport\nDB_USER=collector\n'
                    'DB_PASSWORD=never-print-this\nPUBLIC_DATA_KEY=api-private-value\n', encoding='utf-8')
    monkeypatch.setenv('ICN_ENV_FILE', str(path))
    monkeypatch.setenv('APPLY', 'false')
    monkeypatch.setattr('sys.argv', ['run.py', '--sources', 'flights'])
    return monkeypatch


def fake_process(monkeypatch, code, output):
    captured = {}
    class Process:
        def __init__(self, command, **kwargs):
            captured.update(command=command, **kwargs)
            self.stdout = iter(output)
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def wait(self): return code
    monkeypatch.setattr(runner.subprocess, 'Popen', Process)
    return captured


def test_dry_run_masks_exception(configured, capsys):
    captured = fake_process(configured, 1, ['=== 1. COLLECT ===',
        'HTTPError https://api.example?key=api-private-value', 'never-print-this'])
    assert runner.main() == 1
    output = capsys.readouterr().out
    assert 'FAILED during COLLECT' in output
    assert 'api-private-value' not in output and 'never-print-this' not in output
    assert '--apply' not in captured['command']


@pytest.mark.parametrize('approved,target', [('false','db.example/airport'), ('true','wrong/db')])
def test_write_requires_matching_approved_target(configured, approved, target):
    configured.setenv('APPLY', 'true')
    configured.setenv('ICN_WRITE_APPROVED', approved)
    configured.setenv('TARGET_CONFIRMATION', target)
    captured = fake_process(configured, 0, [])
    assert runner.main() == 2
    assert not captured


def test_approved_write_is_bounded(configured):
    configured.setenv('APPLY', 'true')
    configured.setenv('ICN_WRITE_APPROVED', 'true')
    configured.setenv('TARGET_CONFIRMATION', 'db.example/airport')
    captured = fake_process(configured, 0, ['UPSERT ROWS: 2'])
    assert runner.main() == 0
    assert '--apply' in captured['command']
    assert captured['command'][captured['command'].index('--limit') + 1] == '10'


def test_mixed_sources_require_both_keys(configured):
    configured.setattr('sys.argv', ['run.py', '--sources', 'flights', 'metar'])
    captured = fake_process(configured, 0, [])
    assert runner.main() == 2
    assert not captured
