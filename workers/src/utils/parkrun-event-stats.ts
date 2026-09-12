// Keeps parkrun_event_stats in sync with parkrun_results, scoped to only the
// events touched by an import so cost stays proportional to import size
// rather than the full history of parkrun_results.

import { Env } from '../types';

export async function updateEventStats(env: Env, eventNames: string[]): Promise<void> {
  const uniqueNames = [...new Set(eventNames)];
  if (uniqueNames.length === 0) return;

  const placeholders = uniqueNames.map(() => '?').join(', ');
  const statsQuery = await env.DB.prepare(
    `SELECT
       pr.event_name,
       MIN(pr.date) as first_seen,
       MAX(pr.date) as last_seen,
       COUNT(DISTINCT pr.date) as distinct_dates
     FROM parkrun_results pr
     LEFT JOIN parkrun_athletes pa ON pr.athlete_name = pa.athlete_name
     WHERE pr.event_name IN (${placeholders})
       AND (pa.is_hidden IS NULL OR pa.is_hidden = 0)
     GROUP BY pr.event_name`
  ).bind(...uniqueNames).all<{ event_name: string; first_seen: string; last_seen: string; distinct_dates: number }>();

  const rows = statsQuery.results || [];
  if (rows.length === 0) return;

  const statements = rows.map((row) =>
    env.DB.prepare(
      `INSERT INTO parkrun_event_stats (event_name, first_seen, last_seen, distinct_dates)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(event_name) DO UPDATE SET
         first_seen = excluded.first_seen,
         last_seen = excluded.last_seen,
         distinct_dates = excluded.distinct_dates,
         updated_at = strftime('%s', 'now')`
    ).bind(row.event_name, row.first_seen, row.last_seen, row.distinct_dates)
  );

  await env.DB.batch(statements);
}

// Keeps parkrun_athlete_stats in sync, scoped to only the athletes touched by
// an import. Used by the leaderboard's default (unfiltered) case to avoid a
// full GROUP BY scan of parkrun_results on every page load.
export async function updateAthleteStats(env: Env, athleteNames: string[]): Promise<void> {
  const uniqueNames = [...new Set(athleteNames)];
  if (uniqueNames.length === 0) return;

  const placeholders = uniqueNames.map(() => '?').join(', ');
  const statsQuery = await env.DB.prepare(
    `SELECT
       pr.athlete_name,
       (SELECT parkrun_athlete_id FROM parkrun_results
        WHERE athlete_name = pr.athlete_name AND parkrun_athlete_id IS NOT NULL LIMIT 1) as parkrun_athlete_id,
       COUNT(*) as total_runs,
       COUNT(DISTINCT pr.event_name) as distinct_events,
       MIN(pr.time_seconds) as fastest_seconds
     FROM parkrun_results pr
     WHERE pr.athlete_name IN (${placeholders})
       AND pr.time_seconds > 0
     GROUP BY pr.athlete_name`
  ).bind(...uniqueNames).all<{ athlete_name: string; parkrun_athlete_id: string | null; total_runs: number; distinct_events: number; fastest_seconds: number }>();

  const rows = statsQuery.results || [];
  if (rows.length === 0) return;

  const statements: D1PreparedStatement[] = [];
  for (const row of rows) {
    const timeStringRow = await env.DB.prepare(
      `SELECT time_string FROM parkrun_results
       WHERE athlete_name = ? AND time_seconds = ? AND time_seconds > 0 LIMIT 1`
    ).bind(row.athlete_name, row.fastest_seconds).first<{ time_string: string }>();

    statements.push(
      env.DB.prepare(
        `INSERT INTO parkrun_athlete_stats
         (athlete_name, parkrun_athlete_id, total_runs, distinct_events, fastest_seconds, fastest_time_string)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(athlete_name) DO UPDATE SET
           parkrun_athlete_id = excluded.parkrun_athlete_id,
           total_runs = excluded.total_runs,
           distinct_events = excluded.distinct_events,
           fastest_seconds = excluded.fastest_seconds,
           fastest_time_string = excluded.fastest_time_string,
           updated_at = strftime('%s', 'now')`
      ).bind(row.athlete_name, row.parkrun_athlete_id, row.total_runs, row.distinct_events, row.fastest_seconds, timeStringRow?.time_string || '')
    );
  }

  await env.DB.batch(statements);
}
