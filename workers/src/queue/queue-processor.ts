// Queue processor for reliable batched Strava activity downloads
// Uses D1 database as a persistent, ACID-compliant queue

import { Env } from '../types';
import { syncAthlete } from './sync-queue';
import { logSyncProgress } from '../utils/sync-logger';
import { getAthleteByStravaId } from '../utils/db';

interface QueueJob {
  id: number;
  athlete_id: number;
  job_type: 'full_sync' | 'incremental_sync';
  status: 'pending' | 'processing' | 'completed' | 'failed';
  priority: number;
  created_at: number;
  started_at: number | null;
  completed_at: number | null;
  error_message: string | null;
  retry_count: number;
  max_retries: number;
  last_processed_before: number | null;
  activities_synced: number;
  total_activities_expected: number | null;
  sync_session_id: string | null;
}

const MAX_PROCESSING_TIME = 25000; // 25 seconds (5s buffer before 30s timeout)
const ACTIVITIES_PER_PAGE = 200; // Strava API returns 200 activities per page
const DELAY_BETWEEN_PAGES = 1000; // 1 second delay for rate limiting

/**
 * Process the next pending job from the queue
 * This is called by a cron trigger (e.g., every 2 minutes)
 */
export async function processNextQueuedJob(env: Env, ctx: ExecutionContext): Promise<void> {
  console.log('Queue processor: Checking for pending jobs...');

  try {
    // Atomically claim the next pending job with highest priority
    const job = await claimNextJob(env);

    if (!job) {
      console.log('Queue processor: No pending jobs found');
      return;
    }

    console.log(`Queue processor: Claimed job ${job.id} (athlete: ${job.athlete_id}, type: ${job.job_type}, retry: ${job.retry_count}/${job.max_retries})`);

    // Process the job with timeout safety
    await processJobWithTimeout(job, env, ctx);

  } catch (error) {
    console.error('Queue processor: Fatal error:', error);
    // Don't throw - we want the cron to continue running
  }
}

/**
 * Atomically claim the next pending job from the queue
 * Uses SQL UPDATE...RETURNING to prevent race conditions
 */
async function claimNextJob(env: Env): Promise<QueueJob | null> {
  const now = Date.now();

  // Find and claim the highest priority pending job atomically
  // This prevents multiple workers from claiming the same job
  const result = await env.DB.prepare(`
    UPDATE sync_queue
    SET status = 'processing',
        started_at = ?
    WHERE id = (
      SELECT id FROM sync_queue
      WHERE status = 'pending'
      AND retry_count < max_retries
      ORDER BY priority DESC, created_at ASC
      LIMIT 1
    )
    RETURNING *
  `).bind(now).first<QueueJob>();

  return result || null;
}

/**
 * Process a job with timeout safety
 * If we approach the 30-second worker timeout, we save progress and re-queue
 */
