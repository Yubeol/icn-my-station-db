"""Run the existing collector without exposing raw API/SQL exception text."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys

from dotenv import dotenv_values
from sqlalchemy.engine import URL

SOURCES = {'congestion_t1', 'congestion_t2', 'flights', 'passenger_forecast',
           'takeoff_forecast', 'facilities', 'metar'}
ROOT = Path(__file__).resolve().parents[3]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--sources', nargs='+', required=True, choices=sorted(SOURCES))
    args = parser.parse_args()
    apply = os.environ.get('APPLY', 'false').lower() == 'true'
    env_path = os.environ.get('ICN_ENV_FILE')
    if not env_path or not Path(env_path).is_file():
        print('CONFIGURATION FAILED: Jenkins credential file is unavailable.')
        return 2
    values = dotenv_values(env_path, interpolate=False)
    required = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD']
    if 'metar' in args.sources:
        required.append('KMA_API_KEY')
    if any(source != 'metar' for source in args.sources):
        required.append('PUBLIC_DATA_KEY')
    if any(not values.get(key) for key in required):
        print('CONFIGURATION FAILED: required database or API fields are missing.')
        return 2
    child_env = dict(os.environ)
    child_env.pop('DATABASE_URL', None)
    for key in required + ['DB_PORT', 'DB_SSLMODE', 'PUBLIC_DATA_KEY', 'KMA_API_KEY']:
        if values.get(key):
            child_env[key] = values[key]
    child_env['DB_SSLMODE'] = values.get('DB_SSLMODE') or 'require'
    if child_env['DB_SSLMODE'] not in {'require', 'verify-ca', 'verify-full'}:
        print('CONFIGURATION FAILED: SSL must be enabled.')
        return 2
    try:
        port = int(values.get('DB_PORT') or '5432')
        limit = int(os.environ.get('ROW_LIMIT', '10'))
        budget = int(os.environ.get('MAX_REQUESTS', '35'))
        if not 1 <= port <= 65535 or limit < 1 or budget < 1:
            raise ValueError()
    except ValueError:
        print('CONFIGURATION FAILED: invalid port or execution limits.')
        return 2
    expected_target = values['DB_HOST'] + '/' + values['DB_NAME']
    scheduled = os.environ.get('ICN_SCHEDULED') == 'true'
    if scheduled:
        try:
            policy = json.loads(Path(os.environ['ICN_POLICY_FILE']).read_text(encoding='utf-8'))
            job = policy['jobs'][os.environ['JOB_NAME']]
            if (policy['target'] != expected_target
                    or policy['port'] != port or policy['user'] != values['DB_USER']
                    or job['enabled'] is not True or job['validated'] is not True
                    or job['sources'] != args.sources or not job['approval_reference']
                    or not job['quota_reference']
                    or type(job['max_requests']) is not int or job['max_requests'] < 1):
                raise ValueError()
            if 'metar' in args.sources and not job.get('cadence_reference'):
                raise ValueError()
            budget = job['max_requests']
            limit = None  # Scheduled production runs process the complete result.
            apply = True
        except (KeyError, OSError, ValueError, TypeError):
            print('BLOCKED: scheduled job lacks a matching validated operating policy.')
            return 2
    if apply and not scheduled and (os.environ.get('ICN_WRITE_APPROVED') != 'true'
                  or os.environ.get('TARGET_CONFIRMATION') != expected_target):
        print('BLOCKED: approval or exact target confirmation missing.')
        return 2
    # An explicit URL prevents a repository .env or inherited setting from changing the target.
    child_env['DATABASE_URL'] = URL.create(
        'postgresql+psycopg', username=values['DB_USER'], password=values['DB_PASSWORD'],
        host=values['DB_HOST'], port=port, database=values['DB_NAME'],
        query={'sslmode': child_env['DB_SSLMODE']},
    ).render_as_string(hide_password=False)
    child_env['PYTHONUNBUFFERED'] = '1'
    command = [sys.executable, '-m', 'collection.pipeline.jobs', '--sources', *args.sources]
    command += ['--max-requests', str(budget)]
    if limit is not None:
        command += ['--limit', str(limit)]
    if apply:
        command.append('--apply')
    phase = 'START'
    with subprocess.Popen(command, cwd=ROOT, env=child_env, stdout=subprocess.PIPE,
                          stderr=subprocess.STDOUT, text=True, encoding='utf-8', errors='replace') as process:
        for line in process.stdout:
            line = line.strip()
            # Only fixed stage labels and numeric counts are released to the console.
            stage = re.fullmatch(r'=== [1-5]\. (COLLECT|NORMALIZE|METAR PARSING|VALIDATE JSONL|POSTGRESQL) ===', line)
            if stage:
                phase = stage.group(1)
                print('PHASE:', phase, flush=True)
            elif re.fullmatch(r'(INPUT ROWS|UNIQUE ROWS|UPSERT ROWS|COLLECTION RUN ID): \d+', line):
                print(line, flush=True)
        result = process.wait()
    mode = 'apply' if apply else 'dry-run'
    print('RESULT:', f'SUCCESS ({mode})' if result == 0 else f'FAILED during {phase}; exit={result}')
    return result


if __name__ == '__main__':
    raise SystemExit(main())
