

BEGIN;
SET LOCAL search_path TO public;
SET TIME ZONE 'Asia/Seoul';

CREATE TABLE terminals (
    terminal_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    terminal_code text NOT NULL UNIQUE CHECK (terminal_code IN ('T1', 'T2', 'CONCOURSE')),
    terminal_name text NOT NULL CHECK (btrim(terminal_name) <> ''),
    -- Public data API terminal codes: P01=T1, P02=CONCOURSE, P03=T2.
    source_terminal_code text UNIQUE CHECK (source_terminal_code IN ('P01', 'P02', 'P03'))
);

CREATE TABLE airport_zones (
    zone_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    terminal_id bigint NOT NULL REFERENCES terminals (terminal_id),
    zone_code text NOT NULL CHECK (btrim(zone_code) <> ''),
    -- API hall identifier is opaque text; no assumed numeric range.
    hall_id text CHECK (hall_id IS NULL OR btrim(hall_id) <> ''),
    zone_name text NOT NULL,
    zone_type text NOT NULL,
    -- Departure hall number and raw congestion API gate identifier.
    hall_number integer CHECK (hall_number > 0),
    gate_id text CHECK (gate_id IS NULL OR btrim(gate_id) <> ''),
    -- For a detailed gate zone, points to its parent departure hall.
    parent_zone_id bigint,
    CHECK (zone_type <> 'departure_hall' OR hall_id IS NOT NULL),
    -- Detailed gates must have a parent hall; consistent with migration 002.
    CONSTRAINT airport_zones_gate_parent_ck CHECK (gate_id IS NULL OR parent_zone_id IS NOT NULL),
    CONSTRAINT airport_zones_terminal_hall_uq UNIQUE (terminal_id, hall_id),
    CONSTRAINT airport_zones_terminal_code_uq UNIQUE (terminal_id, zone_code),
    -- Composite target used to enforce facility/zone terminal consistency.
    CONSTRAINT airport_zones_id_terminal_uq UNIQUE (zone_id, terminal_id),
    -- A gate zone can only point to a parent zone in the same terminal.
    CONSTRAINT airport_zones_parent_terminal_fk
        FOREIGN KEY (parent_zone_id, terminal_id)
        REFERENCES airport_zones (zone_id, terminal_id)
);

CREATE UNIQUE INDEX airport_zones_terminal_gate_id_uq
    ON airport_zones (terminal_id, gate_id)
    WHERE gate_id IS NOT NULL;

CREATE TABLE api_collection_runs (
    source text NOT NULL CHECK (source IN ('api', 'yolo', 'demo')),
    collection_run_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    UNIQUE (collection_run_id, source),
    api_identifier text NOT NULL CHECK (btrim(api_identifier) <> ''),
    started_at timestamptz NOT NULL,
    completed_at timestamptz,
    succeeded boolean,
    collected_count bigint NOT NULL DEFAULT 0 CHECK (collected_count >= 0),
    error_message text,
    CHECK (completed_at IS NULL OR completed_at >= started_at),
    CHECK ((completed_at IS NULL AND succeeded IS NULL)
        OR (completed_at IS NOT NULL AND succeeded IS NOT NULL))
);
CREATE INDEX api_collection_runs_api_started_idx
    ON api_collection_runs (api_identifier, started_at DESC);

CREATE TABLE passenger_forecasts (
    source text NOT NULL CHECK (source IN ('api', 'yolo', 'demo')),
    passenger_forecast_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    target_date date NOT NULL,
    -- Canonical source slot label; format/duration require API verification.
    time_slot text NOT NULL CHECK (btrim(time_slot) <> ''),
    zone_id bigint NOT NULL REFERENCES airport_zones (zone_id),
    flow_type text NOT NULL CHECK (flow_type IN ('arrival', 'departure')),
    expected_passenger_count bigint NOT NULL CHECK (expected_passenger_count >= 0),
    collected_at timestamptz NOT NULL,
    collection_run_id bigint NOT NULL,
    FOREIGN KEY (collection_run_id, source) REFERENCES api_collection_runs (collection_run_id, source),
    CONSTRAINT passenger_forecasts_business_uq
        UNIQUE (target_date, time_slot, zone_id, flow_type, source)
);
CREATE INDEX passenger_forecasts_zone_date_idx ON passenger_forecasts (zone_id, target_date);
CREATE INDEX passenger_forecasts_run_idx ON passenger_forecasts (collection_run_id);

