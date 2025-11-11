import { useState, useEffect } from 'react';
import './Admin.css';

interface AdminAthlete {
  id: number;
  strava_id: number;
  firstname: string;
  lastname: string;
  profile_photo?: string;
  is_admin: number;
  is_hidden: number;
  is_blocked: number;
  sync_status: string;
  sync_error?: string;
  total_activities_count: number;
  last_synced_at?: number;
  created_at: number;
  race_count: number;
}

interface ParkrunAthlete {
  athlete_name: string;
  id?: number;
  is_hidden: number;
  run_count: number;
}

export default function Admin() {
  const [athletes, setAthletes] = useState<AdminAthlete[]>([]);
  const [parkrunAthletes, setParkrunAthletes] = useState<ParkrunAthlete[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState<Set<number>>(new Set());
  const [parkrunStartDate, setParkrunStartDate] = useState('2024-01-01');
  const [parkrunEndDate, setParkrunEndDate] = useState(
    new Date().toISOString().split('T')[0]
  );
  const [replaceExistingData, setReplaceExistingData] = useState(false);
  const [showParkrunInstructions, setShowParkrunInstructions] = useState(false);

  // Get admin strava ID from localStorage
  const currentAthleteId = parseInt(
    localStorage.getItem('strava_athlete_id') || '0'
  );

  useEffect(() => {
    fetchAthletes();
    fetchParkrunAthletes();
  }, []);

  const fetchAthletes = async () => {
    try {
      setLoading(true);
      const response = await fetch(
        `/api/admin/athletes?admin_strava_id=${currentAthleteId}`
      );

      if (!response.ok) {
        if (response.status === 403) {
          throw new Error('You do not have admin access');
        }
        throw new Error('Failed to fetch athletes');
      }

      const data = await response.json();
      setAthletes(data.athletes);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch athletes');
    } finally {
      setLoading(false);
    }
  };

  const fetchParkrunAthletes = async () => {
    try {
      const response = await fetch('/api/parkrun/athletes');

      if (!response.ok) {
        throw new Error('Failed to fetch parkrun athletes');
      }

      const data = await response.json();
      setParkrunAthletes(data.athletes || []);
    } catch (err) {
      console.error('Error fetching parkrun athletes:', err);
    }
  };

  const updateAthleteField = async (
    athleteId: number,
    field: 'is_admin' | 'is_hidden' | 'is_blocked',
    value: number
  ) => {
    // Check if user is trying to remove their own admin access
    const athlete = athletes.find((a) => a.id === athleteId);
    if (
      field === 'is_admin' &&
      value === 0 &&
      athlete?.strava_id === currentAthleteId
    ) {
      const confirmed = confirm(
        'If you remove your admin access, you will require another administrator to reinstate it. Are you sure you want to be removed as an admin?'
      );
      if (!confirmed) {
        return; // Cancel the operation
      }
    }

    try {
      const response = await fetch(
        `/api/admin/athletes/${athleteId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            admin_strava_id: currentAthleteId,
            [field]: value,
          }),
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to update athlete`);
      }

      // Update local state
      setAthletes((prev) =>
        prev.map((a) => (a.id === athleteId ? { ...a, [field]: value } : a))
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update athlete');
    }
  };

  const deleteAthlete = async (athleteId: number, athleteName: string) => {
    if (
      !confirm(
        `Are you sure you want to delete ${athleteName}? This will remove all their data and races.`
      )
    ) {
      return;
    }

    try {
      const response = await fetch(
        `/api/admin/athletes/${athleteId}?admin_strava_id=${currentAthleteId}`,
        {
          method: 'DELETE',
        }
      );

      if (!response.ok) {
        throw new Error('Failed to delete athlete');
      }

      // Remove from local state
      setAthletes((prev) => prev.filter((a) => a.id !== athleteId));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete athlete');
    }
  };

  const triggerSync = async (athleteId: number) => {
    setSyncing((prev) => new Set(prev).add(athleteId));

    try {
      const response = await fetch(
        `/api/admin/athletes/${athleteId}/sync`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ admin_strava_id: currentAthleteId }),
        }
      );

      if (!response.ok) {
        throw new Error('Failed to trigger sync');
      }

      // Refresh athlete data after a short delay
      setTimeout(() => {
        fetchAthletes();
        setSyncing((prev) => {
          const newSet = new Set(prev);
          newSet.delete(athleteId);
          return newSet;
        });
      }, 2000);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to trigger sync');
      setSyncing((prev) => {
        const newSet = new Set(prev);
        newSet.delete(athleteId);
        return newSet;
      });
    }
  };

  const formatDate = (timestamp?: number) => {
    if (!timestamp) return 'Never';
    return new Date(timestamp * 1000).toLocaleString();
  };

  const updateParkrunAthleteVisibility = async (
    athleteName: string,
    isHidden: boolean
  ) => {
    try {
      const response = await fetch(
        `/api/parkrun/athletes/${encodeURIComponent(athleteName)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ is_hidden: isHidden }),
        }
      );

      if (!response.ok) {
        throw new Error('Failed to update parkrun athlete');
      }

      // Update local state
      setParkrunAthletes((prev) =>
        prev.map((a) =>
          a.athlete_name === athleteName ? { ...a, is_hidden: isHidden ? 1 : 0 } : a
        )
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update parkrun athlete');
    }
  };

  const triggerParkrunSync = async () => {
    // Build the parkrun URL with parameters
    const apiEndpoint = `${window.location.origin}/api/parkrun/import${replaceExistingData ? '?replace=true' : ''}`;
    const parkrunUrl = new URL('https://www.parkrun.com/results/consolidatedclub/');
    parkrunUrl.searchParams.set('clubNum', '19959');
    parkrunUrl.searchParams.set('startDate', parkrunStartDate);
    parkrunUrl.searchParams.set('endDate', parkrunEndDate);
    parkrunUrl.searchParams.set('apiEndpoint', apiEndpoint);
    parkrunUrl.searchParams.set('autoUpload', 'true');

    // Fetch the scraper script
    try {
      const response = await fetch(`${window.location.origin}/parkrun-smart-scraper.js`);
      const scriptText = await response.text();

      // Copy script to clipboard
      await navigator.clipboard.writeText(scriptText);

      // Open parkrun page in new tab
      const parkrunTab = window.open(parkrunUrl.toString(), '_blank');

      if (!parkrunTab) {
        alert('Please allow popups to use the automatic parkrun sync feature.');
        return;
      }

      // Show instructions section
      setShowParkrunInstructions(true);
    } catch (err) {
      alert(`Failed to load scraper script. Please try again or use the manual method at ${window.location.origin}/parkrun-bookmarklet.html`);
    }
  };

  const getSyncStatusBadge = (status: string) => {
    const statusClasses: Record<string, string> = {
      completed: 'status-completed',
      in_progress: 'status-in-progress',
      error: 'status-error',
      pending: 'status-pending',
    };

    return (
      <span className={`status-badge ${statusClasses[status] || ''}`}>
        {status}
      </span>
    );
  };

  if (loading) {
    return (
      <div className="admin container">
        <div className="loading">
          <div className="spinner"></div>
          <p>Loading admin panel...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="admin container">
        <div className="error-message">
          <h2>Error</h2>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="admin container">
      <div className="admin-header">
        <h1>Admin Dashboard</h1>
        <p className="subtitle">Manage athletes and sync status</p>
      </div>

      <div className="admin-stats">
        <div className="stat-card">
          <div className="stat-value">{athletes.length}</div>
          <div className="stat-label">Total Athletes</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">
            {athletes.filter((a) => a.is_admin === 1).length}
          </div>
          <div className="stat-label">Admins</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">
            {athletes.filter((a) => a.is_hidden === 1).length}
          </div>
          <div className="stat-label">Hidden</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">
            {athletes.filter((a) => a.is_blocked === 1).length}
          </div>
          <div className="stat-label">Blocked</div>
        </div>
      </div>

      <div className="admin-table-container">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Athlete</th>
              <th>Strava ID</th>
              <th>Sync Status</th>
              <th>Last Sync</th>
              <th>Activities</th>
              <th>Races</th>
              <th>Admin</th>
              <th>Hidden</th>
              <th>Blocked</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {athletes.map((athlete) => (
              <tr key={athlete.id}>
                <td>
                  <div className="athlete-cell">
                    {athlete.profile_photo && (
                      <img
                        src={athlete.profile_photo}
                        alt={`${athlete.firstname} ${athlete.lastname}`}
                        className="athlete-photo"
                      />
                    )}
                    <span>
                      {athlete.firstname} {athlete.lastname}
                    </span>
                  </div>
                </td>
                <td>
                  <a
                    href={`https://www.strava.com/athletes/${athlete.strava_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="strava-link"
                  >
                    {athlete.strava_id}
                  </a>
                </td>
                <td>
                  <div className="sync-status-cell">
                    {getSyncStatusBadge(athlete.sync_status)}
                    {athlete.sync_error && (
                      <div className="sync-error" title={athlete.sync_error}>
                        ⚠️
                      </div>
                    )}
                  </div>
                </td>
                <td className="date-cell">
                  {formatDate(athlete.last_synced_at)}
                </td>
                <td className="number-cell">{athlete.total_activities_count}</td>
                <td className="number-cell">{athlete.race_count}</td>
                <td>
                  <input
                    type="checkbox"
                    checked={athlete.is_admin === 1}
                    onChange={(e) =>
                      updateAthleteField(
                        athlete.id,
                        'is_admin',
                        e.target.checked ? 1 : 0
                      )
                    }
                    className="checkbox"
                  />
                </td>
                <td>
                  <input
                    type="checkbox"
                    checked={athlete.is_hidden === 1}
                    onChange={(e) =>
                      updateAthleteField(
                        athlete.id,
                        'is_hidden',
                        e.target.checked ? 1 : 0
                      )
                    }
                    className="checkbox"
                  />
                </td>
                <td>
                  <input
                    type="checkbox"
                    checked={athlete.is_blocked === 1}
                    onChange={(e) =>
                      updateAthleteField(
                        athlete.id,
                        'is_blocked',
                        e.target.checked ? 1 : 0
                      )
                    }
                    className="checkbox"
                  />
                </td>
                <td>
                  <div className="action-buttons">
                    <button
                      onClick={() => triggerSync(athlete.id)}
                      disabled={syncing.has(athlete.id)}
                      className="button button-sync"
                      title="Trigger manual sync"
                    >
                      {syncing.has(athlete.id) ? '⏳' : '🔄'}
                    </button>
                    <button
                      onClick={() =>
                        deleteAthlete(
                          athlete.id,
                          `${athlete.firstname} ${athlete.lastname}`
                        )
                      }
                      className="button button-delete"
                      title="Delete athlete and all data"
                    >
                      🗑️
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="admin-header" style={{ marginTop: '3rem' }}>
        <h2>Parkrun Data Sync</h2>
        <p className="subtitle">Automatically scrape and import parkrun results</p>
      </div>

      <div className="parkrun-sync-section" style={{ marginBottom: '2rem' }}>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: '1', minWidth: '200px' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>
              Start Date
            </label>
            <input
              type="date"
              value={parkrunStartDate}
              onChange={(e) => setParkrunStartDate(e.target.value)}
              style={{
                width: '100%',
                padding: '0.5rem',
                border: '1px solid #ddd',
                borderRadius: '4px',
              }}
            />
          </div>
          <div style={{ flex: '1', minWidth: '200px' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>
              End Date
            </label>
            <input
              type="date"
              value={parkrunEndDate}
              onChange={(e) => setParkrunEndDate(e.target.value)}
              style={{
                width: '100%',
                padding: '0.5rem',
                border: '1px solid #ddd',
                borderRadius: '4px',
              }}
            />
          </div>
          <button
            onClick={triggerParkrunSync}
            className="button"
            style={{
              padding: '0.5rem 1.5rem',
              backgroundColor: '#fc4c02',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontWeight: 500,
            }}
          >
            🏃 Sync Parkrun Data
          </button>
        </div>
        <div style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <input
            type="checkbox"
            id="replaceExistingData"
            checked={replaceExistingData}
            onChange={(e) => setReplaceExistingData(e.target.checked)}
            style={{ cursor: 'pointer' }}
          />
          <label htmlFor="replaceExistingData" style={{ cursor: 'pointer', fontSize: '0.9rem' }}>
            Replace all existing parkrun data (⚠️ This will delete all current parkrun results)
          </label>
        </div>
        <p style={{ marginTop: '0.5rem', fontSize: '0.9rem', color: '#666' }}>
          {replaceExistingData
            ? '⚠️ All existing parkrun data will be deleted and replaced with new results from the date range.'
            : '✓ New results will be merged with existing data (duplicates skipped automatically).'}
        </p>

        {showParkrunInstructions && (
          <div style={{
            marginTop: '1rem',
            padding: '1rem',
            backgroundColor: '#f0f9ff',
            border: '1px solid #0ea5e9',
            borderRadius: '8px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
              <div>
                <h3 style={{ margin: 0, marginBottom: '0.5rem', color: '#0284c7' }}>
                  ✅ Script Copied to Clipboard!
                </h3>
                <p style={{ margin: '0.5rem 0', fontSize: '0.9rem' }}>
                  <strong>Next Steps:</strong>
                </p>
                <ol style={{ margin: '0.5rem 0', paddingLeft: '1.5rem', fontSize: '0.9rem' }}>
                  <li>Go to the parkrun tab that just opened</li>
                  <li>Press <kbd style={{ padding: '2px 6px', backgroundColor: '#fff', border: '1px solid #ccc', borderRadius: '3px' }}>F12</kbd> to open the browser console</li>
                  <li>Paste the script (<kbd style={{ padding: '2px 6px', backgroundColor: '#fff', border: '1px solid #ccc', borderRadius: '3px' }}>Ctrl+V</kbd> or <kbd style={{ padding: '2px 6px', backgroundColor: '#fff', border: '1px solid #ccc', borderRadius: '3px' }}>Cmd+V</kbd>)</li>
                  <li>Press <kbd style={{ padding: '2px 6px', backgroundColor: '#fff', border: '1px solid #ccc', borderRadius: '3px' }}>Enter</kbd></li>
                </ol>
                <p style={{ margin: '0.5rem 0', fontSize: '0.85rem', color: '#0369a1' }}>
                  The scraper will automatically fetch all Saturdays from {parkrunStartDate} to {parkrunEndDate},
                  include special dates (Dec 25, Jan 1), and upload results to your database (~3-4 minutes for 100+ dates).
                </p>
              </div>
              <button
                onClick={() => setShowParkrunInstructions(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '1.5rem',
                  cursor: 'pointer',
                  color: '#666',
                  padding: '0 0.5rem',
                }}
                title="Close instructions"
              >
                ×
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="admin-header">
        <h2>Parkrun Athletes</h2>
        <p className="subtitle">Manage visibility of parkrun athletes</p>
      </div>

      <div className="admin-stats">
        <div className="stat-card">
          <div className="stat-value">{parkrunAthletes.length}</div>
          <div className="stat-label">Total Parkrun Athletes</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">
            {parkrunAthletes.filter((a) => a.is_hidden === 1).length}
          </div>
          <div className="stat-label">Hidden</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">
            {parkrunAthletes.filter((a) => !a.is_hidden || a.is_hidden === 0).length}
          </div>
          <div className="stat-label">Visible</div>
        </div>
      </div>

      <div className="admin-table-container">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Athlete Name</th>
              <th>Total Runs</th>
              <th>Hidden</th>
            </tr>
          </thead>
          <tbody>
            {parkrunAthletes.map((athlete) => (
              <tr key={athlete.athlete_name}>
                <td>
                  <div className="athlete-cell">
                    <span>{athlete.athlete_name}</span>
                  </div>
                </td>
                <td className="number-cell">{athlete.run_count}</td>
                <td>
                  <input
                    type="checkbox"
                    checked={athlete.is_hidden === 1}
                    onChange={(e) =>
                      updateParkrunAthleteVisibility(
                        athlete.athlete_name,
                        e.target.checked
                      )
                    }
                    className="checkbox"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
