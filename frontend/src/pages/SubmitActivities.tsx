import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import './SubmitActivities.css';

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

export default function SubmitActivities() {
  const navigate = useNavigate();
  const [urlText, setUrlText] = useState('');
  const [processing, setProcessing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activities, setActivities] = useState<EditableActivity[]>([]);
  const [eventNames, setEventNames] = useState<string[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(true);

  useEffect(() => {
    // Fetch existing event names
    fetchEventNames();
  }, []);

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

  // Extract and process activities immediately
  const handleSubmit = async () => {
    if (!urlText.trim()) {
      setError('Please paste Strava activity links');
      return;
    }

    setProcessing(true);
    setError(null);

    try {
      // Extract URLs or plain activity IDs from text
      const lines = urlText.split(/[\n\s,]+/).filter(line => line.trim());

      const response = await fetch('/api/manual-submissions/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: lines })
      });

      if (!response.ok) {
        throw new Error('Failed to extract activity data');
      }

      const data = await response.json();

      if (data.errors && data.errors.length > 0) {
        console.warn('Some activities failed to extract:', data.errors);

        // Show detailed error messages to the user
        const errorDetails = data.errors.map((e: any) =>
          `${e.url}: ${e.error}`
        ).join('\n');

        if (data.activities && data.activities.length > 0) {
          // Some succeeded, some failed
          setError(`⚠️ ${data.errors.length} activity(ies) failed:\n${errorDetails}`);
        } else {
          // All failed
          setError(`Failed to extract activities:\n${errorDetails}`);
          return;
        }
      }

      if (data.activities && data.activities.length > 0) {
        // Convert to editable format
        const editable: EditableActivity[] = data.activities.map((activity: ExtractedActivity) => ({
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
        setUrlText('');
      } else if (!data.errors || data.errors.length === 0) {
        setError('No activities could be extracted. Check URLs and try again.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process activities');
    } finally {
      setProcessing(false);
    }
  };

  const handleRemove = (index: number) => {
    const newActivities = activities.filter((_, idx) => idx !== index);
    setActivities(newActivities);
  };

  const updateActivity = (index: number, updates: Partial<EditableActivity>) => {
    const newActivities = [...activities];
    newActivities[index] = { ...newActivities[index], ...updates };
    setActivities(newActivities);
  };

  const handleSubmitAll = async () => {
    if (activities.length === 0) {
      setError('No activities to submit');
      return;
    }

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

      // Clear form and activities
      setActivities([]);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit activities');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="submit-activities-page">
      <div className="submit-header">
        <h1>Submit Strava Activities</h1>
        <p className="subtitle">
          Paste links and submit - no queue needed!
        </p>
      </div>

      <div className="submit-form-container">
        <div className="form-section">
          <label htmlFor="url-input">
            Paste Strava activity links below (one per line, separated by spaces, or comma-separated):
          </label>
          <textarea
            id="url-input"
            value={urlText}
            onChange={(e) => setUrlText(e.target.value)}
            placeholder={`https://www.strava.com/activities/16440077551
https://www.strava.com/activities/16440077552
16440077553`}
            rows={6}
            className="url-textarea"
          />

          <div className="form-actions">
            <button
              onClick={() => {
                setUrlText('');
                setActivities([]);
                setError(null);
              }}
              className="button button-secondary"
              disabled={processing || submitting}
            >
              Clear
            </button>
            <button
              onClick={handleSubmit}
              className="button button-primary"
              disabled={processing || submitting || !urlText.trim()}
            >
              {processing ? 'Extracting...' : 'Extract Activities'}
            </button>
          </div>

          {error && (
            <div className="error-message" style={{ whiteSpace: 'pre-wrap', textAlign: 'left' }}>
              {error}
            </div>
          )}
        </div>

        {activities.length > 0 && (
          <div className="activities-review-section">
            <h3>Review Activities ({activities.length})</h3>
            <div className="activities-list">
              {activities.map((activity, index) => (
                <div key={activity.strava_activity_id} className="activity-card">
                  <div className="activity-card-header">
                    <a href={activity.strava_url} target="_blank" rel="noopener noreferrer" className="activity-title">
                      {activity.activity_name}
                    </a>
                    <button
                      onClick={() => handleRemove(index)}
                      className="button-remove"
                      title="Remove this activity"
                    >
                      ✕
                    </button>
                  </div>

                  <div className="activity-card-meta">
                    <span className="athlete-name">{activity.athlete_name}</span>
                    <span className="activity-date">{new Date(activity.date).toLocaleDateString()}</span>
                  </div>

                  <div className="activity-card-fields">
                    <div className="field-group">
                      <label>Distance (km)</label>
                      <input
                        type="number"
                        step="0.01"
                        value={activity.edited_distance || ''}
                        onChange={(e) => updateActivity(index, { edited_distance: parseFloat(e.target.value) || null })}
                        className="field-input"
                        placeholder={activity.distance?.toFixed(2) || 'N/A'}
                      />
                    </div>

                    <div className="field-group field-group-time">
                      <label>Time (H:M:S)</label>
                      <div className="time-inputs">
                        <input
                          type="number"
                          min="0"
                          value={activity.edited_time_hours}
                          onChange={(e) => updateActivity(index, { edited_time_hours: parseInt(e.target.value) || 0 })}
                          className="time-input"
                          placeholder="H"
                        />
                        <span className="time-separator">:</span>
                        <input
                          type="number"
                          min="0"
                          max="59"
                          value={activity.edited_time_minutes}
                          onChange={(e) => updateActivity(index, { edited_time_minutes: parseInt(e.target.value) || 0 })}
                          className="time-input"
                          placeholder="M"
                        />
                        <span className="time-separator">:</span>
                        <input
                          type="number"
                          min="0"
                          max="59"
                          value={activity.edited_time_seconds}
                          onChange={(e) => updateActivity(index, { edited_time_seconds: parseInt(e.target.value) || 0 })}
                          className="time-input"
                          placeholder="S"
                        />
                      </div>
                    </div>

                    <div className="field-group">
                      <label>Elevation (m)</label>
                      <input
                        type="number"
                        step="1"
                        value={activity.edited_elevation_gain || ''}
                        onChange={(e) => updateActivity(index, { edited_elevation_gain: parseFloat(e.target.value) || null })}
                        className="field-input"
                        placeholder={activity.elevation_gain?.toFixed(0) || 'N/A'}
                      />
                    </div>

                    <div className="field-group field-group-wide">
                      <label>Event</label>
                      {loadingEvents ? (
                        <span className="loading-text">Loading events...</span>
                      ) : (
                        <select
                          value={activity.event_name || ''}
                          onChange={(e) => updateActivity(index, { event_name: e.target.value || null })}
                          className="field-select"
                        >
                          <option value="">-- Select Event --</option>
                          {eventNames.map((name) => (
                            <option key={name} value={name}>{name}</option>
                          ))}
                        </select>
                      )}
                    </div>

                    <div className="field-group field-group-wide">
                      <label>Notes (optional)</label>
                      <input
                        type="text"
                        value={activity.notes || ''}
                        onChange={(e) => updateActivity(index, { notes: e.target.value || null })}
                        placeholder="Add optional notes..."
                        className="field-input"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="submit-button-container">
              <button
                onClick={handleSubmitAll}
                className="button button-submit"
                disabled={submitting || activities.length === 0}
              >
                {submitting ? 'Submitting...' : 'Submit All for Review'}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="help-section">
        <h3>How it works</h3>
        <ol>
          <li>Paste Strava activity links (full URLs or just activity IDs)</li>
          <li>Click "Extract Activities" to fetch data from Strava</li>
          <li>Review and edit distance, time, event, and notes as needed</li>
          <li>Click "Submit All for Review" to send for admin approval</li>
        </ol>
        <p className="help-note">
          <strong>Note:</strong> Only public Strava activities can be extracted.
          Private activities will fail to process.
        </p>
      </div>
    </div>
  );
}