CREATE TABLE congestion_snapshots (
    source text NOT NULL CHECK (source IN ('api', 'yolo', 'demo')),
    congestion_snapshot_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    zone_id bigint NOT NULL REFERENCES airport_zones (zone_id),
    -- Canonical minute bucket; preserve source timestamp separately.
    measured_at timestamptz NOT NULL CHECK (EXTRACT(SECOND FROM measured_at) = 0),
    source_measured_at timestamptz,
    waiting_passenger_count bigint NOT NULL CHECK (waiting_passenger_count >= 0),
    -- Raw API waitTime (including values such as 60+) and operatingTime.
    wait_time_raw text,
    operating_time text,
    -- YOLO counts are estimates; provenance must accompany the value.
    estimation_basis jsonb CHECK (jsonb_typeof(estimation_basis) = 'object'),
    CHECK (source <> 'yolo' OR estimation_basis IS NOT NULL),
    collected_at timestamptz NOT NULL,
    collection_run_id bigint NOT NULL,
    FOREIGN KEY (collection_run_id, source) REFERENCES api_collection_runs (collection_run_id, source),
    -- This UNIQUE constraint also creates the requested (zone_id, measured_at) index.
    CONSTRAINT congestion_snapshots_zone_measured_uq UNIQUE (zone_id, measured_at, source)
);
CREATE INDEX congestion_snapshots_zone_origin_collected_idx
    ON congestion_snapshots (zone_id, source, collected_at DESC);
CREATE INDEX congestion_snapshots_run_idx ON congestion_snapshots (collection_run_id);

CREATE TABLE flight_operations (
    source text NOT NULL CHECK (source IN ('api', 'yolo', 'demo')),
    flight_uid bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    UNIQUE (flight_uid, source),
    source_api_identifier text NOT NULL CHECK (btrim(source_api_identifier) <> ''),
    -- Stable per-operation source ID or an agreed canonical key, never flight number alone.
    source_flight_id text NOT NULL CHECK (btrim(source_flight_id) <> ''),
    flight_number text NOT NULL,
    airline_code text,
    airline_name text,
    flow_type text NOT NULL CHECK (flow_type IN ('arrival', 'departure')),
    departure_airport_code text,
    arrival_airport_code text,
    scheduled_at timestamptz,
    estimated_at timestamptz,
    actual_at timestamptz,
    terminal_id bigint REFERENCES terminals (terminal_id),
    gate text,
    check_in_counter text,
    status text NOT NULL DEFAULT 'unknown' CHECK (status IN
        ('scheduled', 'boarding', 'delayed', 'cancelled', 'departed', 'arrived', 'diverted', 'unknown')),
    -- NULL means absent API status, not an unrecognized nonempty API code.
    source_status text CHECK (source_status IS NULL OR btrim(source_status) <> ''),
    status_basis jsonb CHECK (jsonb_typeof(status_basis) = 'object'),
    -- Missing source status + any inferred known status requires structured evidence.
    CHECK (source_status IS NOT NULL OR status = 'unknown' OR status_basis IS NOT NULL),
    source_updated_at timestamptz,
    last_collected_at timestamptz NOT NULL,
    collection_run_id bigint NOT NULL,
    FOREIGN KEY (collection_run_id, source) REFERENCES api_collection_runs (collection_run_id, source),
    CONSTRAINT flight_operations_source_uq UNIQUE (source_api_identifier, source_flight_id, source),
    -- Optional source fields; NULL means not yet supplied/verified.
    is_codeshare boolean,
    master_flight_number text,
    master_source_flight_id text,
    departure_airport_name text,
    arrival_airport_name text,
    departure_city_name text,
    arrival_city_name text,
    codeshare_type text CHECK (codeshare_type IN ('Master', 'Slave')),
    source_terminal_code text
);
CREATE INDEX flight_operations_terminal_schedule_idx ON flight_operations (terminal_id, scheduled_at);
CREATE INDEX flight_operations_number_schedule_idx ON flight_operations (flight_number, scheduled_at);
CREATE INDEX flight_operations_run_idx ON flight_operations (collection_run_id);

