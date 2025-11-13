import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import './SubmitActivitiesReview.css';

interface ExtractedActivity {
  strava_activity_id: number;
  strava_url: string;
  athlete_name: string;
  activity_name: string;
  activity_type: string;
  date: string;
  distance: number | null;
  time_seconds: number | null;
  elevation_gain: number | null;
}

interface EditableActivity extends ExtractedActivity {
  edited_distance: number | null;
  edited_time_hours: number;
  edited_time_minutes: number;
  edited_time_seconds: number;
  edited_elevation_gain: number | null;
  event_name: string | null;
  notes: string | null;
}

export default function SubmitActivitiesReview() {
  const navigate = useNavigate();
  const [activities, setActivities] = useState<EditableActivity[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [eventNames, setEventNames] = useState<string[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(true);

  useEffect(() => {
    // Load extracted activities from session storage
    const stored = sessionStorage.getItem('extracted_activities');
    if (!stored) {
      navigate('/submit-activities');
      return;
    }

    try {
      const extracted: ExtractedActivity[] = JSON.parse(stored);
      const editable: EditableActivity[] = extracted.map(activity => ({
        ...activity,
        edited_distance: activity.distance,
        edited_time_hours: Math.floor((activity.time_seconds || 0) / 3600),
        edited_time_minutes: Math.floor(((activity.time_seconds || 0) % 3600) / 60),
        edited_time_seconds: (activity.time_seconds || 0) % 60,
        edited_elevation_gain: activity.elevation_gain,
        event_name: null,
        notes: null
      }));
      setActivities(editable);
    } catch (err) {
      console.error('Failed to parse activities:', err);
      navigate('/submit-activities');
    }

    // Fetch existing event names
    fetchEventNames();
  }, [navigate]);

  const fetchEventNames = async () => {
    try {
      const response = await fetch('/api/events/names');
      if (response.ok) {
        const data = await response.json();
        setEventNames(data.eventNames || []);
      }
    } catch (err) {
      console.error('Failed to fetch event names:', err);
    } finally {
      setLoadingEvents(false);
    }
  };

  const handleRemove = (index: number) => {
    const newActivities = activities.filter((_, idx) => idx !== index);
    setActivities(newActivities);
    if (newActivities.length === 0) {
      navigate('/submit-activities');
    }
  };

  const updateActivity = (index: number, updates: Partial<EditableActivity>) => {
    const newActivities = [...activities];
    newActivities[index] = { ...newActivities[index], ...updates };
    setActivities(newActivities);
  };

  const handleSubmitAll = async () => {
    setSubmitting(true);
    setError(null);

    try {
      const sessionId = `session-${Date.now()}`;

      const submissionData = activities.map(activity => ({
        strava_activity_id: activity.strava_activity_id,
        strava_url: activity.strava_url,
        athlete_name: activity.athlete_name,
        activity_name: activity.activity_name,
        activity_type: activity.activity_type,
        date: activity.date,
        original_distance: activity.distance,
        original_time_seconds: activity.time_seconds,
        original_elevation_gain: activity.elevation_gain,
        edited_distance: activity.edited_distance,
        edited_time_seconds: activity.edited_time_hours * 3600 + activity.edited_time_minutes * 60 + activity.edited_time_seconds,
        edited_elevation_gain: activity.edited_elevation_gain,
        event_name: activity.event_name,
        notes: activity.notes
      }));

      const response = await fetch('/api/manual-submissions/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          activities: submissionData
        })
      });

      if (!response.ok) {
        throw new Error('Failed to submit activities');
      }

      const result = await response.json();

      // Clear session storage
      sessionStorage.removeItem('extracted_activities');

      // Show success/error messages
      if (result.errors && result.errors.length > 0) {
        const errorDetails = result.errors.map((e: any) =>
          `Activity ${e.activity_id}: ${e.error}`
        ).join('\n');
        alert(`Submitted ${result.count} activities successfully.\n\nErrors:\n${errorDetails}`);
      } else if (result.count === 0) {
        alert('Failed to submit any activities. Please check the console for errors.');
        return; // Don't navigate away
      } else {
        alert(`Successfully submitted ${result.count} activities for review!`);
      }
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit activities');
    } finally {
      setSubmitting(false);
    }
  };

  if (activities.length === 0) {
    return <div>Loading...</div>;
  }

  return (
    <div className="review-page">
      <div className="review-header">
        <h1>Review Submitted Activities ({activities.length})</h1>
        <p className="subtitle">Review and edit all activities before submission</p>
      </div>

      <div className="table-container">
        <table className="activities-table">
          <thead>
            <tr>
              <th>Activity Name</th>
              <th>Athlete</th>
              <th>Date</th>
              <th>Type</th>
              <th>Distance (km)</th>
              <th>Time (H:M:S)</th>
              <th>Elevation (m)</th>
              <th>Event</th>
              <th>Notes</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {activities.map((activity, index) => (
              <tr key={activity.strava_activity_id}>
                <td className="activity-name">
                  <a href={activity.strava_url} target="_blank" rel="noopener noreferrer">
                    {activity.activity_name}
                  </a>
                </td>
                <td>{activity.athlete_name}</td>
                <td>{new Date(activity.date).toLocaleDateString()}</td>
                <td>{activity.activity_type}</td>
                <td>
                  <input
                    type="number"
                    step="0.01"
                    value={activity.edited_distance || ''}
                    onChange={(e) => updateActivity(index, { edited_distance: parseFloat(e.target.value) || null })}
                    className="table-input"
                    placeholder={activity.distance?.toFixed(2) || 'N/A'}
                  />
                </td>
                <td>
                  <div className="time-inputs-inline">
                    <input
                      type="number"
                      min="0"
                      value={activity.edited_time_hours}
                      onChange={(e) => updateActivity(index, { edited_time_hours: parseInt(e.target.value) || 0 })}
                      className="time-input-small"
                      placeholder="H"
                    />
                    <span>:</span>
                    <input
                      type="number"
                      min="0"
                      max="59"
                      value={activity.edited_time_minutes}
                      onChange={(e) => updateActivity(index, { edited_time_minutes: parseInt(e.target.value) || 0 })}
                      className="time-input-small"
                      placeholder="M"
                    />
                    <span>:</span>
                    <input
                      type="number"
                      min="0"
                      max="59"
                      value={activity.edited_time_seconds}
                      onChange={(e) => updateActivity(index, { edited_time_seconds: parseInt(e.target.value) || 0 })}
                      className="time-input-small"
                      placeholder="S"
                    />
                  </div>
                </td>
                <td>
                  <input
                    type="number"
                    step="1"
                    value={activity.edited_elevation_gain || ''}
                    onChange={(e) => updateActivity(index, { edited_elevation_gain: parseFloat(e.target.value) || null })}
                    className="table-input"
                    placeholder={activity.elevation_gain?.toFixed(0) || 'N/A'}
                  />
                </td>
                <td>
                  {loadingEvents ? (
                    <span style={{ color: '#999', fontSize: '0.85rem' }}>Loading...</span>
                  ) : (
                    <select
                      value={activity.event_name || ''}
                      onChange={(e) => updateActivity(index, { event_name: e.target.value || null })}
                      className="table-select"
                    >
                      <option value="">-- Select --</option>
                      {eventNames.map((name) => (
                        <option key={name} value={name}>{name}</option>
                      ))}
                    </select>
                  )}
                </td>
                <td>
                  <input
                    type="text"
                    value={activity.notes || ''}
                    onChange={(e) => updateActivity(index, { notes: e.target.value || null })}
                    placeholder="Optional notes..."
                    className="table-input"
                  />
                </td>
                <td>
                  <button
                    onClick={() => handleRemove(index)}
                    className="button-remove"
                    title="Remove this activity"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {error && (
        <div className="error-message">
          {error}
        </div>
      )}

      <div className="footer-actions">
        <button
          onClick={() => navigate('/submit-activities')}
          className="button button-secondary"
          disabled={submitting}
        >
          ← Back to Submission
        </button>
        <button
          onClick={handleSubmitAll}
          className="button button-submit"
          disabled={submitting || activities.length === 0}
        >
          {submitting ? 'Submitting...' : 'Save All & Submit'}
        </button>
      </div>
    </div>
  );
}
