-- Migration: Add parkrun_event_stats summary table
-- Avoids full-history scans of parkrun_results for weekly-summary's
-- first-visit/rare-visit/tourism calculations. Excludes hidden athletes,
-- matching the LEFT JOIN filter used elsewhere.

CREATE TABLE IF NOT EXISTS parkrun_event_stats (
    event_name TEXT PRIMARY KEY,
    first_seen TEXT NOT NULL,
    last_seen TEXT NOT NULL,
    distinct_dates INTEGER NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

-- One-time backfill from existing data (excluding hidden athletes)
INSERT INTO parkrun_event_stats (event_name, first_seen, last_seen, distinct_dates)
SELECT
    pr.event_name,
    MIN(pr.date) as first_seen,
    MAX(pr.date) as last_seen,
    COUNT(DISTINCT pr.date) as distinct_dates
FROM parkrun_results pr
LEFT JOIN parkrun_athletes pa ON pr.athlete_name = pa.athlete_name
WHERE (pa.is_hidden IS NULL OR pa.is_hidden = 0)
GROUP BY pr.event_name
ON CONFLICT(event_name) DO UPDATE SET
    first_seen = excluded.first_seen,
    last_seen = excluded.last_seen,
    distinct_dates = excluded.distinct_dates,
    updated_at = strftime('%s', 'now');