-- Append one snapshot for every collection, including unchanged status.
-- Retain at least 7 days by collected_at; no automatic expiry/deletion is installed.
CREATE TABLE flight_operation_history (
    flight_operation_history_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    flight_uid bigint NOT NULL,
    source text NOT NULL CHECK (source IN ('api', 'yolo', 'demo')),
    collected_at timestamptz NOT NULL,
    source_updated_at timestamptz,
    flight_number text NOT NULL,
    airline_code text,
    airline_name text,
    flow_type text NOT NULL CHECK (flow_type IN ('arrival', 'departure')),
    departure_airport_code text,
    arrival_airport_code text,
    scheduled_at timestamptz,
    estimated_at timestamptz,
    actual_at timestamptz,
    terminal_id bigint REFERENCES terminals (terminal_id),
    gate text,
    check_in_counter text,
    source_status text CHECK (source_status IS NULL OR btrim(source_status) <> ''),
    status text NOT NULL CHECK (status IN
        ('scheduled', 'boarding', 'delayed', 'cancelled', 'departed', 'arrived', 'diverted', 'unknown')),
    status_basis jsonb CHECK (jsonb_typeof(status_basis) = 'object'),
    CHECK (source_status IS NOT NULL OR status = 'unknown' OR status_basis IS NOT NULL),
    collection_run_id bigint NOT NULL,
    FOREIGN KEY (flight_uid, source) REFERENCES flight_operations (flight_uid, source),
    FOREIGN KEY (collection_run_id, source) REFERENCES api_collection_runs (collection_run_id, source),
    CONSTRAINT flight_operation_history_flight_collected_uq UNIQUE (flight_uid, collected_at),
    -- Optional source fields; NULL means not yet supplied/verified.
    is_codeshare boolean,
    master_flight_number text,
    master_source_flight_id text,
    departure_airport_name text,
    arrival_airport_name text,
    departure_city_name text,
    arrival_city_name text,
    codeshare_type text CHECK (codeshare_type IN ('Master', 'Slave')),
    source_terminal_code text
);
-- UNIQUE index supports backward scans for per-flight as-of lookup.
CREATE INDEX flight_operation_history_origin_collected_idx
    ON flight_operation_history (source, collected_at DESC);
CREATE INDEX flight_operation_history_terminal_schedule_idx
    ON flight_operation_history (terminal_id, scheduled_at);
CREATE INDEX flight_operation_history_run_idx ON flight_operation_history (collection_run_id);
COMMENT ON TABLE flight_operation_history IS
    'Immutable collection snapshots; retain at least 7 days by collected_at. No automated purge. Backend writes raw and standardized status; database does not map status or infer delay.';

CREATE TABLE flight_status_history (
    source text NOT NULL CHECK (source IN ('api', 'yolo', 'demo')),
    flight_status_history_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    flight_uid bigint NOT NULL,
    FOREIGN KEY (flight_uid, source) REFERENCES flight_operations (flight_uid, source),
    changed_at timestamptz NOT NULL,
    change_time_basis text NOT NULL CHECK (change_time_basis IN ('source', 'first_observed')),
    previous_status text CHECK (previous_status IN
        ('scheduled', 'boarding', 'delayed', 'cancelled', 'departed', 'arrived', 'diverted', 'unknown')),
    new_status text NOT NULL CHECK (new_status IN
        ('scheduled', 'boarding', 'delayed', 'cancelled', 'departed', 'arrived', 'diverted', 'unknown')),
    previous_gate text,
    new_gate text,
    previous_source_status text,
    new_source_status text,
    previous_scheduled_at timestamptz,
    new_scheduled_at timestamptz,
    previous_estimated_at timestamptz,
    new_estimated_at timestamptz,
    previous_actual_at timestamptz,
    new_actual_at timestamptz,
    collected_at timestamptz NOT NULL,
    collection_run_id bigint NOT NULL,
    FOREIGN KEY (collection_run_id, source) REFERENCES api_collection_runs (collection_run_id, source),
    CONSTRAINT flight_status_history_change_ck CHECK (
        previous_status IS DISTINCT FROM new_status
        OR previous_gate IS DISTINCT FROM new_gate
        OR previous_source_status IS DISTINCT FROM new_source_status
        OR previous_scheduled_at IS DISTINCT FROM new_scheduled_at
        OR previous_estimated_at IS DISTINCT FROM new_estimated_at
        OR previous_actual_at IS DISTINCT FROM new_actual_at
    )
);
CREATE INDEX flight_status_history_flight_changed_idx
    ON flight_status_history (flight_uid, changed_at DESC);
