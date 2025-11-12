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
  const [currentIndex, setCurrentIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
  }, [navigate]);

  const currentActivity = activities[currentIndex];

  const handleNext = () => {
    if (currentIndex < activities.length - 1) {
      setCurrentIndex(currentIndex + 1);
    }
  };

  const handlePrevious = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    }
  };

  const handleRemove = () => {
    const newActivities = activities.filter((_, idx) => idx !== currentIndex);
    setActivities(newActivities);
    if (newActivities.length === 0) {
      navigate('/submit-activities');
    } else if (currentIndex >= newActivities.length) {
      setCurrentIndex(newActivities.length - 1);
    }
  };

  const updateActivity = (updates: Partial<EditableActivity>) => {
    const newActivities = [...activities];
    newActivities[currentIndex] = { ...newActivities[currentIndex], ...updates };
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

      // Show success message and redirect
      alert(`Successfully submitted ${result.count} activities for review!`);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit activities');
    } finally {
      setSubmitting(false);
    }
  };

  if (!currentActivity) {
    return <div>Loading...</div>;
  }

  return (
    <div className="review-page">
      <div className="review-header">
        <h1>Review Submitted Activities ({activities.length})</h1>
        <p className="subtitle">
          Activity {currentIndex + 1} of {activities.length}
        </p>
      </div>

      <div className="review-card">
        <div className="activity-info">
          <h2>{currentActivity.activity_name}</h2>
          <div className="info-row">
            <span className="label">Athlete:</span>
            <span className="value">{currentActivity.athlete_name}</span>
          </div>
          <div className="info-row">
            <span className="label">Date:</span>
            <span className="value">{new Date(currentActivity.date).toLocaleDateString()}</span>
          </div>
          <div className="info-row">
            <span className="label">Type:</span>
            <span className="value">{currentActivity.activity_type}</span>
          </div>
        </div>

        <div className="editable-fields">
          <div className="field-group">
            <label>Distance (km)</label>
            <div className="field-compare">
              <span className="original">Original: {currentActivity.distance?.toFixed(2) || 'N/A'} km</span>
              <input
                type="number"
                step="0.01"
                value={currentActivity.edited_distance || ''}
                onChange={(e) => updateActivity({ edited_distance: parseFloat(e.target.value) || null })}
                className="edit-input"
              />
            </div>
          </div>

          <div className="field-group">
            <label>Time</label>
            <div className="field-compare">
              <span className="original">
                Original: {currentActivity.time_seconds ?
                  new Date(currentActivity.time_seconds * 1000).toISOString().substr(11, 8) :
                  'N/A'}
              </span>
              <div className="time-inputs">
                <input
                  type="number"
                  min="0"
                  value={currentActivity.edited_time_hours}
                  onChange={(e) => updateActivity({ edited_time_hours: parseInt(e.target.value) || 0 })}
                  className="time-input"
                  placeholder="H"
                />
                <span>:</span>
                <input
                  type="number"
                  min="0"
                  max="59"
                  value={currentActivity.edited_time_minutes}
                  onChange={(e) => updateActivity({ edited_time_minutes: parseInt(e.target.value) || 0 })}
                  className="time-input"
                  placeholder="M"
                />
                <span>:</span>
                <input
                  type="number"
                  min="0"
                  max="59"
                  value={currentActivity.edited_time_seconds}
                  onChange={(e) => updateActivity({ edited_time_seconds: parseInt(e.target.value) || 0 })}
                  className="time-input"
                  placeholder="S"
                />
              </div>
            </div>
          </div>

          <div className="field-group">
            <label>Elevation Gain (m)</label>
            <div className="field-compare">
              <span className="original">Original: {currentActivity.elevation_gain?.toFixed(0) || 'N/A'} m</span>
              <input
                type="number"
                step="1"
                value={currentActivity.edited_elevation_gain || ''}
                onChange={(e) => updateActivity({ edited_elevation_gain: parseFloat(e.target.value) || null })}
                className="edit-input"
              />
            </div>
          </div>

          <div className="field-group">
            <label>Event Name (optional)</label>
            <input
              type="text"
              value={currentActivity.event_name || ''}
              onChange={(e) => updateActivity({ event_name: e.target.value || null })}
              placeholder="e.g., City Marathon, parkrun"
              className="edit-input"
            />
          </div>

          <div className="field-group">
            <label>Notes (optional)</label>
            <textarea
              value={currentActivity.notes || ''}
              onChange={(e) => updateActivity({ notes: e.target.value || null })}
              placeholder="Additional notes about this activity..."
              className="notes-textarea"
              rows={3}
            />
          </div>
        </div>

        <div className="navigation-buttons">
          <button
            onClick={handlePrevious}
            disabled={currentIndex === 0}
            className="button button-nav"
          >
            ← Previous
          </button>
          <button
            onClick={handleRemove}
            className="button button-danger"
          >
            Remove
          </button>
          <button
            onClick={handleNext}
            disabled={currentIndex === activities.length - 1}
            className="button button-nav"
          >
            Next →
          </button>
        </div>
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
