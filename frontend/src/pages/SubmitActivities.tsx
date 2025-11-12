import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './SubmitActivities.css';

interface QueuedActivity {
  url: string;
  activityId: number;
}

export default function SubmitActivities() {
  const navigate = useNavigate();
  const [urlText, setUrlText] = useState('');
  const [queuedActivities, setQueuedActivities] = useState<QueuedActivity[]>([]);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Extract Strava activity URLs from text
  const extractUrls = (text: string): string[] => {
    const urlPattern = /https?:\/\/(?:www\.)?strava\.com\/activities\/\d+/g;
    const matches = text.match(urlPattern);
    return matches ? [...new Set(matches)] : [];
  };

  // Extract activity ID from URL
  const extractActivityId = (url: string): number | null => {
    const match = url.match(/\/activities\/(\d+)/);
    return match ? parseInt(match[1]) : null;
  };

  // Add URLs to queue
  const handleAddToQueue = () => {
    const urls = extractUrls(urlText);

    if (urls.length === 0) {
      setError('No valid Strava activity URLs found');
      return;
    }

    const newActivities: QueuedActivity[] = urls
      .map(url => {
        const activityId = extractActivityId(url);
        return activityId ? { url, activityId } : null;
      })
      .filter((activity): activity is QueuedActivity => activity !== null)
      .filter(activity => !queuedActivities.some(q => q.activityId === activity.activityId));

    setQueuedActivities([...queuedActivities, ...newActivities]);
    setUrlText('');
    setError(null);
  };

  // Remove activity from queue
  const handleRemoveFromQueue = (activityId: number) => {
    setQueuedActivities(queuedActivities.filter(a => a.activityId !== activityId));
  };

  // Clear all queued activities
  const handleClear = () => {
    setQueuedActivities([]);
    setUrlText('');
    setError(null);
  };

  // Process all queued activities
  const handleProcessAll = async () => {
    if (queuedActivities.length === 0) {
      setError('No activities queued');
      return;
    }

    setProcessing(true);
    setError(null);

    try {
      const response = await fetch('/api/manual-submissions/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          urls: queuedActivities.map(a => a.url)
        })
      });

      if (!response.ok) {
        throw new Error('Failed to extract activity data');
      }

      const data = await response.json();

      if (data.errors && data.errors.length > 0) {
        console.warn('Some activities failed to extract:', data.errors);
      }

      if (data.activities && data.activities.length > 0) {
        // Store extracted data and navigate to review page
        sessionStorage.setItem('extracted_activities', JSON.stringify(data.activities));
        navigate('/submit-activities/review');
      } else {
        setError('No activities could be extracted. Check URLs and try again.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process activities');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="submit-activities-page">
      <div className="submit-header">
        <h1>Submit Strava Activities</h1>
        <p className="subtitle">
          Manually submit race activities when OAuth authentication is unavailable
        </p>
      </div>

      <div className="submit-form-container">
        <div className="form-section">
          <label htmlFor="url-input">
            Paste Strava activity links below (one per line or separated by spaces):
          </label>
          <textarea
            id="url-input"
            value={urlText}
            onChange={(e) => setUrlText(e.target.value)}
            placeholder={`https://www.strava.com/activities/16440077551\nhttps://www.strava.com/activities/16440077552\nhttps://www.strava.com/activities/16440077553`}
            rows={8}
            className="url-textarea"
          />

          <div className="form-actions">
            <button
              onClick={handleClear}
              className="button button-secondary"
              disabled={processing}
            >
              Clear
            </button>
            <button
              onClick={handleAddToQueue}
              className="button button-primary"
              disabled={processing || !urlText.trim()}
            >
              Add to Queue
            </button>
          </div>

          {error && (
            <div className="error-message">
              {error}
            </div>
          )}
        </div>

        {queuedActivities.length > 0 && (
          <div className="queued-section">
            <h3>Queued Activities ({queuedActivities.length})</h3>
            <div className="queued-list">
              {queuedActivities.map((activity) => (
                <div key={activity.activityId} className="queued-item">
                  <span className="activity-id">
                    ✓ Activity {activity.activityId}
                  </span>
                  <button
                    onClick={() => handleRemoveFromQueue(activity.activityId)}
                    className="remove-button"
                    disabled={processing}
                    title="Remove from queue"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>

            <button
              onClick={handleProcessAll}
              className="button button-process"
              disabled={processing}
            >
              {processing ? 'Processing...' : 'Process All →'}
            </button>
          </div>
        )}
      </div>

      <div className="help-section">
        <h3>How it works</h3>
        <ol>
          <li>Paste Strava activity links in the text box above</li>
          <li>Click "Add to Queue" (you can repeat this multiple times)</li>
          <li>Click "Process All" to extract activity data</li>
          <li>Review and edit the activities before final submission</li>
        </ol>
        <p className="help-note">
          <strong>Note:</strong> Only public Strava activities can be extracted.
          Private activities will fail to process.
        </p>
      </div>
    </div>
  );
}