CREATE INDEX flight_status_history_run_idx ON flight_status_history (collection_run_id);

CREATE TABLE weather_observations (
    source text NOT NULL CHECK (source IN ('api', 'yolo', 'demo')),
    weather_observation_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    airport_icao text NOT NULL CHECK (airport_icao ~ '^[A-Z]{4}$'),
    observed_at timestamptz NOT NULL,
    wind_direction_degrees numeric(5,2) CHECK (wind_direction_degrees >= 0 AND wind_direction_degrees <= 360),
    wind_speed_mps numeric(8,2) CHECK (wind_speed_mps >= 0 AND wind_speed_mps < 'Infinity'::numeric),
    wind_gust_mps numeric(8,2) CHECK (wind_gust_mps >= 0 AND wind_gust_mps < 'Infinity'::numeric),
    temperature_c numeric(6,2) CHECK (temperature_c > '-Infinity'::numeric AND temperature_c < 'Infinity'::numeric),
    pressure_hpa numeric(8,2) CHECK (pressure_hpa > 0 AND pressure_hpa < 'Infinity'::numeric),
    visibility_km numeric(10,2) CHECK (visibility_km >= 0 AND visibility_km < 'Infinity'::numeric),
    collected_at timestamptz NOT NULL,
    collection_run_id bigint NOT NULL,
    FOREIGN KEY (collection_run_id, source) REFERENCES api_collection_runs (collection_run_id, source),
    CONSTRAINT weather_observations_airport_observed_uq UNIQUE (airport_icao, observed_at, source),
    -- Optional source fields; NULL means not yet supplied/verified.
    weather_phenomena text
);
CREATE INDEX weather_observations_run_idx ON weather_observations (collection_run_id);

CREATE TABLE takeoff_weather_forecasts (
    source text NOT NULL CHECK (source IN ('api', 'yolo', 'demo')),
    takeoff_weather_forecast_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    airport_icao text NOT NULL CHECK (airport_icao ~ '^[A-Z]{4}$'),
    forecast_type text NOT NULL CHECK (btrim(forecast_type) <> ''),
    -- Source tmFc is valid_at; NULL when issuance time is unverified.
    issued_at timestamptz,
    valid_at timestamptz NOT NULL,
    wind_direction_degrees numeric(5,2) CHECK (wind_direction_degrees >= 0 AND wind_direction_degrees <= 360),
    wind_speed_mps numeric(8,2) CHECK (wind_speed_mps >= 0 AND wind_speed_mps < 'Infinity'::numeric),
    temperature_c numeric(6,2) CHECK (temperature_c > '-Infinity'::numeric AND temperature_c < 'Infinity'::numeric),
    pressure_hpa numeric(8,2) CHECK (pressure_hpa > 0 AND pressure_hpa < 'Infinity'::numeric),
    collected_at timestamptz NOT NULL,
    collection_run_id bigint NOT NULL,
    FOREIGN KEY (collection_run_id, source) REFERENCES api_collection_runs (collection_run_id, source),
    CONSTRAINT takeoff_weather_forecasts_business_uq UNIQUE (airport_icao, forecast_type, issued_at, valid_at, source)
);
-- PostgreSQL 14 UNIQUE permits multiple NULLs; prevent duplicates in unknown-issued case.
CREATE UNIQUE INDEX takeoff_weather_forecasts_null_issue_uq
    ON takeoff_weather_forecasts (airport_icao, forecast_type, valid_at, source)
    WHERE issued_at IS NULL;
CREATE INDEX takeoff_weather_forecasts_airport_valid_idx ON takeoff_weather_forecasts (airport_icao, valid_at);
CREATE INDEX takeoff_weather_forecasts_run_idx ON takeoff_weather_forecasts (collection_run_id);

