-- Migration: Add parkrun_global_stats summary table (single row)
-- Avoids getParkrunStats running 6-7 full aggregate scans of parkrun_results
-- (200K+ rows each) on every unfiltered Parkrun page load. This table only
-- covers the unfiltered, all-time, non-hidden-athlete case - any request
-- with athlete/event/date filters still uses the live query.

CREATE TABLE IF NOT EXISTS parkrun_global_stats (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    total_results INTEGER NOT NULL,
    unique_athletes INTEGER NOT NULL,
    unique_events INTEGER NOT NULL,
    earliest_date TEXT,
    latest_date TEXT,
    fastest_athlete_name TEXT,
    fastest_event_name TEXT,
    fastest_time_string TEXT,
    fastest_date TEXT,
    most_recent_athlete_name TEXT,
    most_recent_event_name TEXT,
    most_recent_time_string TEXT,
    most_recent_date TEXT,
    most_active_athlete_name TEXT,
    most_active_count INTEGER,
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

-- One-time backfill from existing data (excluding hidden athletes)
INSERT INTO parkrun_global_stats (
    id, total_results, unique_athletes, unique_events, earliest_date, latest_date,
    fastest_athlete_name, fastest_event_name, fastest_time_string, fastest_date,
    most_recent_athlete_name, most_recent_event_name, most_recent_time_string, most_recent_date,
    most_active_athlete_name, most_active_count
)
SELECT
    1,
    (SELECT COUNT(*) FROM parkrun_results pr LEFT JOIN parkrun_athletes pa ON pr.athlete_name = pa.athlete_name WHERE (pa.is_hidden IS NULL OR pa.is_hidden = 0)),
    (SELECT COUNT(DISTINCT pr.athlete_name) FROM parkrun_results pr LEFT JOIN parkrun_athletes pa ON pr.athlete_name = pa.athlete_name WHERE (pa.is_hidden IS NULL OR pa.is_hidden = 0)),
    (SELECT COUNT(DISTINCT pr.event_name) FROM parkrun_results pr LEFT JOIN parkrun_athletes pa ON pr.athlete_name = pa.athlete_name WHERE (pa.is_hidden IS NULL OR pa.is_hidden = 0)),
    (SELECT MIN(pr.date) FROM parkrun_results pr LEFT JOIN parkrun_athletes pa ON pr.athlete_name = pa.athlete_name WHERE (pa.is_hidden IS NULL OR pa.is_hidden = 0)),
    (SELECT MAX(pr.date) FROM parkrun_results pr LEFT JOIN parkrun_athletes pa ON pr.athlete_name = pa.athlete_name WHERE (pa.is_hidden IS NULL OR pa.is_hidden = 0)),
    (SELECT pr.athlete_name FROM parkrun_results pr LEFT JOIN parkrun_athletes pa ON pr.athlete_name = pa.athlete_name WHERE (pa.is_hidden IS NULL OR pa.is_hidden = 0) ORDER BY pr.time_seconds ASC LIMIT 1),
    (SELECT pr.event_name FROM parkrun_results pr LEFT JOIN parkrun_athletes pa ON pr.athlete_name = pa.athlete_name WHERE (pa.is_hidden IS NULL OR pa.is_hidden = 0) ORDER BY pr.time_seconds ASC LIMIT 1),
    (SELECT pr.time_string FROM parkrun_results pr LEFT JOIN parkrun_athletes pa ON pr.athlete_name = pa.athlete_name WHERE (pa.is_hidden IS NULL OR pa.is_hidden = 0) ORDER BY pr.time_seconds ASC LIMIT 1),
    (SELECT pr.date FROM parkrun_results pr LEFT JOIN parkrun_athletes pa ON pr.athlete_name = pa.athlete_name WHERE (pa.is_hidden IS NULL OR pa.is_hidden = 0) ORDER BY pr.time_seconds ASC LIMIT 1),
    (SELECT pr.athlete_name FROM parkrun_results pr LEFT JOIN parkrun_athletes pa ON pr.athlete_name = pa.athlete_name WHERE (pa.is_hidden IS NULL OR pa.is_hidden = 0) ORDER BY pr.date DESC LIMIT 1),
    (SELECT pr.event_name FROM parkrun_results pr LEFT JOIN parkrun_athletes pa ON pr.athlete_name = pa.athlete_name WHERE (pa.is_hidden IS NULL OR pa.is_hidden = 0) ORDER BY pr.date DESC LIMIT 1),
    (SELECT pr.time_string FROM parkrun_results pr LEFT JOIN parkrun_athletes pa ON pr.athlete_name = pa.athlete_name WHERE (pa.is_hidden IS NULL OR pa.is_hidden = 0) ORDER BY pr.date DESC LIMIT 1),
    (SELECT pr.date FROM parkrun_results pr LEFT JOIN parkrun_athletes pa ON pr.athlete_name = pa.athlete_name WHERE (pa.is_hidden IS NULL OR pa.is_hidden = 0) ORDER BY pr.date DESC LIMIT 1),
    (SELECT pr.athlete_name FROM parkrun_results pr LEFT JOIN parkrun_athletes pa ON pr.athlete_name = pa.athlete_name WHERE (pa.is_hidden IS NULL OR pa.is_hidden = 0) GROUP BY pr.athlete_name ORDER BY COUNT(*) DESC LIMIT 1),
    (SELECT COUNT(*) FROM parkrun_results pr LEFT JOIN parkrun_athletes pa ON pr.athlete_name = pa.athlete_name WHERE (pa.is_hidden IS NULL OR pa.is_hidden = 0) GROUP BY pr.athlete_name ORDER BY COUNT(*) DESC LIMIT 1)
ON CONFLICT(id) DO UPDATE SET
    total_results = excluded.total_results,
    unique_athletes = excluded.unique_athletes,
    unique_events = excluded.unique_events,
    earliest_date = excluded.earliest_date,
    latest_date = excluded.latest_date,
    fastest_athlete_name = excluded.fastest_athlete_name,
    fastest_event_name = excluded.fastest_event_name,
    fastest_time_string = excluded.fastest_time_string,
    fastest_date = excluded.fastest_date,
    most_recent_athlete_name = excluded.most_recent_athlete_name,
    most_recent_event_name = excluded.most_recent_event_name,
    most_recent_time_string = excluded.most_recent_time_string,
    most_recent_date = excluded.most_recent_date,
    most_active_athlete_name = excluded.most_active_athlete_name,
    most_active_count = excluded.most_active_count,
    updated_at = strftime('%s', 'now');
