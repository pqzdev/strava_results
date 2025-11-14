import { useState, useEffect } from 'react';
import './Admin.css';

interface EventStats {
  event_name: string;
  dates: string[];
  distances: number[];
  activity_count: number;
}

export default function EventsAdmin() {
  const [events, setEvents] = useState<EventStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingEvent, setEditingEvent] = useState<string | null>(null);
  const [newEventName, setNewEventName] = useState('');
  const [currentAthleteId, setCurrentAthleteId] = useState<number | undefined>();

  useEffect(() => {
    // Get current athlete ID from localStorage
    const stravaId = localStorage.getItem('strava_athlete_id');
    if (stravaId) {
      setCurrentAthleteId(parseInt(stravaId, 10));
    }
  }, []);

  useEffect(() => {
    if (currentAthleteId) {
      fetchEvents();
    }
  }, [currentAthleteId]);

  const fetchEvents = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/events/stats');
      const data = await response.json();
      setEvents(data.events || []);
    } catch (error) {
      console.error('Failed to fetch events:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleBulkHide = async (eventName: string, activityCount: number) => {
    const confirmed = window.confirm(
      `Are you sure you want to hide all ${activityCount} activities for "${eventName}"?\n\nThis action will hide all activities with this event name. You can unhide them individually later if needed.`
    );

    if (!confirmed) return;

    try {
      const response = await fetch('/api/races/bulk-edit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          admin_strava_id: currentAthleteId,
          filters: {
            eventNames: [eventName],
          },
          updates: {
            is_hidden: true,
          },
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to hide activities');
      }

      const result = await response.json();
      alert(result.message);
      fetchEvents(); // Refresh the list
    } catch (error) {
      console.error('Error hiding activities:', error);
      alert(error instanceof Error ? error.message : 'Failed to hide activities');
    }
  };

  const handleEditEventName = (eventName: string) => {
    setEditingEvent(eventName);
    setNewEventName(eventName);
  };

  const handleSaveEventName = async (oldEventName: string) => {
    if (newEventName.trim() === oldEventName) {
      setEditingEvent(null);
      return;
    }

    try {
      const response = await fetch('/api/events/rename', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          admin_strava_id: currentAthleteId,
          old_name: oldEventName,
          new_name: newEventName.trim(),
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to rename event');
      }

      const result = await response.json();
      alert(result.message);
      setEditingEvent(null);
      fetchEvents(); // Refresh the list
    } catch (error) {
      console.error('Error renaming event:', error);
      alert(error instanceof Error ? error.message : 'Failed to rename event');
    }
  };

  const handleCancelEdit = () => {
    setEditingEvent(null);
    setNewEventName('');
  };

  const formatDistance = (meters: number): string => {
    const km = meters / 1000;
    const tolerance = 0.02;

    if (Math.abs(km - 5) / 5 < tolerance) return '5k';
    if (Math.abs(km - 10) / 10 < tolerance) return '10k';
    if (Math.abs(km - 21.1) / 21.1 < tolerance) return 'HM';
    if (Math.abs(km - 42.2) / 42.2 < tolerance) return 'Marathon';

    return `${km.toFixed(1)}km`;
  };

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  return (
    <div className="admin-page">
      <div className="container">
        <div className="admin-header">
          <h1>Events Administration</h1>
          <p className="subtitle">Manage event names and bulk operations</p>
        </div>

        {loading ? (
          <div className="loading">
            <div className="spinner"></div>
            <p>Loading events...</p>
          </div>
        ) : events.length === 0 ? (
          <div className="empty-state">
            <p>No events found</p>
          </div>
        ) : (
          <div className="events-table-container">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Event Name</th>
                  <th>Activities</th>
                  <th>Dates</th>
                  <th>Distances</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.event_name}>
                    <td>
                      {editingEvent === event.event_name ? (
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                          <input
                            type="text"
                            value={newEventName}
                            onChange={(e) => setNewEventName(e.target.value)}
                            style={{
                              padding: '0.5rem',
                              border: '1px solid #ccc',
                              borderRadius: '4px',
                              fontSize: '14px',
                              flex: 1,
                            }}
                            autoFocus
                          />
                          <button
                            onClick={() => handleSaveEventName(event.event_name)}
                            style={{
                              padding: '0.5rem 1rem',
                              backgroundColor: '#fc4c02',
                              color: 'white',
                              border: 'none',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              fontSize: '14px',
                            }}
                          >
                            Save
                          </button>
                          <button
                            onClick={handleCancelEdit}
                            style={{
                              padding: '0.5rem 1rem',
                              backgroundColor: '#6c757d',
                              color: 'white',
                              border: 'none',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              fontSize: '14px',
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <strong>{event.event_name}</strong>
                      )}
                    </td>
                    <td>{event.activity_count}</td>
                    <td>
                      <div style={{ maxHeight: '100px', overflowY: 'auto' }}>
                        {event.dates.map((date, idx) => (
                          <div key={idx}>{formatDate(date)}</div>
                        ))}
                      </div>
                    </td>
                    <td>
                      <div style={{ maxHeight: '100px', overflowY: 'auto' }}>
                        {event.distances.map((distance, idx) => (
                          <div key={idx}>{formatDistance(distance)}</div>
                        ))}
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                        {editingEvent !== event.event_name && (
                          <>
                            <button
                              onClick={() => handleEditEventName(event.event_name)}
                              style={{
                                padding: '0.5rem 1rem',
                                backgroundColor: '#007bff',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontSize: '14px',
                              }}
                            >
                              Rename
                            </button>
                            <button
                              onClick={() => handleBulkHide(event.event_name, event.activity_count)}
                              style={{
                                padding: '0.5rem 1rem',
                                backgroundColor: '#dc3545',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontSize: '14px',
                              }}
                            >
                              Hide All
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
