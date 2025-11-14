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

/**
 * GET /api/races - Get recent races with filtering
 */
export async function getRaces(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const limit = parseInt(url.searchParams.get('limit') || '50');
  const offset = parseInt(url.searchParams.get('offset') || '0');
  const athleteNames = url.searchParams.getAll('athlete'); // Get all athlete parameters
  const eventNames = url.searchParams.getAll('event'); // Get all event parameters
  const activityName = url.searchParams.get('activity_name');
  const dateFrom = url.searchParams.get('date_from');
  const dateTo = url.searchParams.get('date_to');
  const distanceCategories = url.searchParams.getAll('distance'); // Get all distance category parameters
  const viewerAthleteId = url.searchParams.get('viewer_athlete_id'); // Current user's strava_id

  // Legacy support for min/max distance
  const minDistanceParam = url.searchParams.get('min_distance');
  const maxDistanceParam = url.searchParams.get('max_distance');
  const minDistance = minDistanceParam ? parseFloat(minDistanceParam) : null;
  const maxDistance = maxDistanceParam ? parseFloat(maxDistanceParam) : null;

  // Check if viewer is admin
  let isViewerAdmin = false;
  if (viewerAthleteId) {
    const adminCheck = await env.DB.prepare(
      'SELECT is_admin FROM athletes WHERE strava_id = ?'
    ).bind(parseInt(viewerAthleteId)).first<{ is_admin: number }>();
    isViewerAdmin = adminCheck?.is_admin === 1;
  }

  try {
    // Build query with filters - JOIN with race_edits to get manual overrides
    let query = `
      SELECT
        r.id,
        r.strava_activity_id,
        r.name,
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
      WHERE (a.is_hidden = 0 OR a.id IS NULL)
    `;

    const bindings: any[] = [];

    // Filter hidden races: only show if viewer is owner or admin
    if (!isViewerAdmin && viewerAthleteId) {
      // Not admin: show visible races + own hidden races
      query += ` AND (r.is_hidden = 0 OR a.strava_id = ?)`;
      bindings.push(parseInt(viewerAthleteId));
    } else if (!viewerAthleteId) {
      // Anonymous: only show visible races
      query += ` AND r.is_hidden = 0`;
    }
    // If viewer is admin: show all races (no additional filter)

    // Handle multiple athlete filters - match against full name
    if (athleteNames.length > 0) {
      const athleteConditions = athleteNames.map(() => `(a.firstname || ' ' || a.lastname) = ?`).join(' OR ');
      query += ` AND (${athleteConditions})`;
      athleteNames.forEach(name => bindings.push(name));
    }

    // Handle multiple event filters
    if (eventNames.length > 0) {
      const eventConditions = eventNames.map(() => `r.event_name = ?`).join(' OR ');
      query += ` AND (${eventConditions})`;
      eventNames.forEach(name => bindings.push(name));
    }

    if (activityName) {
      query += ` AND r.name LIKE ?`;
      bindings.push(`%${activityName}%`);
    }

    if (dateFrom) {
      query += ` AND r.date >= ?`;
      bindings.push(dateFrom);
    }

    if (dateTo) {
      query += ` AND r.date <= ?`;
      bindings.push(dateTo);
    }

    // Handle distance category filtering
    if (distanceCategories.length > 0) {
      const hasOther = distanceCategories.includes('Other');
      const selectedCategories = distanceCategories.filter(c => c !== 'Other');

      const distanceConditions: string[] = [];

      // Add conditions for selected preset categories
      selectedCategories.forEach(category => {
        const range = DISTANCE_CATEGORIES[category];
        if (range) {
          distanceConditions.push(
            `(COALESCE(re.manual_distance, r.manual_distance, r.distance) >= ? AND COALESCE(re.manual_distance, r.manual_distance, r.distance) <= ?)`
          );
          bindings.push(range.minMeters, range.maxMeters);
        }
      });

      // Add condition for "Other" - races not in any preset category
      if (hasOther) {
        const allRanges = Object.values(DISTANCE_CATEGORIES);
        const otherConditions = allRanges.map(() =>
          `(COALESCE(re.manual_distance, r.manual_distance, r.distance) < ? OR COALESCE(re.manual_distance, r.manual_distance, r.distance) > ?)`
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
    } else if (minDistance !== null || maxDistance !== null) {
      // Legacy min/max distance filtering
      if (minDistance !== null && minDistance > 0) {
        query += ` AND COALESCE(re.manual_distance, r.manual_distance, r.distance) >= ?`;
        bindings.push(minDistance);
      }

      if (maxDistance !== null && maxDistance < 999999) {
        query += ` AND COALESCE(re.manual_distance, r.manual_distance, r.distance) <= ?`;
        bindings.push(maxDistance);
      }
    }

    query += ` ORDER BY r.date DESC LIMIT ? OFFSET ?`;
    bindings.push(limit, offset);

    const result = await env.DB.prepare(query).bind(...bindings).all();

    // Get total count for pagination
    let countQuery = `
      SELECT COUNT(*) as total
      FROM races r
      LEFT JOIN athletes a ON r.athlete_id = a.id
      LEFT JOIN race_edits re ON r.strava_activity_id = re.strava_activity_id AND r.athlete_id = re.athlete_id
      WHERE (a.is_hidden = 0 OR a.id IS NULL)
    `;
    const countBindings: any[] = [];

    // Handle multiple athlete filters - match against full name
    if (athleteNames.length > 0) {
      const athleteConditions = athleteNames.map(() => `(a.firstname || ' ' || a.lastname) = ?`).join(' OR ');
      countQuery += ` AND (${athleteConditions})`;
      athleteNames.forEach(name => countBindings.push(name));
    }
    // Handle multiple event filters
    if (eventNames.length > 0) {
      const eventConditions = eventNames.map(() => `r.event_name = ?`).join(' OR ');
      countQuery += ` AND (${eventConditions})`;
      eventNames.forEach(name => countBindings.push(name));
    }
    if (activityName) {
      countQuery += ` AND r.name LIKE ?`;
      countBindings.push(`%${activityName}%`);
    }
    if (dateFrom) {
      countQuery += ` AND r.date >= ?`;
      countBindings.push(dateFrom);
    }
    if (dateTo) {
      countQuery += ` AND r.date <= ?`;
      countBindings.push(dateTo);
    }

    // Handle distance category filtering (same as main query)
    if (distanceCategories.length > 0) {
      const hasOther = distanceCategories.includes('Other');
      const selectedCategories = distanceCategories.filter(c => c !== 'Other');

      const distanceConditions: string[] = [];

      // Add conditions for selected preset categories
      selectedCategories.forEach(category => {
        const range = DISTANCE_CATEGORIES[category];
        if (range) {
          distanceConditions.push(
            `(COALESCE(re.manual_distance, r.manual_distance, r.distance) >= ? AND COALESCE(re.manual_distance, r.manual_distance, r.distance) <= ?)`
          );
          countBindings.push(range.minMeters, range.maxMeters);
        }
      });

      // Add condition for "Other" - races not in any preset category
      if (hasOther) {
        const allRanges = Object.values(DISTANCE_CATEGORIES);
        const otherConditions = allRanges.map(() =>
          `(COALESCE(re.manual_distance, r.manual_distance, r.distance) < ? OR COALESCE(re.manual_distance, r.manual_distance, r.distance) > ?)`
        );
        const otherCondition = otherConditions.join(' AND ');
        distanceConditions.push(`(${otherCondition})`);

        allRanges.forEach(range => {
          countBindings.push(range.minMeters, range.maxMeters);
        });
      }

      if (distanceConditions.length > 0) {
        countQuery += ` AND (${distanceConditions.join(' OR ')})`;
      }
    } else if (minDistance !== null || maxDistance !== null) {
      // Legacy min/max distance filtering
      if (minDistance !== null && minDistance > 0) {
        countQuery += ` AND COALESCE(re.manual_distance, r.manual_distance, r.distance) >= ?`;
        countBindings.push(minDistance);
      }
      if (maxDistance !== null && maxDistance < 999999) {
        countQuery += ` AND COALESCE(re.manual_distance, r.manual_distance, r.distance) <= ?`;
        countBindings.push(maxDistance);
      }
    }

    const countResult = await env.DB.prepare(countQuery)
      .bind(...countBindings)
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
      await env.DB.prepare(
        `INSERT INTO race_edits (strava_activity_id, athlete_id, manual_time, edited_at)
         VALUES (?, ?, ?, strftime('%s', 'now'))
         ON CONFLICT(strava_activity_id, athlete_id)
         DO UPDATE SET manual_time = excluded.manual_time, edited_at = excluded.edited_at`
      )
        .bind(race.strava_activity_id, race.athlete_id, body.manual_time)
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
          `INSERT INTO activity_event_mappings (strava_activity_id, athlete_id, event_name, updated_at)
           VALUES (?, ?, ?, strftime('%s', 'now'))
           ON CONFLICT(strava_activity_id, athlete_id)
           DO UPDATE SET event_name = excluded.event_name, updated_at = excluded.updated_at`
        )
          .bind(race.strava_activity_id, race.athlete_id, body.event_name)
          .run();
      } else {
        // If event_name is being cleared, remove from mapping table
        await env.DB.prepare(
          `DELETE FROM activity_event_mappings WHERE strava_activity_id = ? AND athlete_id = ?`
        )
          .bind(race.strava_activity_id, race.athlete_id)
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
 * GET /api/athletes - Get list of connected athletes
 */
export async function getAthletes(env: Env): Promise<Response> {
  try {
    const result = await env.DB.prepare(
      `SELECT
        strava_id,
        firstname,
        lastname,
        profile_photo,
        created_at,
        last_synced_at,
        (SELECT COUNT(*) FROM races WHERE athlete_id = athletes.id) as race_count
      FROM athletes
      ORDER BY lastname, firstname`
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
            `INSERT INTO activity_event_mappings (strava_activity_id, athlete_id, event_name, updated_at)
             VALUES (?, ?, ?, strftime('%s', 'now'))
             ON CONFLICT(strava_activity_id, athlete_id)
             DO UPDATE SET event_name = excluded.event_name, updated_at = excluded.updated_at`
          )
            .bind(race.strava_activity_id, race.athlete_id, updates.event_name)
            .run();
        } else if (updates.event_name === null) {
          // Clear from mapping table
          await env.DB.prepare(
            `DELETE FROM activity_event_mappings WHERE strava_activity_id = ? AND athlete_id = ?`
          )
            .bind(race.strava_activity_id, race.athlete_id)
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
        await env.DB.prepare(
          `UPDATE races SET is_hidden = ? WHERE id = ?`
        )
          .bind(updates.is_hidden ? 1 : 0, race.id)
          .run();
      }

      updatedCount++;
    }

    return new Response(
      JSON.stringify({
        success: true,
        updated: updatedCount,
        message: `Successfully updated ${updatedCount} race${updatedCount !== 1 ? 's' : ''}`,
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