async function processJobWithTimeout(job: QueueJob, env: Env, ctx: ExecutionContext): Promise<void> {
  const startTime = Date.now();

  try {
    // Get athlete info
    const athlete = await env.DB.prepare(
      'SELECT * FROM athletes WHERE id = ?'
    ).bind(job.athlete_id).first();

    if (!athlete) {
      throw new Error(`Athlete ${job.athlete_id} not found`);
    }

    // Generate or reuse session ID for logging
    const sessionId = job.sync_session_id || `queue-${job.id}-${Date.now()}`;

    if (!job.sync_session_id) {
      // Store session ID for future continuation jobs
      await env.DB.prepare(
        'UPDATE sync_queue SET sync_session_id = ? WHERE id = ?'
      ).bind(sessionId, job.id).run();
    }

    console.log(`Processing job ${job.id}: ${job.job_type} for athlete ${athlete.strava_id} (session: ${sessionId})`);

    await logSyncProgress(env, job.athlete_id, sessionId, 'info',
      `Queue job ${job.id} started (${job.job_type})`,
      { jobId: job.id, jobType: job.job_type, retryCount: job.retry_count }
    );

    // Determine if this is a full sync or incremental
    const isFullSync = job.job_type === 'full_sync';

    // Use the existing syncAthlete function with continuation support
    // The syncAthlete function handles batching internally and processes until complete
    await syncAthlete(
      athlete.strava_id as number,
      env,
      false, // isInitialSync - not used for queue jobs
      isFullSync,
      ctx,
      job.last_processed_before || undefined, // continuation timestamp
      sessionId
    );

    // Job completed successfully
    console.log(`Job ${job.id} completed successfully`);

    await logSyncProgress(env, job.athlete_id, sessionId, 'success',
      `Queue job ${job.id} completed successfully`,
      { jobId: job.id, activitiesSynced: job.activities_synced }
    );

    await markJobCompleted(env, job.id);

  } catch (error) {
    console.error(`Job ${job.id} failed:`, error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    // Log error
    if (job.sync_session_id) {
      await logSyncProgress(env, job.athlete_id, job.sync_session_id, 'error',
        `Queue job ${job.id} failed: ${errorMessage}`,
        { jobId: job.id, error: errorMessage, retryCount: job.retry_count }
      );
    }

    // Handle retry logic
    await handleJobFailure(env, job, errorMessage);
  }
}

/**
 * Mark a job as completed
 */
async function markJobCompleted(env: Env, jobId: number): Promise<void> {
  const now = Date.now();

  await env.DB.prepare(`
    UPDATE sync_queue
    SET status = 'completed',
        completed_at = ?
    WHERE id = ?
  `).bind(now, jobId).run();

  console.log(`Job ${jobId} marked as completed`);
}

/**
 * Handle job failure with retry logic
 */
async function handleJobFailure(env: Env, job: QueueJob, errorMessage: string): Promise<void> {
  const newRetryCount = job.retry_count + 1;
  const shouldRetry = newRetryCount < job.max_retries;
  const newStatus = shouldRetry ? 'pending' : 'failed';

  await env.DB.prepare(`
    UPDATE sync_queue
    SET status = ?,
        retry_count = ?,
        error_message = ?,
        started_at = NULL
    WHERE id = ?
  `).bind(newStatus, newRetryCount, errorMessage, job.id).run();

  if (shouldRetry) {
    console.log(`Job ${job.id} will be retried (attempt ${newRetryCount}/${job.max_retries})`);
  } else {
    console.log(`Job ${job.id} marked as failed after ${newRetryCount} attempts`);
  }
}

/**
 * Create a new sync job for an athlete
 */
export async function createSyncJob(
  env: Env,
  athleteId: number,
  jobType: 'full_sync' | 'incremental_sync' = 'full_sync',
  priority: number = 0,
  maxRetries: number = 0
): Promise<number> {
  const now = Date.now();

  // Check if there's already a pending or processing job for this athlete
  const existingJob = await env.DB.prepare(`
    SELECT id, status FROM sync_queue
    WHERE athlete_id = ?
    AND status IN ('pending', 'processing')
    ORDER BY created_at DESC
    LIMIT 1
  `).bind(athleteId).first<{ id: number; status: string }>();

  if (existingJob) {
    console.log(`Athlete ${athleteId} already has a ${existingJob.status} job (${existingJob.id}). Skipping.`);
    return existingJob.id;
  }

  // Create new job
  const result = await env.DB.prepare(`
    INSERT INTO sync_queue (
      athlete_id,
      job_type,
      status,
      priority,
      created_at,
      max_retries
    ) VALUES (?, ?, 'pending', ?, ?, ?)
    RETURNING id
  `).bind(athleteId, jobType, priority, now, maxRetries).first<{ id: number }>();

  const jobId = result?.id;
  if (!jobId) {
    throw new Error('Failed to create sync job');
  }

  console.log(`Created ${jobType} job ${jobId} for athlete ${athleteId} (priority: ${priority})`);
  return jobId;
}

/**
 * Create sync jobs for all athletes
 */
export async function queueAllAthletes(
  env: Env,
  jobType: 'full_sync' | 'incremental_sync' = 'full_sync',
  priority: number = 0
): Promise<number[]> {
  // Get all athletes with valid tokens
  const athletes = await env.DB.prepare(`
    SELECT id FROM athletes
    WHERE access_token IS NOT NULL
    ORDER BY id ASC
  `).all<{ id: number }>();

  const jobIds: number[] = [];

  for (const athlete of athletes.results || []) {
    try {
      const jobId = await createSyncJob(env, athlete.id, jobType, priority);
      jobIds.push(jobId);
    } catch (error) {
      console.error(`Failed to create job for athlete ${athlete.id}:`, error);
    }
  }

  console.log(`Queued ${jobIds.length} athletes for ${jobType}`);
  return jobIds;
}

/**
 * Get queue statistics
 */
export async function getQueueStats(env: Env): Promise<{
  pending: number;
  processing: number;
  completed_24h: number;
  failed_24h: number;
  total_queued: number;
}> {
  const now = Date.now();
  const twentyFourHoursAgo = now - (24 * 60 * 60 * 1000);

  const stats = await env.DB.prepare(`
    SELECT
      COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
      COUNT(CASE WHEN status = 'processing' THEN 1 END) as processing,
      COUNT(CASE WHEN status = 'completed' AND completed_at > ? THEN 1 END) as completed_24h,
      COUNT(CASE WHEN status = 'failed' AND completed_at > ? THEN 1 END) as failed_24h,
      COUNT(*) as total_queued
    FROM sync_queue
    WHERE created_at > ?
  `).bind(twentyFourHoursAgo, twentyFourHoursAgo, twentyFourHoursAgo).first();

  return {
    pending: Number(stats?.pending) || 0,
    processing: Number(stats?.processing) || 0,
    completed_24h: Number(stats?.completed_24h) || 0,
    failed_24h: Number(stats?.failed_24h) || 0,
    total_queued: Number(stats?.total_queued) || 0,
  };
}

/**
 * Clean up old completed/failed jobs (older than 7 days)
 */
export async function cleanupOldJobs(env: Env): Promise<number> {
  const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);

  const result = await env.DB.prepare(`
    DELETE FROM sync_queue
    WHERE status IN ('completed', 'failed')
    AND completed_at < ?
  `).bind(sevenDaysAgo).run();

  const deleted = result.meta.changes || 0;
  console.log(`Cleaned up ${deleted} old queue jobs`);
  return deleted;
}

/**
 * Cancel pending jobs (delete jobs with status 'pending')
 * @param jobIds - Optional array of specific job IDs to cancel. If omitted, cancels ALL pending jobs.
 */
export async function cancelPendingJobs(
  env: Env,
  jobIds?: number[]
): Promise<number> {
  let query = `DELETE FROM sync_queue WHERE status = 'pending'`;
  const params: any[] = [];

  if (jobIds && jobIds.length > 0) {
    const placeholders = jobIds.map(() => '?').join(',');
    query += ` AND id IN (${placeholders})`;
    params.push(...jobIds);
  }

  const result = await env.DB.prepare(query).bind(...params).run();
  const deleted = result.meta.changes || 0;

  console.log(`Cancelled ${deleted} pending job(s)${jobIds ? ` (IDs: ${jobIds.join(', ')})` : ''}`);
  return deleted;
}
