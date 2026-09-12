-- Migration: Add parkrun_athlete_stats summary table
-- Avoids a full unbounded GROUP BY scan of parkrun_results for the leaderboard's
-- default (unfiltered) case, which runs on every Parkrun page load. Excludes
-- rows with time_seconds = 0 (bad/missing times), matching the leaderboard's
-- existing WHERE clause. Does NOT reflect is_hidden (checked live, same as
-- parkrun_event_stats) or athlete/event/date filters - those still use the
-- live query in getParkrunLeaderboard.

CREATE TABLE IF NOT EXISTS parkrun_athlete_stats (
    athlete_name TEXT PRIMARY KEY,
    parkrun_athlete_id TEXT,
    total_runs INTEGER NOT NULL,
    distinct_events INTEGER NOT NULL,
    fastest_seconds INTEGER NOT NULL,
    fastest_time_string TEXT NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

-- One-time backfill from existing data. fastest_time_string is looked up in a
-- second pass (rather than as a correlated subquery against MIN() in the same
-- GROUP BY) to avoid relying on SQLite's handling of an aggregate inside a
-- correlated subquery's WHERE clause.
INSERT INTO parkrun_athlete_stats (athlete_name, parkrun_athlete_id, total_runs, distinct_events, fastest_seconds, fastest_time_string)
SELECT
    agg.athlete_name,
    (SELECT parkrun_athlete_id FROM parkrun_results
     WHERE athlete_name = agg.athlete_name AND parkrun_athlete_id IS NOT NULL LIMIT 1) as parkrun_athlete_id,
    agg.total_runs,
    agg.distinct_events,
    agg.fastest_seconds,
    (SELECT time_string FROM parkrun_results
     WHERE athlete_name = agg.athlete_name AND time_seconds = agg.fastest_seconds LIMIT 1) as fastest_time_string
FROM (
    SELECT
        pr.athlete_name,
        COUNT(*) as total_runs,
        COUNT(DISTINCT pr.event_name) as distinct_events,
        MIN(pr.time_seconds) as fastest_seconds
    FROM parkrun_results pr
    WHERE pr.time_seconds > 0
    GROUP BY pr.athlete_name
) agg
WHERE 1=1
ON CONFLICT(athlete_name) DO UPDATE SET
    parkrun_athlete_id = excluded.parkrun_athlete_id,
    total_runs = excluded.total_runs,
    distinct_events = excluded.distinct_events,
    fastest_seconds = excluded.fastest_seconds,
    fastest_time_string = excluded.fastest_time_string,
    updated_at = strftime('%s', 'now');
