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
