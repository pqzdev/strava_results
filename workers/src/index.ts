// Main Worker entry point

import { Env } from './types';
import { handleAuthorize, handleCallback, handleDisconnect } from './auth/oauth';
import { syncAllAthletes } from './cron/sync';
import { getRaces, getStats, getAthletes, updateRaceTime, updateRaceDistance, updateRaceEvent } from './api/races';
import { getAdminAthletes, updateAthlete, deleteAthlete, triggerAthleteSync, stopAthleteSync, resetStuckSyncs, getAdminSyncLogs } from './api/admin';
import { getParkrunResults, getParkrunStats, getParkrunAthletes, updateParkrunAthlete, getParkrunByDate } from './api/parkrun';
import { importParkrunCSV } from './api/parkrun-import';
import { getEventSuggestions, updateEventSuggestion, triggerEventAnalysis, getEventNames } from './api/events';
import { backfillPolylines } from './api/polyline-backfill';
import { extractActivities, submitActivities, getManualSubmissions, updateSubmission, approveSubmission, rejectSubmission, deleteSubmission } from './api/manual-submissions';
import { googleLogin, googleCallback, logout, getCurrentAdmin } from './api/google-auth';
import {
  processNextQueuedJob,
  createSyncJob,
  queueAllAthletes,
  getQueueStats,
  cleanupOldJobs,
} from './queue/queue-processor';

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
      // Strava OAuth routes
      if (path === '/auth/authorize' && request.method === 'GET') {
        return handleAuthorize(env);
      }

      if (path === '/auth/callback' && request.method === 'GET') {
        return handleCallback(request, env);
      }

      if (path === '/auth/disconnect' && request.method === 'DELETE') {
        return handleDisconnect(request, env);
      }

      // Google OAuth routes (Admin login)
      if (path === '/auth/google/login' && request.method === 'GET') {
        return googleLogin(request, env);
      }

      if (path === '/auth/google/callback' && request.method === 'GET') {
        return googleCallback(request, env);
      }

      if (path === '/auth/logout' && request.method === 'POST') {
        return logout(request);
      }

      if (path === '/auth/me' && request.method === 'GET') {
        return getCurrentAdmin(request, env);
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

      // Update race event name
      const raceEventMatch = path.match(/^\/api\/races\/(\d+)\/event$/);
      if (raceEventMatch && request.method === 'PATCH') {
        return updateRaceEvent(request, env, parseInt(raceEventMatch[1]));
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

      // Stop sync
      const adminStopSyncMatch = path.match(/^\/api\/admin\/athletes\/(\d+)\/sync\/stop$/);
      if (adminStopSyncMatch && request.method === 'POST') {
        return stopAthleteSync(request, env, parseInt(adminStopSyncMatch[1]));
      }

      // Reset stuck syncs
      if (path === '/api/admin/reset-stuck-syncs' && request.method === 'POST') {
        return resetStuckSyncs(request, env);
      }

      // Get sync logs for a session
      if (path === '/api/admin/sync-logs' && request.method === 'GET') {
        return getAdminSyncLogs(request, env);
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

      // Event routes
      if (path === '/api/events/names' && request.method === 'GET') {
        return getEventNames(request, env);
      }

      // Event suggestion routes
      if (path === '/api/event-suggestions' && request.method === 'GET') {
        return getEventSuggestions(request, env);
      }

      const eventSuggestionMatch = path.match(/^\/api\/event-suggestions\/(\d+)$/);
      if (eventSuggestionMatch && request.method === 'PATCH') {
        return updateEventSuggestion(request, env, parseInt(eventSuggestionMatch[1]));
      }

      if (path === '/api/event-suggestions/analyze' && request.method === 'POST') {
        return triggerEventAnalysis(request, env, ctx);
      }

      // Polyline backfill route
      if (path === '/api/polyline/backfill' && request.method === 'POST') {
        return backfillPolylines(request, env);
      }

      // Manual submissions API routes
      if (path === '/api/manual-submissions/extract' && request.method === 'POST') {
        return extractActivities(request, env);
      }

      if (path === '/api/manual-submissions/submit' && request.method === 'POST') {
        return submitActivities(request, env);
      }

      if (path === '/api/admin/manual-submissions' && request.method === 'GET') {
        return getManualSubmissions(request, env);
      }

      const submissionUpdateMatch = path.match(/^\/api\/admin\/manual-submissions\/(\d+)$/);
      if (submissionUpdateMatch && request.method === 'PATCH') {
        return updateSubmission(request, env, parseInt(submissionUpdateMatch[1]));
      }

      const approveMatch = path.match(/^\/api\/admin\/manual-submissions\/(\d+)\/approve$/);
      if (approveMatch && request.method === 'POST') {
        return approveSubmission(request, env, parseInt(approveMatch[1]));
      }

      const rejectMatch = path.match(/^\/api\/admin\/manual-submissions\/(\d+)\/reject$/);
      if (rejectMatch && request.method === 'POST') {
        return rejectSubmission(request, env, parseInt(rejectMatch[1]));
      }

      const deleteMatch = path.match(/^\/api\/admin\/manual-submissions\/(\d+)\/delete$/);
      if (deleteMatch && request.method === 'DELETE') {
        return deleteSubmission(request, env, parseInt(deleteMatch[1]));
      }

      // Queue management API routes
      // Get queue statistics
      if (path === '/api/queue/stats' && request.method === 'GET') {
        const stats = await getQueueStats(env);
        return new Response(JSON.stringify(stats), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }

      // Queue all athletes for sync
      if (path === '/api/queue/all' && request.method === 'POST') {
        const body = await request.json() as { jobType?: 'full_sync' | 'incremental_sync'; priority?: number };
        const jobIds = await queueAllAthletes(env, body.jobType || 'full_sync', body.priority || 0);
        return new Response(JSON.stringify({
          message: `Queued ${jobIds.length} athletes`,
          jobIds,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }

      // Queue specific athlete for sync
      const queueAthleteMatch = path.match(/^\/api\/queue\/athletes\/(\d+)$/);
      if (queueAthleteMatch && request.method === 'POST') {
        const athleteId = parseInt(queueAthleteMatch[1]);
        const body = await request.json() as { jobType?: 'full_sync' | 'incremental_sync'; priority?: number };
        const jobId = await createSyncJob(env, athleteId, body.jobType || 'full_sync', body.priority || 0);
        return new Response(JSON.stringify({
          message: `Queued athlete ${athleteId}`,
          jobId,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }

      // Clean up old jobs
      if (path === '/api/queue/cleanup' && request.method === 'POST') {
        const deleted = await cleanupOldJobs(env);
        return new Response(JSON.stringify({
          message: `Cleaned up ${deleted} old jobs`,
          deleted,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
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
   * Two cron schedules:
   * 1. Weekly (Monday 2 AM UTC) - Queue all athletes for sync
   * 2. Every 2 minutes - Process next pending sync job from queue
   */
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    console.log('Cron trigger fired:', event.cron, new Date(event.scheduledTime).toISOString());

    try {
      // Determine which cron triggered this
      if (event.cron === '0 2 * * 1') {
        // Weekly full sync: Queue all athletes
        console.log('Weekly cron: Queueing all athletes for full sync...');
        const jobIds = await queueAllAthletes(env, 'full_sync', 0);
        console.log(`Queued ${jobIds.length} athletes for full sync`);

        // Also clean up old completed jobs
        const deleted = await cleanupOldJobs(env);
        console.log(`Cleaned up ${deleted} old queue jobs`);

      } else if (event.cron === '*/2 * * * *') {
        // Queue processor: Process next pending job
        console.log('Queue processor cron: Processing next pending job...');
        await processNextQueuedJob(env, ctx);

      } else {
        console.warn('Unknown cron schedule:', event.cron);
      }
    } catch (error) {
      console.error('Scheduled job failed:', error);
      // Error is already logged in the respective functions
    }
  },
};
