-- Website visitor analytics (MAIN project)
-- Run this in the main FMT Supabase project's SQL editor.
--
-- Privacy notes:
--   * No raw IP address is ever stored. visitor_hash is
--     sha256(daily-rotating salt + ip + user agent), so the same person is
--     countable within a day but cannot be re-identified or tracked across
--     days, and the hash cannot be reversed to an IP.
--   * No cookies are set; session_id lives in sessionStorage and dies with
--     the tab.
--   * Raw rows are rolled up nightly and purged after the retention window.

CREATE TABLE IF NOT EXISTS public.page_views (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  path           text NOT NULL,
  referrer_host  text,
  session_id     uuid,
  visitor_hash   text,
  country        char(2),
  region         text,
  device         text,
  browser        text,
  os             text,
  utm_source     text,
  utm_medium     text,
  utm_campaign   text,
  screen_w       integer,
  lang           text
);

CREATE INDEX IF NOT EXISTS page_views_occurred_at_idx ON public.page_views (occurred_at DESC);
CREATE INDEX IF NOT EXISTS page_views_path_idx ON public.page_views (path, occurred_at DESC);
CREATE INDEX IF NOT EXISTS page_views_country_idx ON public.page_views (country, occurred_at DESC);
CREATE INDEX IF NOT EXISTS page_views_visitor_idx ON public.page_views (visitor_hash, occurred_at DESC);

-- Aggregated history, so raw rows can be discarded without losing reporting.
CREATE TABLE IF NOT EXISTS public.analytics_daily (
  day            date NOT NULL,
  path           text NOT NULL,
  views          integer NOT NULL DEFAULT 0,
  uniques        integer NOT NULL DEFAULT 0,
  country_json   jsonb NOT NULL DEFAULT '{}'::jsonb,
  referrer_json  jsonb NOT NULL DEFAULT '{}'::jsonb,
  device_json    jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (day, path)
);

CREATE INDEX IF NOT EXISTS analytics_daily_day_idx ON public.analytics_daily (day DESC);

-- Written by the backend's service-role client only; the browser posts through
-- the API and never touches these tables.
ALTER TABLE public.page_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_daily ENABLE ROW LEVEL SECURITY;
