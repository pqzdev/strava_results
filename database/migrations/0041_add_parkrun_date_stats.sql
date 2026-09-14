-- Migration: Add parkrun_date_stats summary table
-- Avoids getParkrunByDate's GROUP BY pr.date scan of parkrun_results (tens
-- of thousands of rows for a multi-year range) on every unfiltered chart
-- load. Excludes hidden athletes, matching the LEFT JOIN filter used
-- elsewhere. Only covers the unfiltered (no athlete/event filter) case -
-- filtered requests still use the live query.

CREATE TABLE IF NOT EXISTS parkrun_date_stats (
    date TEXT PRIMARY KEY,
    run_count INTEGER NOT NULL,
    distinct_events INTEGER NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_parkrun_date_stats_date ON parkrun_date_stats(date);

-- One-time backfill from existing data (excluding hidden athletes)
INSERT INTO parkrun_date_stats (date, run_count, distinct_events)
SELECT
    pr.date,
    COUNT(*) as run_count,
    COUNT(DISTINCT pr.event_name) as distinct_events
FROM parkrun_results pr
LEFT JOIN parkrun_athletes pa ON pr.athlete_name = pa.athlete_name
WHERE (pa.is_hidden IS NULL OR pa.is_hidden = 0)
GROUP BY pr.date
ON CONFLICT(date) DO UPDATE SET
    run_count = excluded.run_count,
    distinct_events = excluded.distinct_events,
    updated_at = strftime('%s', 'now');
