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

// Keeps parkrun_date_stats in sync, scoped to only the dates touched by an
// import. Used by getParkrunByDate's unfiltered (no athlete/event filter)
// case to avoid a GROUP BY pr.date scan of parkrun_results on every chart
// load.
export async function updateDateStats(env: Env, dates: string[]): Promise<void> {
  const uniqueDates = [...new Set(dates)];
  if (uniqueDates.length === 0) return;

  const placeholders = uniqueDates.map(() => '?').join(', ');
  const statsQuery = await env.DB.prepare(
    `SELECT
       pr.date,
       COUNT(*) as run_count,
       COUNT(DISTINCT pr.event_name) as distinct_events
     FROM parkrun_results pr
     LEFT JOIN parkrun_athletes pa ON pr.athlete_name = pa.athlete_name
     WHERE pr.date IN (${placeholders})
       AND (pa.is_hidden IS NULL OR pa.is_hidden = 0)
     GROUP BY pr.date`
  ).bind(...uniqueDates).all<{ date: string; run_count: number; distinct_events: number }>();

  const rows = statsQuery.results || [];
  if (rows.length === 0) return;

  const statements = rows.map((row) =>
    env.DB.prepare(
      `INSERT INTO parkrun_date_stats (date, run_count, distinct_events)
       VALUES (?, ?, ?)
       ON CONFLICT(date) DO UPDATE SET
         run_count = excluded.run_count,
         distinct_events = excluded.distinct_events,
         updated_at = strftime('%s', 'now')`
    ).bind(row.date, row.run_count, row.distinct_events)
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

// Recomputes the single-row parkrun_global_stats summary, called after each
// import. Reads from parkrun_athlete_stats and parkrun_event_stats (small,
// already-maintained tables) rather than parkrun_results directly, so this
// stays cheap even though - unlike updateEventStats/updateAthleteStats - it
// recomputes club-wide totals rather than a scoped subset. The fastest-time
// and most-recent-result lookups still need one small point-query each
// against parkrun_results, scoped by the winning athlete_name/time or date.
export async function updateGlobalStats(env: Env): Promise<void> {
  const totals = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM parkrun_athlete_stats) as unique_athletes,
       (SELECT COUNT(*) FROM parkrun_event_stats) as unique_events,
       (SELECT SUM(total_runs) FROM parkrun_athlete_stats) as total_results,
       (SELECT MIN(first_seen) FROM parkrun_event_stats) as earliest_date,
       (SELECT MAX(last_seen) FROM parkrun_event_stats) as latest_date`
  ).first<{ unique_athletes: number; unique_events: number; total_results: number | null; earliest_date: string | null; latest_date: string | null }>();

  if (!totals) return;

  const fastestAthlete = await env.DB.prepare(
    `SELECT athlete_name, fastest_seconds, fastest_time_string FROM parkrun_athlete_stats
     WHERE fastest_seconds > 0 ORDER BY fastest_seconds ASC LIMIT 1`
  ).first<{ athlete_name: string; fastest_seconds: number; fastest_time_string: string }>();

  let fastestEventName: string | null = null;
  let fastestDate: string | null = null;
  if (fastestAthlete) {
    const fastestRow = await env.DB.prepare(
      `SELECT event_name, date FROM parkrun_results
       WHERE athlete_name = ? AND time_seconds = ? LIMIT 1`
    ).bind(fastestAthlete.athlete_name, fastestAthlete.fastest_seconds).first<{ event_name: string; date: string }>();
    fastestEventName = fastestRow?.event_name || null;
    fastestDate = fastestRow?.date || null;
  }

  const mostActive = await env.DB.prepare(
    `SELECT athlete_name, total_runs FROM parkrun_athlete_stats ORDER BY total_runs DESC LIMIT 1`
  ).first<{ athlete_name: string; total_runs: number }>();

  let mostRecentAthleteName: string | null = null;
  let mostRecentEventName: string | null = null;
  let mostRecentTimeString: string | null = null;
  if (totals.latest_date) {
    const mostRecentRow = await env.DB.prepare(
      `SELECT athlete_name, event_name, time_string FROM parkrun_results
       WHERE date = ? LIMIT 1`
    ).bind(totals.latest_date).first<{ athlete_name: string; event_name: string; time_string: string }>();
    mostRecentAthleteName = mostRecentRow?.athlete_name || null;
    mostRecentEventName = mostRecentRow?.event_name || null;
    mostRecentTimeString = mostRecentRow?.time_string || null;
  }

  await env.DB.prepare(
    `INSERT INTO parkrun_global_stats (
       id, total_results, unique_athletes, unique_events, earliest_date, latest_date,
       fastest_athlete_name, fastest_event_name, fastest_time_string, fastest_date,
       most_recent_athlete_name, most_recent_event_name, most_recent_time_string, most_recent_date,
       most_active_athlete_name, most_active_count
     )
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
       updated_at = strftime('%s', 'now')`
  ).bind(
    totals.total_results || 0,
    totals.unique_athletes,
    totals.unique_events,
    totals.earliest_date,
    totals.latest_date,
    fastestAthlete?.athlete_name || null,
    fastestEventName,
    fastestAthlete?.fastest_time_string || null,
    fastestDate,
    mostRecentAthleteName,
    mostRecentEventName,
    mostRecentTimeString,
    totals.latest_date,
    mostActive?.athlete_name || null,
    mostActive?.total_runs || null
  ).run();
}
