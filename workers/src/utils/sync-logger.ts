// Utility for logging sync progress to database
import { Env } from '../types';

export type LogLevel = 'info' | 'warning' | 'error' | 'success';

export interface SyncLogEntry {
  athlete_id: number;
  sync_session_id: string;
  log_level: LogLevel;
  message: string;
  metadata?: Record<string, any>;
}

/**
 * Log sync progress to database
 */
export async function logSyncProgress(
  env: Env,
  athleteId: number,
  sessionId: string,
  level: LogLevel,
  message: string,
  metadata?: Record<string, any>
): Promise<void> {
  try {
    const timestamp = Math.floor(Date.now() / 1000);
    await env.DB.prepare(
      `INSERT INTO sync_logs (athlete_id, sync_session_id, log_level, message, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(
        athleteId,
        sessionId,
        level,
        message,
        metadata ? JSON.stringify(metadata) : null,
        timestamp
      )
      .run();
  } catch (error) {
    // Don't let logging errors crash the sync
    console.error('Failed to log sync progress:', error);
  }
}

/**
 * Fetch sync logs for a session
 */
export async function getSyncLogs(
  env: Env,
  sessionId: string,
  limit: number = 100
): Promise<SyncLogEntry[]> {
  const results = await env.DB.prepare(
    `SELECT athlete_id, sync_session_id, log_level, message, metadata, created_at
     FROM sync_logs
     WHERE sync_session_id = ?
     ORDER BY created_at ASC
     LIMIT ?`
  )
    .bind(sessionId, limit)
    .all<SyncLogEntry & { created_at: number }>();

  return results.results || [];
}

/**
 * Clean up old sync logs (keep last 7 days)
 */
export async function cleanupOldSyncLogs(env: Env): Promise<void> {
  const sevenDaysAgo = Math.floor(Date.now() / 1000) - (7 * 24 * 60 * 60);
  await env.DB.prepare(
    `DELETE FROM sync_logs WHERE created_at < ?`
  )
    .bind(sevenDaysAgo)
    .run();
}