CREATE TABLE airport_facilities (
    facility_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    facility_name text NOT NULL,
    -- These source attributes can be unknown until API classification is verified.
    facility_type text,
    terminal_id bigint REFERENCES terminals (terminal_id),
    zone_id bigint,
    floor_label text,
    location_description text,
    opening_hours_note text,
    CONSTRAINT airport_facilities_zone_terminal_fk FOREIGN KEY (zone_id, terminal_id)
        REFERENCES airport_zones (zone_id, terminal_id),
    -- Optional source fields; NULL means not yet supplied/verified.
    products_description text,
    arrival_departure_area text,
    phone_number text,
    source_api_identifier text,
    source_facility_key text,
    -- If a zone is known, its terminal must be known too.
    CONSTRAINT airport_facilities_zone_requires_terminal_ck
        CHECK (zone_id IS NULL OR terminal_id IS NOT NULL)
);
CREATE INDEX airport_facilities_terminal_type_idx ON airport_facilities (terminal_id, facility_type);
CREATE INDEX airport_facilities_zone_terminal_idx ON airport_facilities (zone_id, terminal_id);
-- A regular UNIQUE index supports ON CONFLICT (source_facility_key).
-- PostgreSQL 14 allows multiple NULL values under a regular UNIQUE index.
CREATE UNIQUE INDEX airport_facilities_source_facility_key_uq
    ON airport_facilities (source_facility_key);

-- Weekly recurring local wall-clock intervals, not timestamps of actual events.
-- ISO weekday: Monday=1 ... Sunday=7; local timezone Asia/Seoul.
CREATE TABLE facility_opening_hours (
    facility_opening_hour_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    facility_id bigint NOT NULL REFERENCES airport_facilities (facility_id),
    iso_weekday smallint NOT NULL CHECK (iso_weekday BETWEEN 1 AND 7),
    opens_minute smallint NOT NULL CHECK (opens_minute BETWEEN 0 AND 1439),
    closes_minute smallint NOT NULL CHECK (closes_minute BETWEEN 1 AND 1440),
    CHECK (opens_minute < closes_minute),
    CONSTRAINT facility_opening_hours_interval_uq UNIQUE (facility_id, iso_weekday, opens_minute, closes_minute)
);

CREATE TABLE facility_crowd_estimates (
    source text NOT NULL CHECK (source IN ('api', 'yolo', 'demo')),
    facility_crowd_estimate_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    facility_id bigint NOT NULL REFERENCES airport_facilities (facility_id),
    estimated_at timestamptz NOT NULL,
    crowd_level text NOT NULL CHECK (crowd_level IN ('low', 'moderate', 'high')),
    estimation_basis jsonb NOT NULL CHECK (jsonb_typeof(estimation_basis) = 'object'),
    collection_run_id bigint,
    FOREIGN KEY (collection_run_id, source) REFERENCES api_collection_runs (collection_run_id, source),
    CONSTRAINT facility_crowd_estimates_facility_time_uq UNIQUE (facility_id, estimated_at, source)
);
CREATE INDEX facility_crowd_estimates_run_idx ON facility_crowd_estimates (collection_run_id);

CREATE TABLE smart_alerts (
    source text NOT NULL CHECK (source IN ('api', 'yolo', 'demo')),
    alert_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    alert_type text NOT NULL CHECK (btrim(alert_type) <> ''),
    severity text NOT NULL CHECK (severity IN ('info', 'important', 'critical')),
    title text NOT NULL,
    message text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    zone_id bigint REFERENCES airport_zones (zone_id),
    flight_uid bigint,
    FOREIGN KEY (flight_uid, source) REFERENCES flight_operations (flight_uid, source),
    previous_value jsonb,
    current_value jsonb,
    unit text,
    dedupe_key text NOT NULL CHECK (btrim(dedupe_key) <> ''),
    CONSTRAINT smart_alerts_dedupe_uq UNIQUE (dedupe_key, source)
);
CREATE INDEX smart_alerts_zone_created_idx ON smart_alerts (zone_id, created_at DESC);
CREATE INDEX smart_alerts_flight_created_idx ON smart_alerts (flight_uid, created_at DESC);
CREATE INDEX smart_alerts_created_idx ON smart_alerts (created_at DESC);

