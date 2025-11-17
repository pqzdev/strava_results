// API endpoint to get list of athletes for individual parkrun scraping

import { Env } from '../types';

/**
 * GET /api/parkrun/athletes-to-scrape
 *
 * Returns list of athletes that need their individual parkrun history scraped
 *
 * Query parameters:
 * - mode: 'new' (only athletes not yet scraped) or 'all' (all athletes for refresh)
 */
export async function getAthletesToScrape(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url);
    const mode = url.searchParams.get('mode') || 'new';

    if (!['new', 'all'].includes(mode)) {
      return new Response(
        JSON.stringify({ error: 'Invalid mode. Must be "new" or "all"' }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }

    let athletes: { parkrun_athlete_id: string; athlete_name: string }[] = [];

    if (mode === 'new') {
      // Get athletes who have never been scraped
      // Find all unique parkrun_athlete_id values that exist in parkrun_results
      // but NOT in parkrun_athlete_scraping_log (or have status='failed')

      const results = await env.DB.prepare(
        `SELECT DISTINCT
           pr.parkrun_athlete_id,
           pr.athlete_name
         FROM parkrun_results pr
         LEFT JOIN parkrun_athlete_scraping_log log
           ON pr.parkrun_athlete_id = log.parkrun_athlete_id
         WHERE pr.parkrun_athlete_id IS NOT NULL
           AND pr.parkrun_athlete_id != ''
           AND (log.parkrun_athlete_id IS NULL OR log.status = 'failed')
         ORDER BY pr.athlete_name`
      ).all<{ parkrun_athlete_id: string; athlete_name: string }>();

      athletes = results.results || [];

    } else if (mode === 'all') {
      // Get all athletes with parkrun IDs for full refresh
      const results = await env.DB.prepare(
        `SELECT DISTINCT
           parkrun_athlete_id,
           athlete_name
         FROM parkrun_results
         WHERE parkrun_athlete_id IS NOT NULL
           AND parkrun_athlete_id != ''
         ORDER BY athlete_name`
      ).all<{ parkrun_athlete_id: string; athlete_name: string }>();

      athletes = results.results || [];
    }

    return new Response(
      JSON.stringify({
        mode,
        count: athletes.length,
        athletes,
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );

  } catch (error) {
    console.error('Error getting athletes to scrape:', error);
    return new Response(
      JSON.stringify({
        error: 'Failed to get athletes to scrape',
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
