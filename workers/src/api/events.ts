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

    return new Response(JSON.stringify({ suggestions }), {
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
      // Just update the suggestion status
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
