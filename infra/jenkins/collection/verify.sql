-- Read-only preflight and recent run evidence. Does not repair/alter the database.
BEGIN READ ONLY;
SET LOCAL TIME ZONE 'Asia/Seoul';
SET LOCAL statement_timeout = '15s';
SELECT current_database() AS database_name, current_user AS database_user, now() AS checked_at;

SELECT collection_run_id, api_identifier, source, started_at, completed_at,
       succeeded, collected_count
FROM public.api_collection_runs
WHERE started_at >= now() - interval '24 hours'
ORDER BY collection_run_id DESC LIMIT 100;

-- Review unique/partial indexes against postgres_storage.py CONFLICT_KEYS.
-- Facilities needs a matching unique source_facility_key index.
-- Takeoff NULL issued_at needs the corresponding partial unique index.
SELECT tablename, indexname, indexdef FROM pg_indexes
WHERE schemaname = 'public' AND tablename IN (
    'congestion_snapshots', 'passenger_forecasts', 'flight_operations',
    'weather_observations', 'takeoff_weather_forecasts', 'airport_facilities'
) ORDER BY tablename, indexname;

-- A NOT VALID constraint does not prove historic rows satisfy the constraint.
SELECT conrelid::regclass AS table_name, conname, contype, convalidated
FROM pg_constraint
WHERE connamespace = 'public'::regnamespace AND contype IN ('f', 'u', 'c')
ORDER BY conrelid::regclass::text, conname;

SELECT 'congestion_snapshots' AS table_name, count(*) AS api_rows,
       max(collected_at) AS latest_collection, max(measured_at) AS latest_source_time
FROM public.congestion_snapshots WHERE source = 'api'
UNION ALL
SELECT 'weather_observations', count(*), max(collected_at), max(observed_at)
FROM public.weather_observations WHERE source = 'api';

SELECT zone_id, measured_at, source, count(*) AS duplicates
FROM public.congestion_snapshots GROUP BY zone_id, measured_at, source HAVING count(*) > 1;
SELECT count(*) AS invalid_congestion_rows
FROM public.congestion_snapshots c LEFT JOIN public.airport_zones z USING (zone_id)
WHERE c.source = 'api' AND (z.zone_id IS NULL OR c.measured_at IS NULL
    OR c.waiting_passenger_count IS NULL OR c.collection_run_id IS NULL);
ROLLBACK;
