import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import './SyncMonitor.css';

interface Athlete {
  id: number;
  firstname: string;
  lastname: string;
  sync_status: string;
  sync_error?: string;
  total_activities_count: number;
  last_synced_at?: number;
  sync_session_id?: string;
  current_batch_number?: number;
}

interface SyncLog {
  athlete_id: number;
  sync_session_id: string;
  log_level: 'info' | 'warning' | 'error' | 'success';
  message: string;
  metadata?: string;
  created_at: number;
}

// WOOD-8: Batch progress types
interface SyncBatch {
  id: number;
  batch_number: number;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  activities_fetched: number;
  races_added: number;
  races_removed: number;
  started_at?: number;
  completed_at?: number;
  error_message?: string;
}

interface BatchProgress {
  session_id: string;
  summary: {
    total_batches: number;
    completed_batches: number;
    failed_batches: number;
    total_activities: number;
    total_races_added: number;
    total_races_removed: number;
    current_batch?: number;
    estimated_progress: number;
  };
  batches: SyncBatch[];
}

export default function SyncMonitor() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const athleteId = searchParams.get('athlete_id');
  const sessionId = searchParams.get('session_id');

  const [athlete, setAthlete] = useState<Athlete | null>(null);
  const [logs, setLogs] = useState<SyncLog[]>([]);
  const [batchProgress, setBatchProgress] = useState<BatchProgress | null>(null); // WOOD-8
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());

  useEffect(() => {
    if (!athleteId) {
      setError('No athlete ID provided');
      setLoading(false);
      return;
    }

    const fetchStatus = async () => {
      try {
        const currentAthleteId = parseInt(
          localStorage.getItem('strava_athlete_id') || '0'
        );

        const response = await fetch(
          `/api/admin/athletes?admin_strava_id=${currentAthleteId}`
        );

        if (!response.ok) {
          throw new Error('Failed to fetch athlete status');
        }

        const data = await response.json();
        const targetAthlete = data.athletes.find(
          (a: Athlete) => a.id === parseInt(athleteId)
        );

        if (targetAthlete) {
          setAthlete(targetAthlete);
          setLastUpdate(new Date());
        }
        setLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch status');
        setLoading(false);
      }
    };

    // Initial fetch
    fetchStatus();

    // Poll every 2 seconds while sync is in progress
    const interval = setInterval(() => {
      if (athlete?.sync_status === 'in_progress') {
        fetchStatus();
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [athleteId, athlete?.sync_status]);

  // Fetch sync logs if session_id is provided
  useEffect(() => {
    if (!sessionId) return;

    const fetchLogs = async () => {
      try {
        const currentAthleteId = parseInt(
          localStorage.getItem('strava_athlete_id') || '0'
        );

        const response = await fetch(
          `/api/admin/sync-logs?session_id=${sessionId}&admin_strava_id=${currentAthleteId}`
        );

        if (response.ok) {
          const data = await response.json();
          setLogs(data.logs || []);
        }
      } catch (err) {
        console.error('Failed to fetch sync logs:', err);
      }
    };

    // Initial fetch
    fetchLogs();

    // Poll every 2 seconds while sync is in progress
    const interval = setInterval(() => {
      if (athlete?.sync_status === 'in_progress') {
        fetchLogs();
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [sessionId, athlete?.sync_status]);

  // WOOD-8: Fetch batch progress if session_id is provided
  useEffect(() => {
    // Use athlete's session_id if available, otherwise use URL param
    const effectiveSessionId = athlete?.sync_session_id || sessionId;
    if (!effectiveSessionId) return;

    const fetchBatchProgress = async () => {
      try {
        const currentAthleteId = parseInt(
          localStorage.getItem('strava_athlete_id') || '0'
        );

        const response = await fetch(
          `/api/admin/batched-sync/${effectiveSessionId}/progress?admin_strava_id=${currentAthleteId}`
        );

        if (response.ok) {
          const data = await response.json();
          setBatchProgress(data);
        }
      } catch (err) {
        console.error('Failed to fetch batch progress:', err);
      }
    };

    // Initial fetch
    fetchBatchProgress();

    // Poll every 2 seconds while sync is in progress
    const interval = setInterval(() => {
      if (athlete?.sync_status === 'in_progress') {
        fetchBatchProgress();
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [athlete?.sync_session_id, sessionId, athlete?.sync_status]);

  const formatDate = (timestamp?: number) => {
    if (!timestamp) return 'Never';
    return new Date(timestamp * 1000).toLocaleString();
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return '#22c55e';
      case 'in_progress':
        return '#0ea5e9';
      case 'error':
        return '#ef4444';
      default:
        return '#6b7280';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return '✅';
      case 'in_progress':
        return '⏳';
      case 'error':
        return '❌';
      default:
        return '⚪';
    }
  };

  if (loading) {
    return (
      <div className="sync-monitor container">
        <div className="loading">
          <div className="spinner"></div>
          <p>Loading sync status...</p>
        </div>
      </div>
    );
  }

  if (error || !athlete) {
    return (
      <div className="sync-monitor container">
        <div className="error-message">
          <h2>Error</h2>
          <p>{error || 'Athlete not found'}</p>
          <button onClick={() => navigate('/admin')} className="button">
            Back to Admin
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="sync-monitor container">
      <div className="monitor-header">
        <h1>Sync Monitor</h1>
        <button onClick={() => navigate('/admin')} className="button">
          Back to Admin
        </button>
      </div>

      <div className="athlete-info">
        <h2>
          {athlete.firstname} {athlete.lastname}
        </h2>
        <p className="athlete-id">Athlete ID: {athlete.id}</p>
      </div>

      <div className="status-card">
        <div className="status-header">
          <h3>Sync Status</h3>
          <div
            className="status-indicator"
            style={{ backgroundColor: getStatusColor(athlete.sync_status) }}
          >
            {getStatusIcon(athlete.sync_status)} {athlete.sync_status}
          </div>
        </div>

        <div className="status-details">
          <div className="detail-row">
            <span className="label">Last Synced:</span>
            <span className="value">{formatDate(athlete.last_synced_at)}</span>
          </div>
          <div className="detail-row">
            <span className="label">Total Activities:</span>
            <span className="value">{athlete.total_activities_count.toLocaleString()}</span>
          </div>
          <div className="detail-row">
            <span className="label">Last Update:</span>
            <span className="value">{lastUpdate.toLocaleTimeString()}</span>
          </div>
        </div>

        {athlete.sync_error && (
          <div className="error-box">
            <strong>Error:</strong> {athlete.sync_error}
          </div>
        )}

        {athlete.sync_status === 'in_progress' && (
          <div className="progress-info">
            <div className="pulse-dot"></div>
            <p>
              Sync in progress... This page updates automatically every 2 seconds.
            </p>
            <p className="hint">
              The sync is fetching activities in batches. This may take several minutes
              for athletes with many activities.
            </p>
          </div>
        )}

        {athlete.sync_status === 'completed' && (
          <div className="success-info">
            ✅ Sync completed successfully!
          </div>
        )}
      </div>

      {/* WOOD-8: Batch Progress Section */}
      {batchProgress && (
        <div className="status-card" style={{ marginTop: '2rem' }}>
          <div className="status-header">
            <h3>📦 Batch Progress</h3>
            <span style={{ fontSize: '0.9rem', color: '#64748b' }}>
              Session: {batchProgress.session_id.slice(-8)}
            </span>
          </div>

          {/* Progress Bar */}
          <div style={{ marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
              <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>
                {batchProgress.summary.completed_batches} / {batchProgress.summary.total_batches} batches completed
              </span>
              <span style={{ fontSize: '0.9rem', color: '#64748b' }}>
                {Math.round(batchProgress.summary.estimated_progress * 100)}%
              </span>
            </div>
            <div style={{
              width: '100%',
              height: '8px',
              backgroundColor: '#e5e7eb',
              borderRadius: '4px',
              overflow: 'hidden'
            }}>
              <div style={{
                width: `${batchProgress.summary.estimated_progress * 100}%`,
                height: '100%',
                backgroundColor: '#0ea5e9',
                transition: 'width 0.3s ease'
              }}></div>
            </div>
          </div>

          {/* Summary Stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
            <div style={{ padding: '0.75rem', backgroundColor: '#f8fafc', borderRadius: '6px' }}>
              <div style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '0.25rem' }}>Total Activities</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 600 }}>{batchProgress.summary.total_activities.toLocaleString()}</div>
            </div>
            <div style={{ padding: '0.75rem', backgroundColor: '#f8fafc', borderRadius: '6px' }}>
              <div style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '0.25rem' }}>Races Added</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 600, color: '#22c55e' }}>+{batchProgress.summary.total_races_added.toLocaleString()}</div>
            </div>
            {batchProgress.summary.total_races_removed > 0 && (
              <div style={{ padding: '0.75rem', backgroundColor: '#f8fafc', borderRadius: '6px' }}>
                <div style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '0.25rem' }}>Races Removed</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 600, color: '#ef4444' }}>-{batchProgress.summary.total_races_removed.toLocaleString()}</div>
              </div>
            )}
            {batchProgress.summary.current_batch && (
              <div style={{ padding: '0.75rem', backgroundColor: '#f8fafc', borderRadius: '6px' }}>
                <div style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '0.25rem' }}>Current Batch</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 600, color: '#0ea5e9' }}>#{batchProgress.summary.current_batch}</div>
              </div>
            )}
          </div>

          {/* Batch List */}
          <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
            {batchProgress.batches.map((batch) => (
              <div
                key={batch.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '0.75rem',
                  marginBottom: '0.5rem',
                  backgroundColor: batch.status === 'processing' ? '#eff6ff' : '#f8fafc',
                  borderLeft: `4px solid ${
                    batch.status === 'completed' ? '#22c55e' :
                    batch.status === 'processing' ? '#0ea5e9' :
                    batch.status === 'failed' ? '#ef4444' :
                    '#94a3b8'
                  }`,
                  borderRadius: '4px'
                }}
              >
                <div style={{ fontSize: '1.25rem', marginRight: '1rem' }}>
                  {batch.status === 'completed' ? '✅' :
                   batch.status === 'processing' ? '⏳' :
                   batch.status === 'failed' ? '❌' :
                   batch.status === 'cancelled' ? '🚫' : '⏸️'}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 500, marginBottom: '0.25rem' }}>
                    Batch #{batch.batch_number}
                    <span style={{ marginLeft: '0.5rem', fontSize: '0.85rem', color: '#64748b', textTransform: 'uppercase' }}>
                      {batch.status}
                    </span>
                  </div>
                  {batch.status === 'completed' && (
                    <div style={{ fontSize: '0.85rem', color: '#64748b' }}>
                      {batch.activities_fetched} activities, {batch.races_added} races added
                      {batch.races_removed > 0 && `, ${batch.races_removed} removed`}
                    </div>
                  )}
                  {batch.error_message && (
                    <div style={{ fontSize: '0.85rem', color: '#ef4444', marginTop: '0.25rem' }}>
                      Error: {batch.error_message}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sync Logs Section */}
      {sessionId && logs.length > 0 && (
        <div className="status-card" style={{ marginTop: '2rem' }}>
          <div className="status-header">
            <h3>Sync Logs</h3>
            <span style={{ fontSize: '0.9rem', color: '#64748b' }}>
              {logs.length} log entries
            </span>
          </div>
          <div className="logs-container">
            {logs.map((log, index) => (
              <div
                key={index}
                className={`log-entry log-${log.log_level}`}
              >
                <span className="log-time">
                  {new Date(log.created_at * 1000).toLocaleTimeString()}
                </span>
                <span className={`log-level level-${log.log_level}`}>
                  {log.log_level.toUpperCase()}
                </span>
                <span className="log-message">{log.message}</span>
                {log.metadata && (
                  <details className="log-metadata">
                    <summary>Details</summary>
                    <pre>{JSON.stringify(JSON.parse(log.metadata), null, 2)}</pre>
                  </details>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