CREATE TABLE daily_flight_summary (
    daily_flight_summary_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source text NOT NULL CHECK (source IN ('api', 'yolo', 'demo')),
    target_date date NOT NULL,
    terminal_id bigint NOT NULL REFERENCES terminals (terminal_id),
    flow_type text NOT NULL CHECK (flow_type IN ('arrival', 'departure')),
    normal_flight_count bigint NOT NULL CHECK (normal_flight_count >= 0),
    delayed_flight_count bigint NOT NULL CHECK (delayed_flight_count >= 0),
    cancelled_flight_count bigint NOT NULL CHECK (cancelled_flight_count >= 0),
    diverted_flight_count bigint NOT NULL CHECK (diverted_flight_count >= 0),
    total_flight_count bigint NOT NULL CHECK (total_flight_count >= 0),
    -- Unclassified flights remain in total; numeric casts avoid bigint sum overflow.
    CHECK (normal_flight_count::numeric + delayed_flight_count::numeric
        + cancelled_flight_count::numeric + diverted_flight_count::numeric <= total_flight_count::numeric),
    -- target_date = (scheduled_at AT TIME ZONE 'Asia/Seoul')::date.
    -- flow_type is direction; replace all counts from latest flights, never increment.
    -- API status takes priority; absent status uses the internal >=15-minute delay rule.
    aggregation_basis jsonb NOT NULL CHECK (jsonb_typeof(aggregation_basis) = 'object'),
    as_of_at timestamptz NOT NULL,
    collection_run_id bigint,
    FOREIGN KEY (collection_run_id, source) REFERENCES api_collection_runs (collection_run_id, source),
    CONSTRAINT daily_flight_summary_business_uq UNIQUE (target_date, terminal_id, flow_type, source)
);
CREATE INDEX daily_flight_summary_terminal_date_idx ON daily_flight_summary (terminal_id, target_date);
CREATE INDEX daily_flight_summary_run_idx ON daily_flight_summary (collection_run_id);

-- Reference data only: not fabricated passenger or flight observations.
INSERT INTO terminals (terminal_code, terminal_name, source_terminal_code) VALUES
    ('T1', '제1여객터미널', 'P01'),
    ('T2', '제2여객터미널', 'P03'),
    ('CONCOURSE', '탑승동', 'P02');

COMMENT ON COLUMN public.airport_zones.gate_id
    IS 'Raw congestion API gateId (e.g. DG3_E, DG1_A).';
COMMENT ON COLUMN public.airport_zones.hall_number
    IS 'Departure hall number; NULL when unverified.';
COMMENT ON COLUMN public.airport_zones.parent_zone_id
    IS 'Parent zone (departure hall) within the same terminal.';
COMMENT ON COLUMN public.congestion_snapshots.waiting_passenger_count
    IS 'API waitLength normalized to the people count.';
COMMENT ON COLUMN public.congestion_snapshots.wait_time_raw
    IS 'Raw API waitTime in minutes; can contain values such as 60+.';
COMMENT ON COLUMN public.congestion_snapshots.operating_time
    IS 'Raw API operatingTime; keep as text until verified.';
COMMENT ON COLUMN public.flight_operations.source_flight_id
    IS 'Source flight fid; flight_uid is the internal PK.';
COMMENT ON COLUMN public.flight_operations.codeshare_type
    IS 'Raw codeshare type: Master or Slave.';
COMMENT ON COLUMN public.flight_operations.source_terminal_code
    IS 'Raw terminalId: P01/P02/P03.';
COMMENT ON COLUMN public.takeoff_weather_forecasts.issued_at
    IS 'NULL when issuance time is unverified; tmFc corresponds to valid_at.';
COMMENT ON COLUMN public.takeoff_weather_forecasts.valid_at
    IS 'API tmFc: UTC forecast target time as TIMESTAMPTZ.';
COMMENT ON COLUMN public.takeoff_weather_forecasts.wind_speed_mps
    IS 'API ws in knots, converted to m/s by collection pipeline.';
COMMENT ON COLUMN public.takeoff_weather_forecasts.pressure_hpa
    IS 'API qnh in 0.01 inHg, converted to hPa by collector.';
COMMENT ON COLUMN public.airport_facilities.source_facility_key
    IS 'Source-specific stable deduplication key. Non-NULL values must be unique.';
COMMENT ON COLUMN public.weather_observations.visibility_km
    IS 'Visibility in kilometers (km). Collection pipeline converts source units to km.';

-- Persist timezone for future connections to this database.
ALTER DATABASE airport_dashboard SET timezone TO 'Asia/Seoul';

