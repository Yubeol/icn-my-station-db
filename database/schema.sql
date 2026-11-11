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
