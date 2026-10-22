CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('ADMIN', 'MANAGER', 'WORKER')),
  hourly_rate NUMERIC(12, 2) CHECK (hourly_rate IS NULL OR hourly_rate >= 0),
  building_id UUID,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE buildings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  latitude DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  radius_meters INTEGER NOT NULL DEFAULT 30 CHECK (radius_meters BETWEEN 1 AND 1000),
  time_zone TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE users ADD CONSTRAINT users_building_fk
  FOREIGN KEY (building_id) REFERENCES buildings(id) ON DELETE SET NULL;

CREATE TABLE attendance_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id UUID NOT NULL REFERENCES users(id),
  building_id UUID NOT NULL REFERENCES buildings(id),
  work_date DATE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('WORKING', 'BREAK', 'LUNCH', 'CHECKED_OUT')),
  checked_in_at TIMESTAMPTZ NOT NULL,
  paid_start_at TIMESTAMPTZ NOT NULL,
  checked_out_at TIMESTAMPTZ,
  checkout_reason TEXT,
  worked_ms BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((status = 'CHECKED_OUT') = (checked_out_at IS NOT NULL))
);

CREATE UNIQUE INDEX one_open_session_per_worker
  ON attendance_sessions(worker_id) WHERE checked_out_at IS NULL;
CREATE INDEX attendance_sessions_work_date_idx ON attendance_sessions(work_date, building_id);

CREATE TABLE unpaid_intervals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('BREAK', 'LUNCH')),
  reason TEXT,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);

CREATE UNIQUE INDEX one_open_interval_per_session
  ON unpaid_intervals(session_id) WHERE ended_at IS NULL;

CREATE TABLE geofence_pings (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
  latitude DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  accuracy_meters DOUBLE PRECISION,
  inside_geofence BOOLEAN NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX geofence_pings_session_time_idx ON geofence_pings(session_id, recorded_at);

CREATE TABLE attendance_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
  actor_id UUID NOT NULL REFERENCES users(id),
  event_type TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX attendance_events_session_time_idx ON attendance_events(session_id, occurred_at);