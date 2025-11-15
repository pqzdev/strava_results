// Event suggestion API handlers
import { Env, EventSuggestion } from '../types';
import { analyzeEvents } from '../utils/eventAnalysis';

/**
 * Check if user is admin
 */
async function isAdmin(env: Env, stravaId: number): Promise<boolean> {
  const result = await env.DB.prepare(
    'SELECT is_admin FROM athletes WHERE strava_id = ?'
  ).bind(stravaId).first();

  return result?.is_admin === 1;
}

/**
 * Get all unique event names
 * GET /api/events/names
 */
export async function getEventNames(request: Request, env: Env): Promise<Response> {
  try {
    const result = await env.DB.prepare(`
      SELECT DISTINCT event_name
      FROM races
      WHERE event_name IS NOT NULL AND event_name != ''
      ORDER BY event_name ASC
    `).all();

    const eventNames = result.results.map((row: any) => row.event_name) as string[];

    return new Response(JSON.stringify({ eventNames }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error('Failed to fetch event names:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to fetch event names' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

/**
 * Get event statistics for admin panel
 * GET /api/events/stats
 */
export async function getEventStats(request: Request, env: Env): Promise<Response> {
  try {
    // Get all events with their statistics
    const result = await env.DB.prepare(`
      SELECT
        r.event_name,
        GROUP_CONCAT(DISTINCT r.date) as dates,
        GROUP_CONCAT(DISTINCT ROUND(COALESCE(re.manual_distance, r.manual_distance, r.distance))) as distances,
        COUNT(DISTINCT r.id) as activity_count
      FROM races r
      LEFT JOIN race_edits re ON r.strava_activity_id = re.strava_activity_id AND r.athlete_id = re.athlete_id
      WHERE r.event_name IS NOT NULL AND r.event_name != ''
      GROUP BY r.event_name
      ORDER BY r.event_name ASC
    `).all();

    const events = result.results.map((row: any) => {
      // Parse and deduplicate dates
      const datesArray = row.dates ? row.dates.split(',').filter((d: string) => d) : [];
      const uniqueDates = [...new Set(datesArray)];

      // Parse and deduplicate distances
      const distancesArray = row.distances ? row.distances.split(',').map((d: string) => parseFloat(d)).filter((d: number) => !isNaN(d)) : [];
      const uniqueDistances = [...new Set(distancesArray)];

      return {
        event_name: row.event_name,
        dates: uniqueDates,
        distances: uniqueDistances,
        activity_count: row.activity_count || 0,
      };
    });

    return new Response(JSON.stringify({ events }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error('Failed to fetch event stats:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to fetch event statistics' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

/**
 * Rename an event across all activities
 * POST /api/events/rename
 */
export async function renameEvent(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json() as {
      admin_strava_id: number;
      old_name: string;
      new_name: string;
    };

    const { admin_strava_id, old_name, new_name } = body;

    // Verify admin access
    if (!admin_strava_id || !(await isAdmin(env, admin_strava_id))) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Validate input
    if (!old_name || !new_name) {
      return new Response(
        JSON.stringify({ error: 'Both old_name and new_name are required' }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Get all races with this event name
    const racesResult = await env.DB.prepare(`
      SELECT id, strava_activity_id, athlete_id
      FROM races
      WHERE event_name = ?
    `).bind(old_name).all();

    const races = racesResult.results as { id: number; strava_activity_id: number; athlete_id: number }[];

    if (races.length === 0) {
      return new Response(
        JSON.stringify({ error: `No activities found with event name "${old_name}"` }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Update all races with the new event name
    await env.DB.prepare(`
      UPDATE races
      SET event_name = ?
      WHERE event_name = ?
    `).bind(new_name, old_name).run();

    // Update activity_event_mappings table to persist across syncs
    for (const race of races) {
      await env.DB.prepare(`
        INSERT INTO activity_event_mappings (strava_activity_id, athlete_id, event_name, is_hidden, updated_at)
        VALUES (?, ?, ?, COALESCE((SELECT is_hidden FROM activity_event_mappings WHERE strava_activity_id = ? AND athlete_id = ?), 0), strftime('%s', 'now'))
        ON CONFLICT(strava_activity_id, athlete_id)
        DO UPDATE SET event_name = excluded.event_name, updated_at = excluded.updated_at
      `).bind(race.strava_activity_id, race.athlete_id, new_name, race.strava_activity_id, race.athlete_id).run();
    }

    console.log(`Renamed event "${old_name}" to "${new_name}" for ${races.length} activities`);

    return new Response(
      JSON.stringify({
        message: `Successfully renamed "${old_name}" to "${new_name}" for ${races.length} activit${races.length !== 1 ? 'ies' : 'y'}`,
        updated_count: races.length
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
    console.error('Failed to rename event:', error);
    return new Response(
      JSON.stringify({
        error: 'Failed to rename event',
        details: error instanceof Error ? error.message : 'Unknown error'
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

/**
 * Get all event suggestions
 * GET /api/event-suggestions?admin_strava_id=123&status=pending
 */
export async function getEventSuggestions(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const adminStravaId = parseInt(url.searchParams.get('admin_strava_id') || '0');
  const status = url.searchParams.get('status') || 'pending';

  // Verify admin access
  if (!adminStravaId || !(await isAdmin(env, adminStravaId))) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const result = await env.DB.prepare(`
      SELECT *
      FROM event_suggestions
      WHERE status = ?
      ORDER BY confidence DESC, race_count DESC, created_at DESC
    `).bind(status).all();

    const suggestions = result.results as unknown as EventSuggestion[];

    // Recalculate avg_distance using manual_distance if available
    const enrichedSuggestions = await Promise.all(
      suggestions.map(async (suggestion) => {
        const raceIds = JSON.parse(suggestion.race_ids) as number[];

        // Fetch races to get current manual_distance values
        const racesResult = await env.DB.prepare(`
          SELECT COALESCE(manual_distance, distance) as effective_distance
          FROM races
          WHERE id IN (${raceIds.map(() => '?').join(',')})
        `).bind(...raceIds).all();

        const races = racesResult.results as { effective_distance: number }[];

        // Calculate average distance using manual_distance if available
        const avgDistance = races.length > 0
          ? Math.round(races.reduce((sum, r) => sum + r.effective_distance, 0) / races.length)
          : suggestion.avg_distance;

        return {
          ...suggestion,
          avg_distance: avgDistance,
        };
      })
    );

    return new Response(JSON.stringify({ suggestions: enrichedSuggestions }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error('Failed to fetch event suggestions:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to fetch event suggestions' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

/**
 * Update event suggestion (approve/reject/edit)
 * PATCH /api/event-suggestions/:id
 */
export async function updateEventSuggestion(
  request: Request,
  env: Env,
  suggestionId: number
): Promise<Response> {
  try {
    const body = await request.json() as {
      admin_strava_id: number;
      status?: 'approved' | 'rejected';
      event_name?: string;
    };

    const { admin_strava_id, status, event_name } = body;

    // Verify admin access
    if (!admin_strava_id || !(await isAdmin(env, admin_strava_id))) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Get the suggestion
    const suggestion = await env.DB.prepare(
      'SELECT * FROM event_suggestions WHERE id = ?'
    ).bind(suggestionId).first() as unknown as EventSuggestion;

    if (!suggestion) {
      return new Response(JSON.stringify({ error: 'Suggestion not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Get athlete ID from strava_id
    const athlete = await env.DB.prepare(
      'SELECT id FROM athletes WHERE strava_id = ?'
    ).bind(admin_strava_id).first() as { id: number } | null;

    if (!athlete) {
      return new Response(JSON.stringify({ error: 'Admin athlete not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const finalEventName = event_name || suggestion.suggested_event_name;

    if (status === 'approved') {
      // Apply the event name to all races in the suggestion
      const raceIds = JSON.parse(suggestion.race_ids) as number[];

      await env.DB.prepare(`
        UPDATE races
        SET event_name = ?
        WHERE id IN (${raceIds.map(() => '?').join(',')})
      `).bind(finalEventName, ...raceIds).run();

      // Update suggestion status
      await env.DB.prepare(`
        UPDATE event_suggestions
        SET status = 'approved',
            suggested_event_name = ?,
            reviewed_at = CURRENT_TIMESTAMP,
            reviewed_by = ?
        WHERE id = ?
      `).bind(finalEventName, athlete.id, suggestionId).run();

      console.log(`Approved suggestion ${suggestionId}: "${finalEventName}" for ${raceIds.length} races`);
    } else if (status === 'rejected') {
      // If the suggestion was previously approved, remove event_name from races
      if (suggestion.status === 'approved') {
        const raceIds = JSON.parse(suggestion.race_ids) as number[];

        await env.DB.prepare(`
          UPDATE races
          SET event_name = NULL
          WHERE id IN (${raceIds.map(() => '?').join(',')})
        `).bind(...raceIds).run();

        console.log(`Revoked suggestion ${suggestionId}: removed event name from ${raceIds.length} races`);
      }

      // Update suggestion status
      await env.DB.prepare(`
        UPDATE event_suggestions
        SET status = 'rejected',
            reviewed_at = CURRENT_TIMESTAMP,
            reviewed_by = ?
        WHERE id = ?
      `).bind(athlete.id, suggestionId).run();

      console.log(`Rejected suggestion ${suggestionId}`);
    }

    return new Response(
      JSON.stringify({ message: 'Suggestion updated successfully' }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (error) {
    console.error('Failed to update event suggestion:', error);
    return new Response(
      JSON.stringify({
        error: 'Failed to update suggestion',
        details: error instanceof Error ? error.message : 'Unknown error'
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

/**
 * Trigger AI event analysis manually
 * POST /api/event-suggestions/analyze
 */
export async function triggerEventAnalysis(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  try {
    const body = await request.json() as {
      admin_strava_id: number;
    };

    const { admin_strava_id } = body;

    // Verify admin access
    if (!admin_strava_id || !(await isAdmin(env, admin_strava_id))) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Trigger analysis in the background
    ctx.waitUntil(analyzeEvents(env));

    return new Response(
      JSON.stringify({ message: 'Event analysis triggered successfully' }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (error) {
    console.error('Failed to trigger event analysis:', error);
    return new Response(
      JSON.stringify({
        error: 'Failed to trigger analysis',
        details: error instanceof Error ? error.message : 'Unknown error'
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}
