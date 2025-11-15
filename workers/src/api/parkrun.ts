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

  const allowedSortFields = ['date', 'event_name', 'athlete_name', 'position', 'gender_position', 'time_seconds'];
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
    const sortColumn = validSortBy === 'athlete_name' || validSortBy === 'event_name' || validSortBy === 'date' || validSortBy === 'position' || validSortBy === 'gender_position' || validSortBy === 'time_seconds'
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
    const url = new URL(request.url);
    const athleteNames = url.searchParams.getAll('athlete');
    const eventNames = url.searchParams.getAll('event');
    const dateFrom = url.searchParams.get('date_from');
    const dateTo = url.searchParams.get('date_to');

    // Build WHERE clause for filters
    const conditions: string[] = [];
    const bindings: any[] = [];

    if (athleteNames.length > 0) {
      const athleteConditions = athleteNames.map(() => 'athlete_name = ?').join(' OR ');
      conditions.push(`(${athleteConditions})`);
      athleteNames.forEach(name => bindings.push(name));
    }

    if (eventNames.length > 0) {
      const eventConditions = eventNames.map(() => 'event_name = ?').join(' OR ');
      conditions.push(`(${eventConditions})`);
      eventNames.forEach(name => bindings.push(name));
    }

    if (dateFrom) {
      conditions.push('date >= ?');
      bindings.push(dateFrom);
    }

    if (dateTo) {
      conditions.push('date <= ?');
      bindings.push(dateTo);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Get total number of parkrun results
    const totalResults = await env.DB.prepare(
      `SELECT COUNT(*) as count FROM parkrun_results ${whereClause}`
    ).bind(...bindings).first<{ count: number }>();

    // Get unique athletes
    const uniqueAthletes = await env.DB.prepare(
      `SELECT COUNT(DISTINCT athlete_name) as count FROM parkrun_results ${whereClause}`
    ).bind(...bindings).first<{ count: number }>();

    // Get unique events
    const uniqueEvents = await env.DB.prepare(
      `SELECT COUNT(DISTINCT event_name) as count FROM parkrun_results ${whereClause}`
    ).bind(...bindings).first<{ count: number }>();

    // Get date range (earliest and latest)
    const dateRange = await env.DB.prepare(
      `SELECT MIN(date) as earliest, MAX(date) as latest FROM parkrun_results ${whereClause}`
    ).bind(...bindings).first<{ earliest: string; latest: string }>();

    // Get fastest time
    const fastestTime = await env.DB.prepare(
      `SELECT athlete_name, event_name, time_string, date
       FROM parkrun_results
       ${whereClause}
       ORDER BY time_seconds ASC
       LIMIT 1`
    ).bind(...bindings).first();

    // Get most recent result
    const mostRecentResult = await env.DB.prepare(
      `SELECT athlete_name, event_name, time_string, date
       FROM parkrun_results
       ${whereClause}
       ORDER BY date DESC
       LIMIT 1`
    ).bind(...bindings).first();

    // Get most parkruns by athlete
    const mostActiveAthlete = await env.DB.prepare(
      `SELECT athlete_name, COUNT(*) as count
       FROM parkrun_results
       ${whereClause}
       GROUP BY athlete_name
       ORDER BY count DESC
       LIMIT 1`
    ).bind(...bindings).first();

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
 * GET /api/parkrun/athletes - Get all parkrun athletes (for admin management)
 */
export async function getParkrunAthletes(request: Request, env: Env): Promise<Response> {
  try {
    // Get all unique athlete names from parkrun results with run counts
    const athleteResults = await env.DB.prepare(
      `SELECT DISTINCT pr.athlete_name, pa.id, pa.is_hidden, COUNT(pr.id) as run_count
       FROM parkrun_results pr
       LEFT JOIN parkrun_athletes pa ON pr.athlete_name = pa.athlete_name
       GROUP BY pr.athlete_name
       ORDER BY pr.athlete_name ASC`
    ).all();

    // For each athlete, get their top 3 events by count
    const athletesWithTopEvents = await Promise.all(
      (athleteResults.results || []).map(async (athlete: any) => {
        const topEvents = await env.DB.prepare(
          `SELECT event_name, COUNT(*) as count
           FROM parkrun_results
           WHERE athlete_name = ?
           GROUP BY event_name
           ORDER BY count DESC
           LIMIT 3`
        ).bind(athlete.athlete_name).all();

        return {
          ...athlete,
          top_events: topEvents.results || [],
        };
      })
    );

    return new Response(
      JSON.stringify({
        athletes: athletesWithTopEvents,
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
 * GET /api/parkrun/by-date - Get parkrun results aggregated by date
 * Supports the same filters as the main results endpoint
 */
export async function getParkrunByDate(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const athleteNames = url.searchParams.getAll('athlete');
  const eventNames = url.searchParams.getAll('event');
  const dateFrom = url.searchParams.get('date_from');
  const dateTo = url.searchParams.get('date_to');

  try {
    // Build query with filters - exclude hidden athletes
    let query = `
      SELECT
        pr.date,
        COUNT(*) as run_count,
        COUNT(DISTINCT pr.event_name) as event_count
      FROM parkrun_results pr
      LEFT JOIN parkrun_athletes pa ON pr.athlete_name = pa.athlete_name
      WHERE (pa.is_hidden IS NULL OR pa.is_hidden = 0)
    `;

    const bindings: any[] = [];

    // Handle multiple athlete filters
    if (athleteNames.length > 0) {
      const athleteConditions = athleteNames.map(() => 'pr.athlete_name = ?').join(' OR ');
      query += ` AND (${athleteConditions})`;
      athleteNames.forEach(name => bindings.push(name));
    }

    // Handle multiple event filters
    if (eventNames.length > 0) {
      const eventConditions = eventNames.map(() => 'pr.event_name = ?').join(' OR ');
      query += ` AND (${eventConditions})`;
      eventNames.forEach(name => bindings.push(name));
    }

    if (dateFrom) {
      query += ` AND pr.date >= ?`;
      bindings.push(dateFrom);
    }

    if (dateTo) {
      query += ` AND pr.date <= ?`;
      bindings.push(dateTo);
    }

    query += ` GROUP BY pr.date ORDER BY pr.date ASC`;

    const result = await env.DB.prepare(query).bind(...bindings).all();

    // Fill in missing parkrun dates (Saturdays + special dates) with zero counts
    let filledData: any[] = [];

    if (dateFrom && dateTo) {
      const start = new Date(dateFrom);
      const end = new Date(dateTo);
      const dataMap = new Map();

      // Create a map of existing data
      if (result.results) {
        for (const row of result.results as any[]) {
          dataMap.set(row.date, row);
        }
      }

      const allDates: string[] = [];

      // Generate all Saturdays in the range
      let current = new Date(start);
      // Find first Saturday
      while (current.getDay() !== 6 && current <= end) {
        current.setDate(current.getDate() + 1);
      }

      // Add all Saturdays
      while (current <= end) {
        const dateStr = current.toISOString().split('T')[0];
        allDates.push(dateStr);
        current.setDate(current.getDate() + 7); // Next Saturday
      }

      // Add special dates (Dec 25 and Jan 1) if they fall in range
      const startYear = start.getFullYear();
      const endYear = end.getFullYear();

      for (let year = startYear; year <= endYear; year++) {
        const dec25 = new Date(year, 11, 25); // December 25
        const jan1 = new Date(year, 0, 1);    // January 1

        if (dec25 >= start && dec25 <= end) {
          const dateStr = dec25.toISOString().split('T')[0];
          if (!allDates.includes(dateStr)) {
            allDates.push(dateStr);
          }
        }

        if (jan1 >= start && jan1 <= end) {
          const dateStr = jan1.toISOString().split('T')[0];
          if (!allDates.includes(dateStr)) {
            allDates.push(dateStr);
          }
        }
      }

      // Sort dates and build filled data
      allDates.sort();
      for (const dateStr of allDates) {
        if (dataMap.has(dateStr)) {
          filledData.push(dataMap.get(dateStr));
        } else {
          filledData.push({
            date: dateStr,
            run_count: 0,
            event_count: 0,
          });
        }
      }
    } else {
      filledData = result.results || [];
    }

    return new Response(
      JSON.stringify({
        data: filledData,
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (error) {
    console.error('Error fetching parkrun by date:', error);
    return new Response(
      JSON.stringify({
        error: 'Failed to fetch parkrun data by date',
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
 * GET /api/parkrun/weekly-summary - Get weekly parkrun summary for a specific date
 * Query params: date (optional, defaults to most recent)
 */
export async function getParkrunWeeklySummary(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url);
    const requestedDate = url.searchParams.get('date');

    // Get the most recent date if not specified
    let targetDate = requestedDate;
    if (!targetDate) {
      const mostRecentResult = await env.DB.prepare(
        `SELECT MAX(date) as latest_date FROM parkrun_results`
      ).first<{ latest_date: string }>();
      targetDate = mostRecentResult?.latest_date || '';
    }

    if (!targetDate) {
      return new Response(
        JSON.stringify({ error: 'No parkrun data available' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Get all available dates for the picker
    const availableDatesResult = await env.DB.prepare(
      `SELECT DISTINCT date FROM parkrun_results ORDER BY date DESC`
    ).all();
    const availableDates = (availableDatesResult.results || []).map((r: any) => r.date);

    // Get summary for the target date (excluding hidden athletes)
    const summaryQuery = `
      SELECT
        COUNT(DISTINCT pr.athlete_name) as athlete_count,
        COUNT(DISTINCT pr.event_name) as event_count
      FROM parkrun_results pr
      LEFT JOIN parkrun_athletes pa ON pr.athlete_name = pa.athlete_name
      WHERE pr.date = ?
        AND (pa.is_hidden IS NULL OR pa.is_hidden = 0)
    `;
    const summary = await env.DB.prepare(summaryQuery).bind(targetDate).first<{
      athlete_count: number;
      event_count: number;
    }>();

    // Get most popular events for this date (excluding hidden athletes)
    const popularEventsQuery = `
      SELECT
        pr.event_name,
        COUNT(*) as count
      FROM parkrun_results pr
      LEFT JOIN parkrun_athletes pa ON pr.athlete_name = pa.athlete_name
      WHERE pr.date = ?
        AND (pa.is_hidden IS NULL OR pa.is_hidden = 0)
      GROUP BY pr.event_name
      ORDER BY count DESC
      LIMIT 5
    `;
    const popularEventsResult = await env.DB.prepare(popularEventsQuery).bind(targetDate).all();
    const popularEvents = (popularEventsResult.results || []).map((e: any) => ({
      name: e.event_name,
      count: e.count,
    }));

    // Get all events before this date (excluding hidden athletes)
    const precedingEventsQuery = `
      SELECT DISTINCT pr.event_name
      FROM parkrun_results pr
      LEFT JOIN parkrun_athletes pa ON pr.athlete_name = pa.athlete_name
      WHERE pr.date < ?
        AND (pa.is_hidden IS NULL OR pa.is_hidden = 0)
    `;
    const precedingEventsResult = await env.DB.prepare(precedingEventsQuery).bind(targetDate).all();
    const precedingEvents = new Set((precedingEventsResult.results || []).map((e: any) => e.event_name));

    // Get events on this date (excluding hidden athletes)
    const currentEventsQuery = `
      SELECT DISTINCT pr.event_name
      FROM parkrun_results pr
      LEFT JOIN parkrun_athletes pa ON pr.athlete_name = pa.athlete_name
      WHERE pr.date = ?
        AND (pa.is_hidden IS NULL OR pa.is_hidden = 0)
    `;
    const currentEventsResult = await env.DB.prepare(currentEventsQuery).bind(targetDate).all();
    const currentEvents = (currentEventsResult.results || []).map((e: any) => e.event_name);

    // Find first-time events (events on current date that don't appear in preceding dates)
    const firstTimeEvents = currentEvents.filter((event) => !precedingEvents.has(event));

    // Get event occurrence counts before this date (for rare pokemons)
    const rarePokemons: Array<{ name: string; visitCount: number }> = [];
    for (const event of currentEvents) {
      const countQuery = `
        SELECT COUNT(DISTINCT pr.date) as visit_count
        FROM parkrun_results pr
        LEFT JOIN parkrun_athletes pa ON pr.athlete_name = pa.athlete_name
        WHERE pr.event_name = ?
          AND pr.date < ?
          AND (pa.is_hidden IS NULL OR pa.is_hidden = 0)
      `;
      const countResult = await env.DB.prepare(countQuery).bind(event, targetDate).first<{ visit_count: number }>();
      const visitCount = (countResult?.visit_count || 0) + 1; // +1 to include current date

      // Only include events with <=5 total visits (including current)
      if (visitCount <= 5 && visitCount > 1) { // >1 to exclude first-time events
        rarePokemons.push({ name: event, visitCount });
      }
    }

    return new Response(
      JSON.stringify({
        date: targetDate,
        availableDates,
        summary: {
          athleteCount: summary?.athlete_count || 0,
          eventCount: summary?.event_count || 0,
        },
        popularEvents,
        firstTimeEvents,
        rarePokemons,
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (error) {
    console.error('Error fetching parkrun weekly summary:', error);
    return new Response(
      JSON.stringify({
        error: 'Failed to fetch weekly summary',
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
