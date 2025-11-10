// Main Worker entry point

import { Env } from './types';
import { handleAuthorize, handleCallback, handleDisconnect } from './auth/oauth';
import { syncAllAthletes } from './cron/sync';
import { getRaces, getStats, getAthletes, updateRaceTime } from './api/races';

export default {
  /**
   * Handle HTTP requests
   */
  async fetch(request: Request, env: Env): Promise<Response> {
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
   */
  async scheduled(event: ScheduledEvent, env: Env): Promise<void> {
    console.log('Cron trigger fired:', new Date(event.scheduledTime).toISOString());

    try {
      await syncAllAthletes(env);
    } catch (error) {
      console.error('Scheduled sync failed:', error);
      // Error is already logged in sync function
    }
  },
};
