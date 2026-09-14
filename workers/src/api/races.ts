// API endpoints for fetching race data

import { Env } from '../types';

// Distance categories with meters and buffer
const DISTANCE_CATEGORIES: { [key: string]: { minMeters: number; maxMeters: number } } = {
  '5K': { minMeters: 4800, maxMeters: 5200 },
  '10K': { minMeters: 9700, maxMeters: 10300 },
  '14K': { minMeters: 13700, maxMeters: 14300 },
  'Half Marathon': { minMeters: 20800, maxMeters: 21600 },
  '30K': { minMeters: 29500, maxMeters: 30500 },
  'Marathon': { minMeters: 41700, maxMeters: 43200 },
  'Ultra': { minMeters: 43200, maxMeters: 999999 },
};

interface RaceFilterParams {
  athleteNames: string[];
  eventNames: string[];
  activityName: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  distanceCategories: string[];
  minDistance: number | null;
  maxDistance: number | null;
  viewerAthleteId: string | null;
  showHidden: boolean;
  isViewerAdmin: boolean;
}

function parseRaceFilterParams(url: URL): RaceFilterParams {
  const minDistanceParam = url.searchParams.get('min_distance');
  const maxDistanceParam = url.searchParams.get('max_distance');
  return {
    athleteNames: url.searchParams.getAll('athlete'),
    eventNames: url.searchParams.getAll('event'),
    activityName: url.searchParams.get('activity_name'),
    dateFrom: url.searchParams.get('date_from'),
    dateTo: url.searchParams.get('date_to'),
    distanceCategories: url.searchParams.getAll('distance'),
    minDistance: minDistanceParam ? parseFloat(minDistanceParam) : null,
    maxDistance: maxDistanceParam ? parseFloat(maxDistanceParam) : null,
    viewerAthleteId: url.searchParams.get('viewer_athlete_id'),
    showHidden: url.searchParams.get('show_hidden') === 'true',
    isViewerAdmin: false, // filled in by caller after checking admin status
  };
}

// Builds the shared WHERE clause (and bindings) used by getRaces' main query,
// its count query, and the athlete-summary aggregate query, so the three
// stay in sync instead of duplicating (and risking drift in) the same filter
// logic three times.
function buildRaceWhereClause(f: RaceFilterParams): { where: string; bindings: any[] } {
  let where = `WHERE (a.is_hidden = 0 OR a.id IS NULL)`;
  const bindings: any[] = [];

  if (!f.showHidden) {
    where += ` AND r.is_hidden = 0`;
  } else if (!f.isViewerAdmin && f.viewerAthleteId) {
    where += ` AND (r.is_hidden = 0 OR a.strava_id = ?)`;
    bindings.push(parseInt(f.viewerAthleteId));
  }

  if (f.athleteNames.length > 0) {
    const athleteConditions = f.athleteNames.map(() => `(a.firstname || ' ' || a.lastname) = ?`).join(' OR ');
    where += ` AND (${athleteConditions})`;
    f.athleteNames.forEach(name => bindings.push(name));
  }

  if (f.eventNames.length > 0) {
    const eventConditions = f.eventNames.map(() => `r.event_name = ?`).join(' OR ');
    where += ` AND (${eventConditions})`;
    f.eventNames.forEach(name => bindings.push(name));
  }

  if (f.activityName) {
    where += ` AND r.name LIKE ?`;
    bindings.push(`%${f.activityName}%`);
  }

  if (f.dateFrom) {
    where += ` AND r.date >= ?`;
    bindings.push(f.dateFrom);
  }

  if (f.dateTo) {
    where += ` AND r.date <= ?`;
    bindings.push(f.dateTo);
  }

  if (f.distanceCategories.length > 0) {
    const hasOther = f.distanceCategories.includes('Other');
    const selectedCategories = f.distanceCategories.filter(c => c !== 'Other');
    const distanceConditions: string[] = [];

    selectedCategories.forEach(category => {
      const range = DISTANCE_CATEGORIES[category];
      if (range) {
        distanceConditions.push(
          `(COALESCE(re.manual_distance, r.manual_distance, r.distance) >= ? AND COALESCE(re.manual_distance, r.manual_distance, r.distance) <= ?)`
        );
        bindings.push(range.minMeters, range.maxMeters);
      }
    });

    if (hasOther) {
      const allRanges = Object.values(DISTANCE_CATEGORIES);
      const otherConditions = allRanges.map(() =>
        `(COALESCE(re.manual_distance, r.manual_distance, r.distance) < ? OR COALESCE(re.manual_distance, r.manual_distance, r.distance) > ?)`
      );
      distanceConditions.push(`(${otherConditions.join(' AND ')})`);
      allRanges.forEach(range => bindings.push(range.minMeters, range.maxMeters));
    }

    if (distanceConditions.length > 0) {
      where += ` AND (${distanceConditions.join(' OR ')})`;
    }
  } else if (f.minDistance !== null || f.maxDistance !== null) {
    if (f.minDistance !== null && f.minDistance > 0) {
      where += ` AND COALESCE(re.manual_distance, r.manual_distance, r.distance) >= ?`;
      bindings.push(f.minDistance);
    }
    if (f.maxDistance !== null && f.maxDistance < 999999) {
      where += ` AND COALESCE(re.manual_distance, r.manual_distance, r.distance) <= ?`;
      bindings.push(f.maxDistance);
    }
  }

  return { where, bindings };
}

