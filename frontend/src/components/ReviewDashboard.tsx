import { useState, useEffect } from 'react';
import './ReviewDashboard.css';

interface ReviewActivity {
  id: number;
  strava_activity_id: number;
  name: string;
  distance: number;
  moving_time: number;
  elapsed_time: number;
  date: string;
  elevation_gain: number | null;
  is_hidden: number;
  athlete_id: number;
  firstname: string;
  lastname: string;
  athlete_strava_id: number;
  event_name: string | null;
}

interface EditableActivity extends ReviewActivity {
  edit_distance?: number;
  edit_moving_time?: number;
  edit_is_hidden?: number;
  edit_event_name?: string;
  suggested_event?: string;
  suggestion_confidence?: number;
  is_parkrun?: boolean;
  parkrun_confidence?: number;
}

const ML_API_URL = 'https://woodstock-results-production.up.railway.app';

function formatTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function parseTime(timeStr: string): number | null {
  const parts = timeStr.split(':').map(p => parseInt(p, 10));
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return null;
}

export function ReviewDashboard({ adminStravaId }: { adminStravaId: number }) {
  const [activities, setActivities] = useState<EditableActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<Set<number>>(new Set());
  const [loadingSuggestions, setLoadingSuggestions] = useState<Set<number>>(new Set());
  const [availableEvents, setAvailableEvents] = useState<string[]>([]);
  const [isDropdownOpen, setIsDropdownOpen] = useState<Record<number, boolean>>({});
  const [highlightedIndex, setHighlightedIndex] = useState<Record<number, number>>({});

  useEffect(() => {
    loadActivities();
    loadEventNames();
  }, [adminStravaId]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = () => {
      setIsDropdownOpen({});
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  async function loadEventNames() {
    try {
      const response = await fetch('/api/events/names');
      if (response.ok) {
        const data = await response.json();
        setAvailableEvents(data.eventNames || []);
      }
    } catch (err) {
      console.error('Failed to load event names:', err);
    }
  }

  async function loadActivities() {
    try {
      setLoading(true);
      const response = await fetch(
        `/api/admin/review?admin_strava_id=${adminStravaId}&limit=50`
      );

      if (!response.ok) {
        throw new Error('Failed to load activities');
      }

      const data = await response.json();
      setActivities(data.activities || []);

      // Load ML suggestions for each activity
      if (data.activities && data.activities.length > 0) {
        loadMLSuggestions(data.activities);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  async function loadMLSuggestions(acts: ReviewActivity[]) {
    // Load suggestions in batches to avoid overwhelming the ML API
    for (const activity of acts) {
      setLoadingSuggestions(prev => new Set(prev).add(activity.id));

      try {
        // Extract features for predictions
        const startDate = new Date(activity.date);
        const hour = startDate.getHours();
        const dayOfWeek = startDate.getDay();
        const month = startDate.getMonth() + 1;
        const distanceKm = activity.distance / 1000;
        const paceMinPerKm = activity.moving_time / 60 / distanceKm;
        const nameLower = activity.name.toLowerCase();

        // Check if it's a parkrun
        const parkrunFeatures = {
          contains_parkrun: nameLower.includes('parkrun') || nameLower.includes('park run') ? 1 : 0,
          is_5k: (distanceKm >= 4.5 && distanceKm <= 5.5) ? 1 : 0,
          hour_8: hour === 8 ? 1 : 0,
          hour,
          distance_km: distanceKm,
          name_length: activity.name.length,
          elevation_gain: activity.elevation_gain || 0,
          day_5: dayOfWeek === 6 ? 1 : 0,
          pace_min_per_km: paceMinPerKm,
          day_of_week: dayOfWeek,
        };

        const parkrunResponse = await fetch(`${ML_API_URL}/predict/parkrun`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(parkrunFeatures),
        });

        if (parkrunResponse.ok) {
          const parkrunPrediction = await parkrunResponse.json();

          setActivities(prev => prev.map(a =>
            a.id === activity.id
              ? {
                  ...a,
                  is_parkrun: parkrunPrediction.is_parkrun,
                  parkrun_confidence: parkrunPrediction.probability,
                  suggested_event: parkrunPrediction.is_parkrun && parkrunPrediction.probability > 0.7 ? 'parkrun' : a.suggested_event
                }
              : a
          ));

          // If not a confident parkrun, get event suggestion
          if (!parkrunPrediction.is_parkrun || parkrunPrediction.probability < 0.7) {
            // One-hot encode day of week (all 7 days)
            const dayFeatures = {
              day_0: dayOfWeek === 0 ? 1 : 0,
              day_1: dayOfWeek === 1 ? 1 : 0,
              day_2: dayOfWeek === 2 ? 1 : 0,
              day_3: dayOfWeek === 3 ? 1 : 0,
              day_4: dayOfWeek === 4 ? 1 : 0,
              day_5: dayOfWeek === 5 ? 1 : 0,
              day_6: dayOfWeek === 6 ? 1 : 0,
            };

            // One-hot encode hour (common race hours 6-10, others grouped as 'other')
            const hourFeatures = {
              hour_6: hour === 6 ? 1 : 0,
              hour_7: hour === 7 ? 1 : 0,
              hour_8: hour === 8 ? 1 : 0,
              hour_9: hour === 9 ? 1 : 0,
              hour_10: hour === 10 ? 1 : 0,
              hour_other: (hour < 6 || hour > 10) ? 1 : 0,
            };

            const eventFeatures = {
              distance_km: distanceKm,
              pace_min_per_km: paceMinPerKm,
              elevation_gain: activity.elevation_gain || 0,
              day_of_week: dayOfWeek,
              hour,
              month,
              contains_parkrun: parkrunFeatures.contains_parkrun,
              contains_marathon: nameLower.includes('marathon') ? 1 : 0,
              contains_half: nameLower.includes('half') ? 1 : 0,
              contains_ultra: nameLower.includes('ultra') ? 1 : 0,
              contains_fun_run: nameLower.includes('fun run') ? 1 : 0,
              name_length: activity.name.length,
              is_5k: parkrunFeatures.is_5k,
              is_10k: (distanceKm >= 9.5 && distanceKm <= 10.5) ? 1 : 0,
              is_half_marathon: (distanceKm >= 20 && distanceKm <= 22) ? 1 : 0,
              is_marathon: (distanceKm >= 40 && distanceKm <= 44) ? 1 : 0,
              is_ultra: distanceKm > 44 ? 1 : 0,
              ...dayFeatures,
              ...hourFeatures,
            };

            const eventResponse = await fetch(`${ML_API_URL}/predict/event`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(eventFeatures),
            });

            if (eventResponse.ok) {
              const eventPrediction = await eventResponse.json();

              // Filter out "Unknown Event", "rare_event", and low confidence predictions
              const isValidPrediction = eventPrediction.probability > 0.3 &&
                                       eventPrediction.event_name !== 'Unknown Event' &&
                                       eventPrediction.event_name !== 'rare_event' &&
                                       eventPrediction.event_name !== 'nan';

              setActivities(prev => prev.map(a =>
                a.id === activity.id
                  ? {
                      ...a,
                      suggested_event: isValidPrediction ? eventPrediction.event_name : '',
                      suggestion_confidence: eventPrediction.probability,
                    }
                  : a
              ));
            }
          }
        }
      } catch (err) {
        console.error(`Failed to load ML suggestions for activity ${activity.id}:`, err);
      } finally {
        setLoadingSuggestions(prev => {
          const next = new Set(prev);
          next.delete(activity.id);
          return next;
        });
      }
    }
  }

  async function handleSubmit(activity: EditableActivity) {
    try {
      setSubmitting(prev => new Set(prev).add(activity.id));

      const updates: any = {
        admin_strava_id: adminStravaId,
      };

      if (activity.edit_distance !== undefined) {
        updates.distance = activity.edit_distance;
      }
      if (activity.edit_moving_time !== undefined) {
        updates.moving_time = activity.edit_moving_time;
      }
      if (activity.edit_is_hidden !== undefined) {
        updates.is_hidden = activity.edit_is_hidden;
      }
      if (activity.edit_event_name !== undefined) {
        updates.event_name = activity.edit_event_name || null;
      }

      const response = await fetch(`/api/admin/activities/${activity.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });

      if (!response.ok) {
        throw new Error('Failed to update activity');
      }

      // Remove from list since it now has an event assigned
      setActivities(prev => prev.filter(a => a.id !== activity.id));
    } catch (err) {
      alert(`Failed to update activity: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setSubmitting(prev => {
        const next = new Set(prev);
        next.delete(activity.id);
        return next;
      });
    }
  }

  function updateActivity(id: number, updates: Partial<EditableActivity>) {
    setActivities(prev => prev.map(a => a.id === id ? { ...a, ...updates } : a));
  }

  function useSuggestion(activity: EditableActivity) {
    if (activity.suggested_event) {
      updateActivity(activity.id, { edit_event_name: activity.suggested_event });
    }
  }

  function handleKeyDown(e: React.KeyboardEvent, activityId: number) {
    const filteredEvents = availableEvents.filter(event =>
      event.toLowerCase().includes((activities.find(a => a.id === activityId)?.edit_event_name || '').toLowerCase())
    );
    const currentIndex = highlightedIndex[activityId] || 0;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setIsDropdownOpen(prev => ({ ...prev, [activityId]: true }));
        setHighlightedIndex(prev => ({
          ...prev,
          [activityId]: currentIndex < filteredEvents.length - 1 ? currentIndex + 1 : currentIndex
        }));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setIsDropdownOpen(prev => ({ ...prev, [activityId]: true }));
        setHighlightedIndex(prev => ({ ...prev, [activityId]: currentIndex > 0 ? currentIndex - 1 : 0 }));
        break;
      case 'Enter':
        e.preventDefault();
        if (isDropdownOpen[activityId] && filteredEvents[currentIndex]) {
          updateActivity(activityId, { edit_event_name: filteredEvents[currentIndex] });
          setIsDropdownOpen(prev => ({ ...prev, [activityId]: false }));
        }
        break;
      case 'Escape':
        e.preventDefault();
        setIsDropdownOpen(prev => ({ ...prev, [activityId]: false }));
        break;
    }
  }

  if (loading) {
    return <div className="review-dashboard"><p>Loading activities...</p></div>;
  }

  if (error) {
    return <div className="review-dashboard error"><p>Error: {error}</p></div>;
  }

  if (activities.length === 0) {
    return (
      <div className="review-dashboard">
        <h2>Activity Review Dashboard</h2>
        <p className="no-activities">🎉 All activities have been reviewed! No unassigned activities found.</p>
      </div>
    );
  }

  return (
    <div className="review-dashboard">
      <h2>Activity Review Dashboard</h2>
      <p className="dashboard-description">
        Review and assign events to activities. ML suggestions are provided where available.
      </p>
      <p className="activity-count">{activities.length} activities pending review</p>

      <div className="review-table-container">
        <table className="review-table">
          <thead>
            <tr>
              <th>Athlete</th>
              <th>Activity Name</th>
              <th>Date</th>
              <th>Distance (m)</th>
              <th>Time</th>
              <th>Visibility</th>
              <th>Suggested Event</th>
              <th>Event Name</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {activities.map(activity => (
              <tr key={activity.id}>
                <td>{activity.firstname} {activity.lastname}</td>
                <td>
                  <a
                    href={`https://www.strava.com/activities/${activity.strava_activity_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="activity-link"
                  >
                    {activity.name}
                  </a>
                </td>
                <td>{new Date(activity.date).toLocaleDateString()}</td>
                <td>
                  <input
                    type="number"
                    value={activity.edit_distance ?? activity.distance}
                    onChange={e => updateActivity(activity.id, { edit_distance: parseFloat(e.target.value) })}
                    className="small-input"
                  />
                </td>
                <td>
                  <input
                    type="text"
                    value={activity.edit_moving_time !== undefined
                      ? formatTime(activity.edit_moving_time)
                      : formatTime(activity.moving_time)
                    }
                    onChange={e => {
                      const seconds = parseTime(e.target.value);
                      if (seconds !== null) {
                        updateActivity(activity.id, { edit_moving_time: seconds });
                      }
                    }}
                    placeholder="HH:MM:SS"
                    className="small-input"
                  />
                </td>
                <td>
                  <select
                    value={activity.edit_is_hidden ?? activity.is_hidden}
                    onChange={e => updateActivity(activity.id, { edit_is_hidden: parseInt(e.target.value) })}
                    className="small-select"
                  >
                    <option value={0}>Visible</option>
                    <option value={1}>Hidden</option>
                  </select>
                </td>
                <td className="suggestion-cell">
                  {loadingSuggestions.has(activity.id) ? (
                    <span className="loading-suggestion">Loading...</span>
                  ) : activity.suggested_event ? (
                    <div className="suggestion">
                      <span className="suggestion-name">{activity.suggested_event}</span>
                      {activity.suggestion_confidence && (
                        <span className="confidence">
                          ({Math.round(activity.suggestion_confidence * 100)}%)
                        </span>
                      )}
                      <button
                        onClick={() => useSuggestion(activity)}
                        className="use-suggestion-btn"
                        title="Use this suggestion"
                      >
                        ✓
                      </button>
                    </div>
                  ) : (
                    <span className="no-suggestion">-</span>
                  )}
                </td>
                <td style={{ position: 'relative' }}>
                  <input
                    type="text"
                    value={activity.edit_event_name ?? ''}
                    onChange={e => {
                      updateActivity(activity.id, { edit_event_name: e.target.value });
                      setIsDropdownOpen(prev => ({ ...prev, [activity.id]: true }));
                      setHighlightedIndex(prev => ({ ...prev, [activity.id]: 0 }));
                    }}
                    onFocus={() => setIsDropdownOpen(prev => ({ ...prev, [activity.id]: true }))}
                    onKeyDown={e => handleKeyDown(e, activity.id)}
                    placeholder="Event name"
                    className="event-input"
                  />
                  {isDropdownOpen[activity.id] && (() => {
                    const filteredEvents = availableEvents.filter(event =>
                      event.toLowerCase().includes((activity.edit_event_name || '').toLowerCase())
                    );
                    return filteredEvents.length > 0 && (
                      <ul className="event-dropdown">
                        {filteredEvents.slice(0, 50).map((event, index) => (
                          <li
                            key={event}
                            onClick={() => {
                              updateActivity(activity.id, { edit_event_name: event });
                              setIsDropdownOpen(prev => ({ ...prev, [activity.id]: false }));
                            }}
                            onMouseEnter={() => setHighlightedIndex(prev => ({ ...prev, [activity.id]: index }))}
                            className={index === (highlightedIndex[activity.id] || 0) ? 'highlighted' : ''}
                          >
                            {event}
                          </li>
                        ))}
                      </ul>
                    );
                  })()}
                </td>
                <td>
                  <button
                    onClick={() => handleSubmit(activity)}
                    disabled={submitting.has(activity.id)}
                    className="submit-btn"
                  >
                    {submitting.has(activity.id) ? 'Saving...' : 'Submit'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