COMMENT ON COLUMN public.flight_operations.is_codeshare IS 'TRUE: codeshare, FALSE: confirmed master flight, NULL: not yet verified.';
COMMENT ON COLUMN public.flight_operations.master_source_flight_id IS 'Master operation UNIQ code from the same source API. Mapping requires API verification.';
COMMENT ON COLUMN public.flight_operation_history.is_codeshare IS 'Codeshare classification at collection time. NULL means not yet verified.';
COMMENT ON COLUMN public.flight_operation_history.master_source_flight_id IS 'Master operation UNIQ code at collection time, from the same source API.';
COMMENT ON COLUMN public.airport_facilities.products_description IS 'Source description of products/services. Structured classification is not yet defined.';
COMMENT ON COLUMN public.airport_facilities.arrival_departure_area IS 'Source label for arrival/departure area. Preserve original text until mapping is agreed.';
COMMENT ON COLUMN public.airport_facilities.phone_number IS 'Phone number as text, preserving leading zeros, country code and separators.';
COMMENT ON COLUMN public.weather_observations.weather_phenomena IS 'Source weather phenomenon code/text. Preserve original representation until mapping is agreed.';

-- YOLO extension (2026-11-11): camera metadata, 30-second people aggregates,
-- and detected event review workflow. No frames or bounding boxes are stored.
-- Independent of Jenkins collection runs; do not mix camera people counts with
-- public-API waiting_passenger_count without explicit mapping and provenance.

CREATE TABLE public.demo_yolo_cameras (
    camera_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    zone_id bigint NOT NULL REFERENCES public.airport_zones (zone_id),
    name text NOT NULL UNIQUE CHECK (btrim(name) <> ''),
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX demo_yolo_cameras_zone_idx
    ON public.demo_yolo_cameras (zone_id);

CREATE TABLE public.demo_yolo_counts (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    camera_id bigint NOT NULL REFERENCES public.demo_yolo_cameras (camera_id),
    bucket_start timestamptz NOT NULL,
    person_avg numeric(10,2) NOT NULL CHECK (person_avg >= 0),
    person_max integer NOT NULL CHECK (person_max >= 0),
    sample_count integer NOT NULL CHECK (sample_count > 0),
    crowd_level text CHECK (crowd_level IN ('LOW', 'MID', 'HIGH')),
    model_version text NOT NULL CHECK (btrim(model_version) <> ''),
    CONSTRAINT demo_yolo_counts_avg_max_ck CHECK (person_avg <= person_max),
    CONSTRAINT demo_yolo_counts_camera_bucket_uq UNIQUE (camera_id, bucket_start)
);
COMMENT ON TABLE public.demo_yolo_counts IS
    'Worker 30-second buckets of camera-detected people. Estimates, not official airport waiting counts. INSERT ON CONFLICT DO NOTHING.';
COMMENT ON COLUMN public.demo_yolo_counts.crowd_level IS
    'LOW/MID/HIGH or NULL when no reliable classification; threshold logic belongs to the worker/backend contract.';
CREATE INDEX demo_yolo_counts_bucket_idx
    ON public.demo_yolo_counts (bucket_start DESC);

CREATE TABLE public.demo_yolo_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    camera_id bigint NOT NULL REFERENCES public.demo_yolo_cameras (camera_id),
    event_type text NOT NULL CHECK (btrim(event_type) <> ''),
    confidence numeric(5,4) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    detected_at timestamptz NOT NULL,
    model_version text NOT NULL CHECK (btrim(model_version) <> ''),
    review_status text NOT NULL DEFAULT 'PENDING'
        CHECK (review_status IN ('PENDING', 'CONFIRMED', 'FALSE_POSITIVE')),
    reviewed_at timestamptz,
    dedupe_key text NOT NULL UNIQUE CHECK (btrim(dedupe_key) <> ''),
    CONSTRAINT demo_yolo_events_review_time_ck CHECK (
        (review_status = 'PENDING' AND reviewed_at IS NULL)
        OR (review_status <> 'PENDING' AND reviewed_at IS NOT NULL)
    )
);
COMMENT ON TABLE public.demo_yolo_events IS
    'YOLO inference events. No image/frame/bounding-box payloads. Review only updates review_status and reviewed_at.';
CREATE INDEX demo_yolo_events_camera_detected_idx
    ON public.demo_yolo_events (camera_id, detected_at DESC);
CREATE INDEX demo_yolo_events_review_detected_idx
    ON public.demo_yolo_events (review_status, detected_at DESC);

COMMIT;