/**
 * GET /api/races - Get recent races with filtering
 */
export async function getRaces(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const limit = parseInt(url.searchParams.get('limit') || '50');
  const offset = parseInt(url.searchParams.get('offset') || '0');
  const filterParams = parseRaceFilterParams(url);

  // Check if viewer is admin
  if (filterParams.viewerAthleteId) {
    const adminCheck = await env.DB.prepare(
      'SELECT is_admin FROM athletes WHERE strava_id = ?'
    ).bind(parseInt(filterParams.viewerAthleteId)).first<{ is_admin: number }>();
    filterParams.isViewerAdmin = adminCheck?.is_admin === 1;
  }

  try {
    const { where, bindings } = buildRaceWhereClause(filterParams);

    // Build query with filters - JOIN with race_edits to get manual overrides
    const query = `
      SELECT
        r.id,
        r.strava_activity_id,
        r.name,
        r.description,
        r.distance,
        r.elapsed_time,
        r.moving_time,
        COALESCE(re.manual_time, r.manual_time) as manual_time,
        COALESCE(re.manual_distance, r.manual_distance) as manual_distance,
        r.event_name,
        r.date,
        r.elevation_gain,
        r.average_heartrate,
        r.max_heartrate,
        r.polyline,
        r.athlete_id,
        r.is_hidden,
        a.firstname,
        a.lastname,
        a.profile_photo,
        a.strava_id
      FROM races r
      LEFT JOIN athletes a ON r.athlete_id = a.id
      LEFT JOIN race_edits re ON r.strava_activity_id = re.strava_activity_id AND r.athlete_id = re.athlete_id
      ${where}
      ORDER BY r.date DESC LIMIT ? OFFSET ?
    `;

    const result = await env.DB.prepare(query).bind(...bindings, limit, offset).all();

    // Get total count for pagination
    const countQuery = `
      SELECT COUNT(*) as total
      FROM races r
      LEFT JOIN athletes a ON r.athlete_id = a.id
      LEFT JOIN race_edits re ON r.strava_activity_id = re.strava_activity_id AND r.athlete_id = re.athlete_id
      ${where}
    `;

    const countResult = await env.DB.prepare(countQuery)
      .bind(...bindings)
      .first<{ total: number }>();

    return new Response(
      JSON.stringify({
        races: result.results,
        pagination: {
          total: countResult?.total || 0,
          limit,
          offset,
        },
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (error) {
    console.error('Error fetching races:', error);
    return new Response(
      JSON.stringify({
        error: 'Failed to fetch races',
        details: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

/**
 * GET /api/races/athlete-summary - Per-athlete aggregates (count, total
 * distance/time, average pace) for the current race filters. Replicates
 * AthleteSummary.tsx's client-side reduce() in SQL so the frontend no longer
 * needs to fetch up to 10,000 full race rows (polylines included) just to
 * compute these per-athlete totals.
 */
export async function getRaceAthleteSummary(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const filterParams = parseRaceFilterParams(url);

  if (filterParams.viewerAthleteId) {
    const adminCheck = await env.DB.prepare(
      'SELECT is_admin FROM athletes WHERE strava_id = ?'
    ).bind(parseInt(filterParams.viewerAthleteId)).first<{ is_admin: number }>();
    filterParams.isViewerAdmin = adminCheck?.is_admin === 1;
  }

  try {
    // AthleteSummary.tsx always excludes hidden races client-side (via
    // race.is_hidden), regardless of the showHidden toggle that controls the
    // raw race list's visibility. Force showHidden: false here so this
    // aggregate matches that behavior exactly.
    const { where, bindings } = buildRaceWhereClause({ ...filterParams, showHidden: false });

    const query = `
      SELECT
        a.firstname,
        a.lastname,
        a.profile_photo,
        COUNT(*) as activity_count,
        SUM(COALESCE(re.manual_distance, r.manual_distance, r.distance)) as total_distance,
        SUM(COALESCE(re.manual_time, r.manual_time, r.moving_time)) as total_time
      FROM races r
      LEFT JOIN athletes a ON r.athlete_id = a.id
      LEFT JOIN race_edits re ON r.strava_activity_id = re.strava_activity_id AND r.athlete_id = re.athlete_id
      ${where}
      GROUP BY r.athlete_id
      ORDER BY activity_count DESC
    `;

    const result = await env.DB.prepare(query).bind(...bindings).all<{
      firstname: string;
      lastname: string;
      profile_photo: string | null;
      activity_count: number;
      total_distance: number;
      total_time: number;
    }>();

    const athletes = (result.results || []).map((row) => {
      const averagePace = row.total_distance > 0 ? (row.total_time / 60) / (row.total_distance / 1000) : 0;
      return {
        athleteName: `${row.firstname} ${row.lastname}`,
        profilePhoto: row.profile_photo || undefined,
        activityCount: row.activity_count,
        totalDistance: row.total_distance,
        totalTime: row.total_time,
        averagePace,
      };
    });

    return new Response(
      JSON.stringify({ athletes }),
      { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
    );
  } catch (error) {
    console.error('Error fetching race athlete summary:', error);
    return new Response(
      JSON.stringify({
        error: 'Failed to fetch race athlete summary',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
    );
  }
}

/**
 * GET /api/stats - Get aggregate statistics
 */
export async function getStats(env: Env): Promise<Response> {
  console.log('[STATS API] Fetching statistics...');
  try {
    // Get various statistics (exclude hidden races and hidden athletes)

    // General race stats - exclude hidden athletes AND hidden races
    const athleteCount = await env.DB.prepare(
      'SELECT COUNT(*) as count FROM athletes WHERE is_hidden = 0'
    ).first<{ count: number }>();
    console.log('[STATS API] Athletes query result:', JSON.stringify(athleteCount));

    const raceCount = await env.DB.prepare(
      `SELECT COUNT(*) as count FROM races r
       LEFT JOIN athletes a ON r.athlete_id = a.id
       WHERE (a.is_hidden = 0 OR a.id IS NULL) AND r.is_hidden = 0`
    ).first<{ count: number }>();
    console.log('[STATS API] Races query result:', JSON.stringify(raceCount));

    const totalDistance = await env.DB.prepare(
      `SELECT SUM(r.distance) as total FROM races r
       LEFT JOIN athletes a ON r.athlete_id = a.id
       WHERE (a.is_hidden = 0 OR a.id IS NULL) AND r.is_hidden = 0`
    ).first<{ total: number }>();
    console.log('[STATS API] Total distance query result:', JSON.stringify(totalDistance));

    // Parkrun stats - exclude hidden athletes
    const parkrunAthletes = await env.DB.prepare(
      `SELECT COUNT(DISTINCT pr.athlete_name) as count
       FROM parkrun_results pr
       LEFT JOIN parkrun_athletes pa ON pr.athlete_name = pa.athlete_name
       WHERE (pa.is_hidden IS NULL OR pa.is_hidden = 0)`
    ).first<{ count: number }>();
    console.log('[STATS API] Parkrun athletes query result:', JSON.stringify(parkrunAthletes));

    const parkrunResults = await env.DB.prepare(
      `SELECT COUNT(*) as count
       FROM parkrun_results pr
       LEFT JOIN parkrun_athletes pa ON pr.athlete_name = pa.athlete_name
       WHERE (pa.is_hidden IS NULL OR pa.is_hidden = 0)`
    ).first<{ count: number }>();
    console.log('[STATS API] Parkrun results query result:', JSON.stringify(parkrunResults));

    const parkrunEvents = await env.DB.prepare(
      `SELECT COUNT(DISTINCT pr.event_name) as count
       FROM parkrun_results pr
       LEFT JOIN parkrun_athletes pa ON pr.athlete_name = pa.athlete_name
       WHERE (pa.is_hidden IS NULL OR pa.is_hidden = 0)`
    ).first<{ count: number }>();
    console.log('[STATS API] Parkrun events query result:', JSON.stringify(parkrunEvents));

    const responseData = {
      athletes: athleteCount?.count || 0,
      total_races: raceCount?.count || 0,
      total_distance_km: Math.round((totalDistance?.total || 0) / 1000),
      parkrun_athletes: parkrunAthletes?.count || 0,
      parkrun_results: parkrunResults?.count || 0,
      parkrun_events: parkrunEvents?.count || 0,
    };

    console.log('[STATS API] Returning response:', JSON.stringify(responseData));

    return new Response(
      JSON.stringify(responseData),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (error) {
    console.error('[STATS API] Error fetching stats:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to fetch statistics' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

/**
 * PATCH /api/races/:id/time - Update manual time for a race
 */
export async function updateRaceTime(
  request: Request,
  env: Env,
  raceId: number
): Promise<Response> {
  try {
    const body = await request.json() as { manual_time: number | null; athlete_strava_id: number };
    console.log(`[updateRaceTime] Received request for raceId=${raceId}`, body);

    // Verify the athlete owns this race
    const race = await env.DB.prepare(
      `SELECT r.athlete_id, r.strava_activity_id, a.strava_id
       FROM races r
       JOIN athletes a ON r.athlete_id = a.id
       WHERE r.id = ?`
    )
      .bind(raceId)
      .first<{ athlete_id: number; strava_activity_id: number; strava_id: number }>();

    console.log(`[updateRaceTime] Race lookup result:`, race);

    if (!race) {
      console.log(`[updateRaceTime] Race ${raceId} not found`);
      return new Response(
        JSON.stringify({ error: 'Race not found' }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Check if the user is an admin
    const requestingAthlete = await env.DB.prepare(
      'SELECT is_admin FROM athletes WHERE strava_id = ?'
    ).bind(body.athlete_strava_id).first<{ is_admin: number }>();

    const isAdmin = requestingAthlete?.is_admin === 1;
    console.log(`[updateRaceTime] Requesting athlete isAdmin=${isAdmin}, race.strava_id=${race.strava_id}, body.athlete_strava_id=${body.athlete_strava_id}`);

    // Verify athlete owns this race OR is an admin
    if (!isAdmin && race.strava_id !== body.athlete_strava_id) {
      console.log(`[updateRaceTime] Unauthorized: athlete ${body.athlete_strava_id} cannot edit race owned by ${race.strava_id}`);
      return new Response(
        JSON.stringify({ error: 'Unauthorized: You can only edit your own race times' }),
        {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Insert or update race_edits table
    if (body.manual_time === null) {
      // Remove the edit (revert to original)
      console.log(`[updateRaceTime] Deleting edit for strava_activity_id=${race.strava_activity_id}, athlete_id=${race.athlete_id}`);
      await env.DB.prepare(
        `DELETE FROM race_edits WHERE strava_activity_id = ? AND athlete_id = ?`
      )
        .bind(race.strava_activity_id, race.athlete_id)
        .run();

      // Also clear legacy column in races table
      await env.DB.prepare(
        `UPDATE races SET manual_time = NULL WHERE strava_activity_id = ? AND athlete_id = ?`
      )
        .bind(race.strava_activity_id, race.athlete_id)
        .run();
    } else {
      // Upsert the manual time
      console.log(`[updateRaceTime] Upserting manual_time=${body.manual_time} for strava_activity_id=${race.strava_activity_id}, athlete_id=${race.athlete_id}`);
      const result = await env.DB.prepare(
        `INSERT INTO race_edits (strava_activity_id, athlete_id, manual_time, edited_at)
         VALUES (?, ?, ?, strftime('%s', 'now'))
         ON CONFLICT(strava_activity_id, athlete_id)
         DO UPDATE SET manual_time = excluded.manual_time, edited_at = excluded.edited_at`
      )
        .bind(race.strava_activity_id, race.athlete_id, body.manual_time)
        .run();
      console.log(`[updateRaceTime] Upsert result:`, result);
    }

    console.log(`[updateRaceTime] Successfully updated race ${raceId}`);

    return new Response(
      JSON.stringify({ success: true }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (error) {
    console.error('Error updating race time:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to update race time' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

/**
 * PATCH /api/races/:id/distance - Update manual distance for a race
 */
export async function updateRaceDistance(
  request: Request,
  env: Env,
  raceId: number
): Promise<Response> {
  try {
    const body = await request.json() as { manual_distance: number | null; athlete_strava_id: number };

    // Verify the athlete owns this race
    const race = await env.DB.prepare(
      `SELECT r.athlete_id, r.strava_activity_id, a.strava_id
       FROM races r
       JOIN athletes a ON r.athlete_id = a.id
       WHERE r.id = ?`
    )
      .bind(raceId)
      .first<{ athlete_id: number; strava_activity_id: number; strava_id: number }>();

    if (!race) {
      return new Response(
        JSON.stringify({ error: 'Race not found' }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Check if the user is an admin
    const requestingAthlete = await env.DB.prepare(
      'SELECT is_admin FROM athletes WHERE strava_id = ?'
    ).bind(body.athlete_strava_id).first<{ is_admin: number }>();

    const isAdmin = requestingAthlete?.is_admin === 1;

    // Verify athlete owns this race OR is an admin
    if (!isAdmin && race.strava_id !== body.athlete_strava_id) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized: You can only edit your own race distances' }),
        {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Insert or update race_edits table
    if (body.manual_distance === null) {
      // Remove the edit (revert to original)
      await env.DB.prepare(
        `DELETE FROM race_edits WHERE strava_activity_id = ? AND athlete_id = ?`
      )
        .bind(race.strava_activity_id, race.athlete_id)
        .run();

      // Also clear legacy column in races table
      await env.DB.prepare(
        `UPDATE races SET manual_distance = NULL WHERE strava_activity_id = ? AND athlete_id = ?`
      )
        .bind(race.strava_activity_id, race.athlete_id)
        .run();
    } else {
      // Upsert the manual distance
      await env.DB.prepare(
        `INSERT INTO race_edits (strava_activity_id, athlete_id, manual_distance, edited_at)
         VALUES (?, ?, ?, strftime('%s', 'now'))
         ON CONFLICT(strava_activity_id, athlete_id)
         DO UPDATE SET manual_distance = excluded.manual_distance, edited_at = excluded.edited_at`
      )
        .bind(race.strava_activity_id, race.athlete_id, body.manual_distance)
        .run();
    }

    return new Response(
      JSON.stringify({ success: true }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (error) {
    console.error('Error updating race distance:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to update race distance' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

/**
 * PATCH /api/races/:id/event - Update event name for a race
 */
export async function updateRaceEvent(
  request: Request,
  env: Env,
  raceId: number
): Promise<Response> {
  try {
    const body = await request.json() as { event_name: string | null; admin_strava_id: number };

    // Verify the race exists
    const race = await env.DB.prepare(
      `SELECT r.id, r.athlete_id, r.strava_activity_id
       FROM races r
       WHERE r.id = ?`
    )
      .bind(raceId)
      .first<{ id: number; athlete_id: number; strava_activity_id: number }>();

    if (!race) {
      return new Response(
        JSON.stringify({ error: 'Race not found' }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Check if the user is an admin
    const requestingAthlete = await env.DB.prepare(
      'SELECT is_admin FROM athletes WHERE strava_id = ?'
    ).bind(body.admin_strava_id).first<{ is_admin: number }>();

    const isAdmin = requestingAthlete?.is_admin === 1;

    // Only admins can edit event names
    if (!isAdmin) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized: Only admins can edit event names' }),
        {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Update the event_name directly in the races table
    await env.DB.prepare(
      `UPDATE races SET event_name = ? WHERE id = ?`
    )
      .bind(body.event_name, raceId)
      .run();

    // Also save to persistent mapping table so it survives full syncs (only if athlete_id exists)
    if (race.athlete_id) {
      if (body.event_name) {
        await env.DB.prepare(
          `INSERT INTO activity_event_mappings (strava_activity_id, athlete_id, event_name, is_hidden, updated_at)
           VALUES (?, ?, ?, COALESCE((SELECT is_hidden FROM activity_event_mappings WHERE strava_activity_id = ? AND athlete_id = ?), 0), strftime('%s', 'now'))
           ON CONFLICT(strava_activity_id, athlete_id)
           DO UPDATE SET event_name = excluded.event_name, updated_at = excluded.updated_at`
        )
          .bind(race.strava_activity_id, race.athlete_id, body.event_name, race.strava_activity_id, race.athlete_id)
          .run();
      } else {
        // If event_name is being cleared, only update the event_name to NULL but keep is_hidden
        await env.DB.prepare(
          `INSERT INTO activity_event_mappings (strava_activity_id, athlete_id, event_name, is_hidden, updated_at)
           VALUES (?, ?, NULL, COALESCE((SELECT is_hidden FROM races WHERE strava_activity_id = ? AND athlete_id = ?), 0), strftime('%s', 'now'))
           ON CONFLICT(strava_activity_id, athlete_id)
           DO UPDATE SET event_name = NULL, updated_at = excluded.updated_at`
        )
          .bind(race.strava_activity_id, race.athlete_id, race.strava_activity_id, race.athlete_id)
          .run();
      }
    }

    return new Response(
      JSON.stringify({ success: true }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (error) {
    console.error('Error updating race event:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to update race event' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

/**
 * PATCH /api/races/:id/visibility - Toggle race visibility (hide/show)
 */
export async function updateRaceVisibility(
  request: Request,
  env: Env,
  raceId: number
): Promise<Response> {
  try {
    const body = await request.json() as { is_hidden: boolean; athlete_strava_id: number };

    // Verify the athlete owns this race
    const race = await env.DB.prepare(
      `SELECT r.athlete_id, r.strava_activity_id, a.strava_id
       FROM races r
       JOIN athletes a ON r.athlete_id = a.id
       WHERE r.id = ?`
    )
      .bind(raceId)
      .first<{ athlete_id: number; strava_activity_id: number; strava_id: number }>();

    if (!race) {
      return new Response(
        JSON.stringify({ error: 'Race not found' }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Check if the user is an admin
    const requestingAthlete = await env.DB.prepare(
      'SELECT is_admin FROM athletes WHERE strava_id = ?'
    ).bind(body.athlete_strava_id).first<{ is_admin: number }>();

    const isAdmin = requestingAthlete?.is_admin === 1;

    // Verify athlete owns this race OR is an admin
    if (!isAdmin && race.strava_id !== body.athlete_strava_id) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized: You can only hide your own races' }),
        {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Update visibility in races table
    await env.DB.prepare(
      `UPDATE races SET is_hidden = ? WHERE id = ?`
    )
      .bind(body.is_hidden ? 1 : 0, raceId)
      .run();

    // Persist visibility to mapping table so it survives full syncs
    if (race.athlete_id) {
      await env.DB.prepare(
        `INSERT INTO activity_event_mappings (strava_activity_id, athlete_id, event_name, is_hidden, updated_at)
         VALUES (?, ?, COALESCE((SELECT event_name FROM activity_event_mappings WHERE strava_activity_id = ? AND athlete_id = ?), ''), ?, strftime('%s', 'now'))
         ON CONFLICT(strava_activity_id, athlete_id)
         DO UPDATE SET is_hidden = excluded.is_hidden, updated_at = excluded.updated_at`
      )
        .bind(race.strava_activity_id, race.athlete_id, race.strava_activity_id, race.athlete_id, body.is_hidden ? 1 : 0)
        .run();
    }

    return new Response(
      JSON.stringify({ success: true, is_hidden: body.is_hidden }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (error) {
    console.error('Error updating race visibility:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to update race visibility' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

/**
 * POST /api/races/:id/fetch-description - Fetch description for a single activity
 */
export async function fetchRaceDescription(
  request: Request,
  env: Env,
  raceId: number
): Promise<Response> {
  try {
    const body = await request.json() as { strava_activity_id: number; athlete_strava_id: number };

    // Verify the athlete owns this race or is admin
    const race = await env.DB.prepare(
      `SELECT r.athlete_id, r.strava_activity_id, a.strava_id, a.access_token
       FROM races r
       JOIN athletes a ON r.athlete_id = a.id
       WHERE r.id = ?`
    )
      .bind(raceId)
      .first<{ athlete_id: number; strava_activity_id: number; strava_id: number; access_token: string }>();

    if (!race) {
      return new Response(
        JSON.stringify({ error: 'Race not found' }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Check if the user is an admin
    const requestingAthlete = await env.DB.prepare(
      'SELECT is_admin FROM athletes WHERE strava_id = ?'
    ).bind(body.athlete_strava_id).first<{ is_admin: number }>();

    const isAdmin = requestingAthlete?.is_admin === 1;

    // Verify athlete owns this race OR is an admin
    if (!isAdmin && race.strava_id !== body.athlete_strava_id) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized: You can only fetch descriptions for your own activities' }),
        {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Fetch detailed activity from Strava
    const { fetchDetailedActivity } = await import('../utils/db');
    const detailed = await fetchDetailedActivity(race.strava_activity_id, race.access_token);

    // Update the race with the fetched description
    await env.DB.prepare(
      `UPDATE races SET description = ? WHERE id = ?`
    )
      .bind(detailed.description || null, raceId)
      .run();

    return new Response(
      JSON.stringify({
        success: true,
        description: detailed.description || null,
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (error) {
    console.error('Error fetching race description:', error);
    return new Response(
      JSON.stringify({
        error: 'Failed to fetch race description',
        details: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

/**
 * GET /api/races/filter-options - Distinct visible athlete/event names and
 * the earliest race date, for the Dashboard's filter dropdowns. Replaces
 * three separate full-row /api/races?limit=10000 (or limit=1000) fetches
 * that only used them to derive these small distinct lists client-side.
 */
export async function getRaceFilterOptions(env: Env): Promise<Response> {
  try {
    const athletesResult = await env.DB.prepare(
      `SELECT DISTINCT a.firstname, a.lastname
       FROM races r
       JOIN athletes a ON r.athlete_id = a.id
       WHERE a.is_hidden = 0 AND r.is_hidden = 0
       ORDER BY a.firstname, a.lastname`
    ).all<{ firstname: string; lastname: string }>();

    const eventsResult = await env.DB.prepare(
      `SELECT DISTINCT r.event_name
       FROM races r
       JOIN athletes a ON r.athlete_id = a.id
       WHERE a.is_hidden = 0 AND r.is_hidden = 0 AND r.event_name IS NOT NULL
       ORDER BY r.event_name`
    ).all<{ event_name: string }>();

    const earliestResult = await env.DB.prepare(
      `SELECT MIN(r.date) as earliest
       FROM races r
       JOIN athletes a ON r.athlete_id = a.id
       WHERE a.is_hidden = 0 AND r.is_hidden = 0`
    ).first<{ earliest: string | null }>();

    return new Response(
      JSON.stringify({
        athletes: (athletesResult.results || []).map((r) => `${r.firstname} ${r.lastname}`),
        events: (eventsResult.results || []).map((r) => r.event_name),
        earliestDate: earliestResult?.earliest ? earliestResult.earliest.split('T')[0] : null,
      }),
      { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
    );
  } catch (error) {
    console.error('Error fetching race filter options:', error);
    return new Response(
      JSON.stringify({
        error: 'Failed to fetch race filter options',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
    );
  }
}

/**
 * GET /api/athletes - Get list of connected athletes
 */
export async function getAthletes(env: Env): Promise<Response> {
  try {
    const result = await env.DB.prepare(
      `SELECT
        a.strava_id,
        a.firstname,
        a.lastname,
        a.profile_photo,
        a.created_at,
        a.last_synced_at,
        COALESCE(COUNT(r.id), 0) as race_count
      FROM athletes a
      LEFT JOIN races r ON r.athlete_id = a.id
      GROUP BY a.id
      ORDER BY a.lastname, a.firstname`
    ).all();

    return new Response(JSON.stringify({ athletes: result.results }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error('Error fetching athletes:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to fetch athletes' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

/**
 * POST /api/races/bulk-edit - Bulk edit races based on filters
 */
export async function bulkEditRaces(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    const body = await request.json() as {
      admin_strava_id: number;
      filters: {
        athleteNames?: string[];
        eventNames?: string[];
        activityName?: string;
        dateFrom?: string;
        dateTo?: string;
        distanceCategories?: string[];
        viewerAthleteId?: number;
      };
      updates: {
        event_name?: string | null;
        manual_distance?: number | null;
        is_hidden?: boolean;
      };
    };

    // Verify the user is an admin
    const requestingAthlete = await env.DB.prepare(
      'SELECT is_admin FROM athletes WHERE strava_id = ?'
    ).bind(body.admin_strava_id).first<{ is_admin: number }>();

    const isAdmin = requestingAthlete?.is_admin === 1;

    if (!isAdmin) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized: Only admins can perform bulk edits' }),
        {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Build query to find matching races (same logic as getRaces)
    let query = `
      SELECT
        r.id,
        r.strava_activity_id,
        r.athlete_id
      FROM races r
      LEFT JOIN athletes a ON r.athlete_id = a.id
      WHERE (a.is_hidden = 0 OR a.id IS NULL)
    `;

    const bindings: any[] = [];
    const filters = body.filters;

    // Handle multiple athlete filters
    if (filters.athleteNames && filters.athleteNames.length > 0) {
      const athleteConditions = filters.athleteNames.map(() => `(a.firstname || ' ' || a.lastname) = ?`).join(' OR ');
      query += ` AND (${athleteConditions})`;
      filters.athleteNames.forEach(name => bindings.push(name));
    }

    // Handle multiple event filters
    if (filters.eventNames && filters.eventNames.length > 0) {
      const eventConditions = filters.eventNames.map(() => `r.event_name = ?`).join(' OR ');
      query += ` AND (${eventConditions})`;
      filters.eventNames.forEach(name => bindings.push(name));
    }

    if (filters.activityName) {
      query += ` AND r.name LIKE ?`;
      bindings.push(`%${filters.activityName}%`);
    }

    if (filters.dateFrom) {
      query += ` AND r.date >= ?`;
      bindings.push(filters.dateFrom);
    }

    if (filters.dateTo) {
      query += ` AND r.date <= ?`;
      bindings.push(filters.dateTo);
    }

    // Handle distance category filtering
    if (filters.distanceCategories && filters.distanceCategories.length > 0) {
      const hasOther = filters.distanceCategories.includes('Other');
      const selectedCategories = filters.distanceCategories.filter(c => c !== 'Other');

      const distanceConditions: string[] = [];

      selectedCategories.forEach(category => {
        const range = DISTANCE_CATEGORIES[category];
        if (range) {
          distanceConditions.push(
            `(r.distance >= ? AND r.distance <= ?)`
          );
          bindings.push(range.minMeters, range.maxMeters);
        }
      });

      if (hasOther) {
        const allRanges = Object.values(DISTANCE_CATEGORIES);
        const otherConditions = allRanges.map(() =>
          `(r.distance < ? OR r.distance > ?)`
        );
        const otherCondition = otherConditions.join(' AND ');
        distanceConditions.push(`(${otherCondition})`);

        allRanges.forEach(range => {
          bindings.push(range.minMeters, range.maxMeters);
        });
      }

      if (distanceConditions.length > 0) {
        query += ` AND (${distanceConditions.join(' OR ')})`;
      }
    }

    const result = await env.DB.prepare(query).bind(...bindings).all();
    const matchingRaces = result.results as { id: number; strava_activity_id: number; athlete_id: number }[];

    if (matchingRaces.length === 0) {
      return new Response(
        JSON.stringify({ success: true, updated: 0, message: 'No races match the current filters' }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }

    // Apply updates
    const updates = body.updates;
    let updatedCount = 0;

    for (const race of matchingRaces) {
      // Update event name if provided (including explicit null to clear)
      if (updates.event_name !== undefined) {
        await env.DB.prepare(
          `UPDATE races SET event_name = ? WHERE id = ?`
        )
          .bind(updates.event_name, race.id)
          .run();

        // Update persistent mapping
        if (updates.event_name) {
          await env.DB.prepare(
            `INSERT INTO activity_event_mappings (strava_activity_id, athlete_id, event_name, is_hidden, updated_at)
             VALUES (?, ?, ?, COALESCE((SELECT is_hidden FROM activity_event_mappings WHERE strava_activity_id = ? AND athlete_id = ?), 0), strftime('%s', 'now'))
             ON CONFLICT(strava_activity_id, athlete_id)
             DO UPDATE SET event_name = excluded.event_name, updated_at = excluded.updated_at`
          )
            .bind(race.strava_activity_id, race.athlete_id, updates.event_name, race.strava_activity_id, race.athlete_id)
            .run();
        } else if (updates.event_name === null) {
          // Clear event name but keep is_hidden
          await env.DB.prepare(
            `INSERT INTO activity_event_mappings (strava_activity_id, athlete_id, event_name, is_hidden, updated_at)
             VALUES (?, ?, NULL, COALESCE((SELECT is_hidden FROM races WHERE strava_activity_id = ? AND athlete_id = ?), 0), strftime('%s', 'now'))
             ON CONFLICT(strava_activity_id, athlete_id)
             DO UPDATE SET event_name = NULL, updated_at = excluded.updated_at`
          )
            .bind(race.strava_activity_id, race.athlete_id, race.strava_activity_id, race.athlete_id)
            .run();
        }
      }

      // Update distance if provided (including null to clear)
      if (updates.manual_distance !== undefined) {
        if (updates.manual_distance === null) {
          // Remove the edit
          await env.DB.prepare(
            `DELETE FROM race_edits WHERE strava_activity_id = ? AND athlete_id = ?`
          )
            .bind(race.strava_activity_id, race.athlete_id)
            .run();

          await env.DB.prepare(
            `UPDATE races SET manual_distance = NULL WHERE strava_activity_id = ? AND athlete_id = ?`
          )
            .bind(race.strava_activity_id, race.athlete_id)
            .run();
        } else {
          // Upsert the manual distance
          await env.DB.prepare(
            `INSERT INTO race_edits (strava_activity_id, athlete_id, manual_distance, edited_at)
             VALUES (?, ?, ?, strftime('%s', 'now'))
             ON CONFLICT(strava_activity_id, athlete_id)
             DO UPDATE SET manual_distance = excluded.manual_distance, edited_at = excluded.edited_at`
          )
            .bind(race.strava_activity_id, race.athlete_id, updates.manual_distance)
            .run();
        }
      }

      // Update visibility if provided
      if (updates.is_hidden !== undefined) {
        // Check current state to see if we're actually changing anything
        const currentState = await env.DB.prepare(
          `SELECT is_hidden FROM races WHERE id = ?`
        ).bind(race.id).first<{ is_hidden: number }>();

        const newHiddenValue = updates.is_hidden ? 1 : 0;
        const wasAlreadyInState = currentState?.is_hidden === newHiddenValue;

        await env.DB.prepare(
          `UPDATE races SET is_hidden = ? WHERE id = ?`
        )
          .bind(newHiddenValue, race.id)
          .run();

        // Persist visibility to mapping table so it survives full syncs
        await env.DB.prepare(
          `INSERT INTO activity_event_mappings (strava_activity_id, athlete_id, event_name, is_hidden, updated_at)
           VALUES (?, ?, COALESCE((SELECT event_name FROM activity_event_mappings WHERE strava_activity_id = ? AND athlete_id = ?), ''), ?, strftime('%s', 'now'))
           ON CONFLICT(strava_activity_id, athlete_id)
           DO UPDATE SET is_hidden = excluded.is_hidden, updated_at = excluded.updated_at`
        )
          .bind(race.strava_activity_id, race.athlete_id, race.strava_activity_id, race.athlete_id, newHiddenValue)
          .run();

        // Only count as updated if the state actually changed
        if (!wasAlreadyInState) {
          updatedCount++;
        }
        continue; // Skip the general updatedCount++ below
      }

      updatedCount++;
    }

    // Build appropriate message
    let message: string;
    if (updatedCount === 0 && matchingRaces.length > 0) {
      // Found races but none were changed (e.g., all already hidden)
      message = `All ${matchingRaces.length} matching race${matchingRaces.length !== 1 ? 's were' : ' was'} already in the requested state`;
    } else if (updatedCount < matchingRaces.length) {
      message = `Updated ${updatedCount} race${updatedCount !== 1 ? 's' : ''} (${matchingRaces.length - updatedCount} already in requested state)`;
    } else {
      message = `Successfully updated ${updatedCount} race${updatedCount !== 1 ? 's' : ''}`;
    }

    return new Response(
      JSON.stringify({
        success: true,
        updated: updatedCount,
        total: matchingRaces.length,
        message,
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (error) {
    console.error('Error performing bulk edit:', error);
    return new Response(
      JSON.stringify({
        error: 'Failed to perform bulk edit',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}
