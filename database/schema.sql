    WHERE source_facility_key IS NOT NULL;

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

COMMIT;
