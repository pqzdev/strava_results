// Main Worker entry point

import { Env } from './types';
import { handleAuthorize, handleCallback, handleDisconnect } from './auth/oauth';
import { syncAllAthletes } from './cron/sync';
import { getRaces, getStats, getAthletes, updateRaceTime, updateRaceDistance } from './api/races';
import { getAdminAthletes, updateAthlete, deleteAthlete, triggerAthleteSync, resetStuckSyncs } from './api/admin';
import { getParkrunResults, getParkrunStats, getParkrunAthletes, updateParkrunAthlete, getParkrunByDate } from './api/parkrun';
import { importParkrunCSV } from './api/parkrun-import';

export default {
  /**
   * Handle HTTP requests
   */
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    // Route handlers
    try {
      // OAuth routes
      if (path === '/auth/authorize' && request.method === 'GET') {
        return handleAuthorize(env);
      }

      if (path === '/auth/callback' && request.method === 'GET') {
        return handleCallback(request, env);
      }

      if (path === '/auth/disconnect' && request.method === 'DELETE') {
        return handleDisconnect(request, env);
      }

      // API routes
      if (path === '/api/races' && request.method === 'GET') {
        return getRaces(request, env);
      }

      if (path === '/api/stats' && request.method === 'GET') {
        return getStats(env);
      }

      if (path === '/api/athletes' && request.method === 'GET') {
        return getAthletes(env);
      }

      // Update race manual time
      const raceTimeMatch = path.match(/^\/api\/races\/(\d+)\/time$/);
      if (raceTimeMatch && request.method === 'PATCH') {
        return updateRaceTime(request, env, parseInt(raceTimeMatch[1]));
      }

      // Update race manual distance
      const raceDistanceMatch = path.match(/^\/api\/races\/(\d+)\/distance$/);
      if (raceDistanceMatch && request.method === 'PATCH') {
        return updateRaceDistance(request, env, parseInt(raceDistanceMatch[1]));
      }

      // Admin routes
      if (path === '/api/admin/athletes' && request.method === 'GET') {
        return getAdminAthletes(request, env);
      }

      const adminAthleteMatch = path.match(/^\/api\/admin\/athletes\/(\d+)$/);
      if (adminAthleteMatch && request.method === 'PATCH') {
        return updateAthlete(request, env, parseInt(adminAthleteMatch[1]));
      }

      if (adminAthleteMatch && request.method === 'DELETE') {
        return deleteAthlete(request, env, parseInt(adminAthleteMatch[1]));
      }

      const adminSyncMatch = path.match(/^\/api\/admin\/athletes\/(\d+)\/sync$/);
      if (adminSyncMatch && request.method === 'POST') {
        return triggerAthleteSync(request, env, ctx, parseInt(adminSyncMatch[1]));
      }

      // Reset stuck syncs
      if (path === '/api/admin/reset-stuck-syncs' && request.method === 'POST') {
        return resetStuckSyncs(request, env);
      }

      // Manual sync trigger (for testing)
      if (path === '/api/sync' && request.method === 'POST') {
        // In production, you'd want to authenticate this endpoint
        await syncAllAthletes(env);
        return new Response(
          JSON.stringify({ message: 'Sync triggered successfully' }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }

      // Parkrun API routes
      if (path === '/api/parkrun' && request.method === 'GET') {
        return getParkrunResults(request, env);
      }

      if (path === '/api/parkrun/stats' && request.method === 'GET') {
        return getParkrunStats(request, env);
      }

      if (path === '/api/parkrun/by-date' && request.method === 'GET') {
        return getParkrunByDate(request, env);
      }

      if (path === '/api/parkrun/import' && request.method === 'POST') {
        return importParkrunCSV(request, env);
      }

      if (path === '/api/parkrun/athletes' && request.method === 'GET') {
        return getParkrunAthletes(request, env);
      }

      // Update parkrun athlete visibility
      const parkrunAthleteMatch = path.match(/^\/api\/parkrun\/athletes\/(.+)$/);
      if (parkrunAthleteMatch && request.method === 'PATCH') {
        const athleteName = decodeURIComponent(parkrunAthleteMatch[1]);
        return updateParkrunAthlete(request, env, athleteName);
      }

      // Health check
      if (path === '/health') {
        return new Response(JSON.stringify({ status: 'healthy' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // 404 for unknown routes
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      console.error('Request handler error:', error);
      return new Response(
        JSON.stringify({
          error: 'Internal server error',
          details: error instanceof Error ? error.message : 'Unknown error',
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
  },

  /**
   * Handle scheduled cron triggers
   * Note: Only Strava sync runs on schedule. Parkrun data must be collected manually
   * using the browser console scraper (docs/parkrun-smart-scraper.js) due to anti-scraping measures.
   */
  async scheduled(event: ScheduledEvent, env: Env): Promise<void> {
    console.log('Cron trigger fired:', new Date(event.scheduledTime).toISOString());

    try {
      // Sync Strava activities from all connected athletes
      await syncAllAthletes(env);
    } catch (error) {
      console.error('Scheduled sync failed:', error);
      // Error is already logged in sync function
    }
  },
};
