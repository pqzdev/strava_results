// API endpoints for fetching parkrun data

import { Env } from '../types';

/**
 * GET /api/parkrun - Get parkrun results with filtering
 */
export async function getParkrunResults(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const limit = parseInt(url.searchParams.get('limit') || '50');
  const offset = parseInt(url.searchParams.get('offset') || '0');
  const athleteName = url.searchParams.get('athlete');
  const eventName = url.searchParams.get('event');
  const dateFrom = url.searchParams.get('date_from');
  const dateTo = url.searchParams.get('date_to');

  // Get sorting parameters with validation
  const sortBy = url.searchParams.get('sort_by') || 'date';
  const sortDir = url.searchParams.get('sort_dir') || 'desc';

  const allowedSortFields = ['date', 'event_name', 'athlete_name', 'position', 'time_seconds'];
  const allowedSortDirs = ['asc', 'desc'];
  const validSortBy = allowedSortFields.includes(sortBy) ? sortBy : 'date';
  const validSortDir = allowedSortDirs.includes(sortDir.toLowerCase()) ? sortDir.toUpperCase() : 'DESC';

  try {
    // Build query with filters - exclude hidden athletes
    let query = `
      SELECT
        pr.id,
        pr.athlete_name,
        pr.parkrun_athlete_id,
        pr.event_name,
        pr.event_number,
        pr.position,
        pr.gender_position,
        pr.time_seconds,
        pr.time_string,
        pr.age_grade,
        pr.age_category,
        pr.date,
        pr.club_name,
        pr.created_at
      FROM parkrun_results pr
      LEFT JOIN parkrun_athletes pa ON pr.athlete_name = pa.athlete_name
      WHERE (pa.is_hidden IS NULL OR pa.is_hidden = 0)
    `;

    const bindings: any[] = [];

    if (athleteName) {
      query += ` AND pr.athlete_name LIKE ?`;
      bindings.push(`%${athleteName}%`);
    }

    if (eventName) {
      query += ` AND pr.event_name LIKE ?`;
      bindings.push(`%${eventName}%`);
    }

    if (dateFrom) {
      query += ` AND pr.date >= ?`;
      bindings.push(dateFrom);
    }

    if (dateTo) {
      query += ` AND pr.date <= ?`;
      bindings.push(dateTo);
    }

    // Add table prefix for sortable columns to avoid ambiguity
    const sortColumn = validSortBy === 'athlete_name' || validSortBy === 'event_name' || validSortBy === 'date' || validSortBy === 'position' || validSortBy === 'time_seconds'
      ? `pr.${validSortBy}`
      : validSortBy;
    query += ` ORDER BY ${sortColumn} ${validSortDir} LIMIT ? OFFSET ?`;
    bindings.push(limit, offset);

    const result = await env.DB.prepare(query).bind(...bindings).all();

    // Get total count for pagination - exclude hidden athletes
    let countQuery = `
      SELECT COUNT(*) as total
      FROM parkrun_results pr
      LEFT JOIN parkrun_athletes pa ON pr.athlete_name = pa.athlete_name
      WHERE (pa.is_hidden IS NULL OR pa.is_hidden = 0)
    `;
    const countBindings: any[] = [];

    if (athleteName) {
      countQuery += ` AND pr.athlete_name LIKE ?`;
      countBindings.push(`%${athleteName}%`);
    }
    if (eventName) {
      countQuery += ` AND pr.event_name LIKE ?`;
      countBindings.push(`%${eventName}%`);
    }
    if (dateFrom) {
      countQuery += ` AND pr.date >= ?`;
      countBindings.push(dateFrom);
    }
    if (dateTo) {
      countQuery += ` AND pr.date <= ?`;
      countBindings.push(dateTo);
    }

    const countResult = await env.DB.prepare(countQuery).bind(...countBindings).first<{ total: number }>();
    const total = countResult?.total || 0;

    return new Response(
      JSON.stringify({
        results: result.results,
        pagination: {
          total,
          limit,
          offset,
        },
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (error) {
    console.error('Error fetching parkrun results:', error);
    return new Response(
      JSON.stringify({
        error: 'Failed to fetch parkrun results',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }
}

/**
 * GET /api/parkrun/stats - Get parkrun statistics
 */
export async function getParkrunStats(request: Request, env: Env): Promise<Response> {
  try {
    // Get total number of parkrun results
    const totalResults = await env.DB.prepare(
      'SELECT COUNT(*) as count FROM parkrun_results'
    ).first<{ count: number }>();

    // Get unique athletes
    const uniqueAthletes = await env.DB.prepare(
      'SELECT COUNT(DISTINCT athlete_name) as count FROM parkrun_results'
    ).first<{ count: number }>();

    // Get unique events
    const uniqueEvents = await env.DB.prepare(
      'SELECT COUNT(DISTINCT event_name) as count FROM parkrun_results'
    ).first<{ count: number }>();

    // Get date range (earliest and latest)
    const dateRange = await env.DB.prepare(
      'SELECT MIN(date) as earliest, MAX(date) as latest FROM parkrun_results'
    ).first<{ earliest: string; latest: string }>();

    // Get fastest time
    const fastestTime = await env.DB.prepare(
      `SELECT athlete_name, event_name, time_string, date
       FROM parkrun_results
       ORDER BY time_seconds ASC
       LIMIT 1`
    ).first();

    // Get most recent result
    const mostRecentResult = await env.DB.prepare(
      `SELECT athlete_name, event_name, time_string, date
       FROM parkrun_results
       ORDER BY date DESC
       LIMIT 1`
    ).first();

    // Get most parkruns by athlete
    const mostActiveAthlete = await env.DB.prepare(
      `SELECT athlete_name, COUNT(*) as count
       FROM parkrun_results
       GROUP BY athlete_name
       ORDER BY count DESC
       LIMIT 1`
    ).first();

    return new Response(
      JSON.stringify({
        totalResults: totalResults?.count || 0,
        uniqueAthletes: uniqueAthletes?.count || 0,
        uniqueEvents: uniqueEvents?.count || 0,
        earliestDate: dateRange?.earliest,
        latestDate: dateRange?.latest,
        fastestTime,
        mostRecentResult,
        mostActiveAthlete,
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (error) {
    console.error('Error fetching parkrun stats:', error);
    return new Response(
      JSON.stringify({
        error: 'Failed to fetch parkrun stats',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }
}

/**
 * POST /api/parkrun/sync - Manually trigger a parkrun sync
 * Runs in background to avoid timeouts. Uses fibonacci backoff and batch upload from parkrun-sync.ts.
 */
export async function triggerParkrunSync(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  try {
    // Start sync in background using waitUntil to extend execution time
    // This prevents timeouts since parkrun sync can take several minutes with fibonacci backoff
    ctx.waitUntil(
      (async () => {
        try {
          console.log('Admin triggering parkrun sync with fibonacci backoff and batch upload...');
          const { syncParkrunResults } = await import('../cron/parkrun-sync');
          await syncParkrunResults(env);
          console.log('Parkrun sync completed successfully');
        } catch (error) {
          console.error('Parkrun sync failed:', error);
          // Error is already logged in sync function
        }
      })()
    );

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Parkrun sync triggered in background. Check sync logs for progress.',
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (error) {
    console.error('Error triggering parkrun sync:', error);
    return new Response(
      JSON.stringify({
        error: 'Failed to trigger parkrun sync',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }
}

/**
 * GET /api/parkrun/athletes - Get all parkrun athletes (for admin management)
 */
export async function getParkrunAthletes(request: Request, env: Env): Promise<Response> {
  try {
    // Get all unique athlete names from parkrun results
    const athleteResults = await env.DB.prepare(
      `SELECT DISTINCT pr.athlete_name, pa.id, pa.is_hidden, COUNT(pr.id) as run_count
       FROM parkrun_results pr
       LEFT JOIN parkrun_athletes pa ON pr.athlete_name = pa.athlete_name
       GROUP BY pr.athlete_name
       ORDER BY pr.athlete_name ASC`
    ).all();

    return new Response(
      JSON.stringify({
        athletes: athleteResults.results || [],
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (error) {
    console.error('Error fetching parkrun athletes:', error);
    return new Response(
      JSON.stringify({
        error: 'Failed to fetch parkrun athletes',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }
}

/**
 * PATCH /api/parkrun/athletes/:name - Update parkrun athlete visibility
 */
export async function updateParkrunAthlete(
  request: Request,
  env: Env,
  athleteName: string
): Promise<Response> {
  try {
    const body = await request.json() as { is_hidden: number };
    const { is_hidden } = body;

    // Insert or update athlete record
    await env.DB.prepare(
      `INSERT INTO parkrun_athletes (athlete_name, is_hidden, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(athlete_name) DO UPDATE SET
         is_hidden = excluded.is_hidden,
         updated_at = excluded.updated_at`
    )
      .bind(athleteName, is_hidden ? 1 : 0, Math.floor(Date.now() / 1000))
      .run();

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Athlete visibility updated',
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (error) {
    console.error('Error updating parkrun athlete:', error);
    return new Response(
      JSON.stringify({
        error: 'Failed to update athlete',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }
}
