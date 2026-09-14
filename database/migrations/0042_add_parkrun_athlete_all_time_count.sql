-- Migration: Add all_time_run_count to parkrun_athlete_stats
-- parkrun_athlete_stats.total_runs only counts rows with time_seconds > 0
-- (correct for leaderboard ranking, which needs a valid fastest time), but
-- getParkrunMilestones needs every run counted regardless of time validity.
-- Adds a separate column for that so the milestones fast path doesn't
-- silently undercount athletes with a bad-time (0:00) result in their
-- history.

ALTER TABLE parkrun_athlete_stats ADD COLUMN all_time_run_count INTEGER;

-- One-time backfill: single GROUP BY pass, applied via UPDATE...FROM so
-- existing rows (columns already correct from prior migrations) are only
-- ever updated, never re-inserted with placeholder values.
UPDATE parkrun_athlete_stats
SET all_time_run_count = agg.run_count
FROM (
    SELECT athlete_name, COUNT(*) as run_count
    FROM parkrun_results
    GROUP BY athlete_name
) agg
WHERE parkrun_athlete_stats.athlete_name = agg.athlete_name;
