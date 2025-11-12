import { useState } from 'react';
import './RaceTable.css';

interface Race {
  id: number;
  strava_activity_id: number;
  name: string;
  distance: number;
  elapsed_time: number;
  moving_time: number;
  manual_time?: number;
  manual_distance?: number;
  event_name?: string;
  date: string;
  elevation_gain: number;
  average_heartrate?: number;
  max_heartrate?: number;
  athlete_id: number;
  firstname: string;
  lastname: string;
  profile_photo?: string;
  strava_id: number;
}

interface RaceTableProps {
  races: Race[];
  currentAthleteId?: number; // Strava ID of the current logged-in user
  isAdmin?: boolean; // Whether the current user is an admin
  onTimeUpdate?: () => void; // Callback to refresh races after update
  availableEvents?: string[]; // List of all existing event names
  onEventUpdate?: () => void; // Callback to refresh races and events after event update
}

/**
 * Format distance to friendly names (5k, 10k, HM, Marathon) or meters
 */
function formatDistance(meters: number): string {
  const km = meters / 1000;

  // Check for common race distances with some tolerance (±2%)
  const tolerance = 0.02;

  if (Math.abs(km - 5) / 5 < tolerance) return '5k';
  if (Math.abs(km - 10) / 10 < tolerance) return '10k';
  if (Math.abs(km - 21.1) / 21.1 < tolerance) return 'HM';
  if (Math.abs(km - 42.2) / 42.2 < tolerance) return 'Marathon';

  // Otherwise show kilometers with 1 decimal
  return `${km.toFixed(1)}km`;
}

/**
 * Format time in seconds to HH:MM:SS or MM:SS
 */
function formatTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

/**
 * Format date to readable string
 */
function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

interface EditableTimeProps {
  race: Race;
  isOwner: boolean;
  onSave: (raceId: number, newTime: number | null) => Promise<void>;
}

function EditableTime({ race, isOwner, onSave }: EditableTimeProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const displayTime = race.manual_time ?? race.elapsed_time;
  const hasManualTime = race.manual_time !== null && race.manual_time !== undefined;

  // Debug logging
  console.log(`Race ${race.id}: isOwner=${isOwner}, strava_id=${race.strava_id}`);

  const handleEdit = () => {
    setEditValue(formatTime(displayTime));
    setIsEditing(true);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEditValue('');
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      // Parse the time string (HH:MM:SS or MM:SS)
      const parts = editValue.split(':').map(p => parseInt(p, 10));
      let seconds: number;

      if (parts.length === 3) {
        seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
      } else if (parts.length === 2) {
        seconds = parts[0] * 60 + parts[1];
      } else {
        alert('Invalid time format. Use MM:SS or HH:MM:SS');
        return;
      }

      await onSave(race.id, seconds);
      setIsEditing(false);
      setEditValue('');
    } catch (error) {
      alert('Failed to update time');
    } finally {
      setIsSaving(false);
    }
  };

  const handleClear = async () => {
    if (confirm('Remove manual time and use Strava time?')) {
      setIsSaving(true);
      try {
        await onSave(race.id, null);
        setIsEditing(false);
      } catch (error) {
        alert('Failed to clear manual time');
      } finally {
        setIsSaving(false);
      }
    }
  };

  if (isEditing) {
    return (
      <div className="time-edit">
        <input
          type="text"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          placeholder="HH:MM:SS"
          className="time-input"
          autoFocus
        />
        <button onClick={handleSave} disabled={isSaving} className="btn-save">
          {isSaving ? '...' : '✓'}
        </button>
        <button onClick={handleCancel} disabled={isSaving} className="btn-cancel">
          ✕
        </button>
        {hasManualTime && (
          <button onClick={handleClear} disabled={isSaving} className="btn-clear" title="Clear manual time">
            ↺
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="time-display">
      <span>{formatTime(displayTime)}</span>
      {hasManualTime && <span className="manual-indicator" title="Edited for accuracy">✏️</span>}
      {isOwner && (
        <button onClick={handleEdit} className="btn-edit" title="Edit time">
          Edit
        </button>
      )}
    </div>
  );
}

interface EditableDistanceProps {
  race: Race;
  isOwner: boolean;
  onSave: (raceId: number, newDistance: number | null) => Promise<void>;
}

function EditableDistance({ race, isOwner, onSave }: EditableDistanceProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const displayDistance = race.manual_distance ?? race.distance;
  const hasManualDistance = race.manual_distance !== null && race.manual_distance !== undefined;

  const handleEdit = () => {
    // Show current distance in km with 2 decimals
    setEditValue((displayDistance / 1000).toFixed(2));
    setIsEditing(true);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEditValue('');
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const km = parseFloat(editValue);
      if (isNaN(km) || km <= 0) {
        alert('Invalid distance. Please enter a positive number in kilometers.');
        return;
      }

      const meters = Math.round(km * 1000);
      await onSave(race.id, meters);
      setIsEditing(false);
      setEditValue('');
    } catch (error) {
      alert('Failed to update distance');
    } finally {
      setIsSaving(false);
    }
  };

  const handleClear = async () => {
    if (confirm('Remove manual distance and use Strava distance?')) {
      setIsSaving(true);
      try {
        await onSave(race.id, null);
        setIsEditing(false);
      } catch (error) {
        alert('Failed to clear manual distance');
      } finally {
        setIsSaving(false);
      }
    }
  };

  if (isEditing) {
    return (
      <div className="time-edit">
        <input
          type="text"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          placeholder="5.00"
          className="time-input"
          autoFocus
        />
        <span style={{ fontSize: '12px', color: '#666' }}>km</span>
        <button onClick={handleSave} disabled={isSaving} className="btn-save">
          {isSaving ? '...' : '✓'}
        </button>
        <button onClick={handleCancel} disabled={isSaving} className="btn-cancel">
          ✕
        </button>
        {hasManualDistance && (
          <button onClick={handleClear} disabled={isSaving} className="btn-clear" title="Clear manual distance">
            ↺
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="time-display">
      <span>{formatDistance(displayDistance)}</span>
      {hasManualDistance && <span className="manual-indicator" title="Edited for accuracy">✏️</span>}
      {isOwner && (
        <button onClick={handleEdit} className="btn-edit" title="Edit distance">
          Edit
        </button>
      )}
    </div>
  );
}

interface EditableEventProps {
  race: Race;
  isAdmin: boolean;
  availableEvents: string[];
  onSave: (raceId: number, newEventName: string | null) => Promise<void>;
  currentAthleteId?: number;
  allRaces: Race[];
}

function EditableEvent({ race, isAdmin, availableEvents, onSave, currentAthleteId, allRaces }: EditableEventProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  // Helper to generate Strava calendar link for the race's year/month
  // Uses Text Fragments to highlight the event name on the page
  const getCalendarLink = (): string => {
    const date = new Date(race.date);
    const year = date.getFullYear();
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[date.getMonth()];

    // Add Text Fragment to highlight the event name
    // Format: #MonthAbbr:~:text=EventName
    const eventNameEncoded = encodeURIComponent(race.event_name || '');
    return `https://www.strava.com/athlete/calendar/${year}#${month}:~:text=${eventNameEncoded}`;
  };

  // Check if current user already has a race with same event name on same date
  const userAlreadyHasThisEvent = (): boolean => {
    if (!currentAthleteId || !race.event_name) return false;

    return allRaces.some(r =>
      r.strava_id === currentAthleteId &&
      r.event_name === race.event_name &&
      r.date === race.date
    );
  };

  // Show "Find mine" link only if:
  // 1. Race has an event name
  // 2. Race is NOT from the current user viewing it
  // 3. Current user doesn't already have a race with same event name on same date
  const showFindMineLink = race.event_name &&
                           currentAthleteId &&
                           race.strava_id !== currentAthleteId &&
                           !userAlreadyHasThisEvent();

  // Filter available events based on input value
  const filteredEvents = availableEvents.filter(event =>
    event.toLowerCase().includes(editValue.toLowerCase())
  );

  const handleEdit = () => {
    setEditValue(race.event_name || '');
    setIsEditing(true);
    setIsDropdownOpen(true);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEditValue('');
    setIsDropdownOpen(false);
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const trimmedValue = editValue.trim();
      await onSave(race.id, trimmedValue || null);
      setIsEditing(false);
      setEditValue('');
      setIsDropdownOpen(false);
    } catch (error) {
      alert('Failed to update event');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSelectEvent = (eventName: string) => {
    setEditValue(eventName);
    setIsDropdownOpen(false);
  };

  const handleClear = async () => {
    if (confirm('Remove event name?')) {
      setIsSaving(true);
      try {
        await onSave(race.id, null);
        setIsEditing(false);
      } catch (error) {
        alert('Failed to clear event');
      } finally {
        setIsSaving(false);
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (!isDropdownOpen) setIsDropdownOpen(true);
        setHighlightedIndex(prev =>
          prev < filteredEvents.length - 1 ? prev + 1 : prev
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (!isDropdownOpen) setIsDropdownOpen(true);
        setHighlightedIndex(prev => (prev > 0 ? prev - 1 : 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (isDropdownOpen && filteredEvents[highlightedIndex]) {
          handleSelectEvent(filteredEvents[highlightedIndex]);
        } else {
          handleSave();
        }
        break;
      case 'Escape':
        e.preventDefault();
        if (isDropdownOpen) {
          setIsDropdownOpen(false);
        } else {
          handleCancel();
        }
        break;
    }
  };

  if (isEditing) {
    return (
      <div className="event-edit" style={{ position: 'relative' }}>
        <input
          type="text"
          value={editValue}
          onChange={(e) => {
            setEditValue(e.target.value);
            setIsDropdownOpen(true);
            setHighlightedIndex(0);
          }}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsDropdownOpen(true)}
          placeholder="Event name..."
          className="time-input"
          style={{ minWidth: '200px' }}
          autoFocus
        />
        <button onClick={handleSave} disabled={isSaving} className="btn-save">
          {isSaving ? '...' : '✓'}
        </button>
        <button onClick={handleCancel} disabled={isSaving} className="btn-cancel">
          ✕
        </button>
        {race.event_name && (
          <button onClick={handleClear} disabled={isSaving} className="btn-clear" title="Clear event name">
            ↺
          </button>
        )}

        {isDropdownOpen && filteredEvents.length > 0 && (
          <ul
            className="event-dropdown"
            style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              zIndex: 1000,
              background: 'white',
              border: '1px solid #ccc',
              borderRadius: '4px',
              maxHeight: '200px',
              overflowY: 'auto',
              listStyle: 'none',
              margin: '4px 0',
              padding: 0,
              minWidth: '200px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
            }}
          >
            {filteredEvents.slice(0, 50).map((event, index) => (
              <li
                key={event}
                onClick={() => handleSelectEvent(event)}
                onMouseEnter={() => setHighlightedIndex(index)}
                style={{
                  padding: '8px 12px',
                  cursor: 'pointer',
                  backgroundColor: index === highlightedIndex ? '#f0f0f0' : 'white',
                }}
              >
                {event}
              </li>
            ))}
            {filteredEvents.length > 50 && (
              <li style={{ padding: '8px 12px', color: '#666', fontSize: '12px' }}>
                + {filteredEvents.length - 50} more (keep typing to narrow down)
              </li>
            )}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="event-display">
      {race.event_name ? (
        <>
          <span className="event-badge">{race.event_name}</span>
          {showFindMineLink && (
            <a
              href={getCalendarLink()}
              target="_blank"
              rel="noopener noreferrer"
              className="find-mine-link"
              title="Find mine"
              style={{
                marginLeft: '6px',
                fontSize: '14px',
                textDecoration: 'none',
                cursor: 'pointer',
              }}
            >
              🔍
            </a>
          )}
        </>
      ) : (
        <span className="no-event">—</span>
      )}
      {isAdmin && (
        <button onClick={handleEdit} className="btn-edit" title="Edit event">
          Edit
        </button>
      )}
    </div>
  );
}

export default function RaceTable({ races, currentAthleteId, isAdmin = false, onTimeUpdate, availableEvents = [], onEventUpdate }: RaceTableProps) {
  const [sortField, setSortField] = useState<keyof Race | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  const handleSort = (field: keyof Race) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const sortedRaces = [...races].sort((a, b) => {
    if (!sortField) return 0;

    let aValue: any = a[sortField];
    let bValue: any = b[sortField];

    // Use manual values if they exist
    if (sortField === 'elapsed_time') {
      aValue = a.manual_time ?? a.elapsed_time;
      bValue = b.manual_time ?? b.elapsed_time;
    }
    if (sortField === 'distance') {
      aValue = a.manual_distance ?? a.distance;
      bValue = b.manual_distance ?? b.distance;
    }

    // Handle null/undefined
    if (aValue === null || aValue === undefined) return 1;
    if (bValue === null || bValue === undefined) return -1;

    // Compare
    if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
    if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
    return 0;
  });

  const getSortIndicator = (field: keyof Race) => {
    if (sortField !== field) return ' ↕';
    return sortDirection === 'asc' ? ' ↑' : ' ↓';
  };

  const handleTimeUpdate = async (raceId: number, newTime: number | null) => {
    try {
      const response = await fetch(`/api/races/${raceId}/time`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          manual_time: newTime,
          athlete_strava_id: currentAthleteId,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to update time');
      }

      // Refresh the races list
      if (onTimeUpdate) {
        onTimeUpdate();
      }
    } catch (error) {
      console.error('Error updating time:', error);
      throw error;
    }
  };

  const handleDistanceUpdate = async (raceId: number, newDistance: number | null) => {
    try {
      const response = await fetch(`/api/races/${raceId}/distance`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          manual_distance: newDistance,
          athlete_strava_id: currentAthleteId,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to update distance');
      }

      // Refresh the races list
      if (onTimeUpdate) {
        onTimeUpdate();
      }
    } catch (error) {
      console.error('Error updating distance:', error);
      throw error;
    }
  };

  const handleEventUpdate = async (raceId: number, newEventName: string | null) => {
    try {
      const response = await fetch(`/api/races/${raceId}/event`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          event_name: newEventName,
          admin_strava_id: currentAthleteId,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to update event');
      }

      // Refresh the races list and available events
      if (onEventUpdate) {
        onEventUpdate();
      }
    } catch (error) {
      console.error('Error updating event:', error);
      throw error;
    }
  };

  return (
    <div className="race-table-container">
      <table className="race-table">
        <thead>
          <tr>
            <th onClick={() => handleSort('firstname')} style={{ cursor: 'pointer' }}>
              Name{getSortIndicator('firstname')}
            </th>
            <th onClick={() => handleSort('date')} style={{ cursor: 'pointer' }}>
              Date{getSortIndicator('date')}
            </th>
            <th onClick={() => handleSort('event_name')} style={{ cursor: 'pointer' }}>
              Event{getSortIndicator('event_name')}
            </th>
            <th onClick={() => handleSort('name')} style={{ cursor: 'pointer' }}>
              Activity Name{getSortIndicator('name')}
            </th>
            <th onClick={() => handleSort('distance')} style={{ cursor: 'pointer' }}>
              Distance{getSortIndicator('distance')}
            </th>
            <th onClick={() => handleSort('elapsed_time')} style={{ cursor: 'pointer' }}>
              Time{getSortIndicator('elapsed_time')}
            </th>
          </tr>
        </thead>
        <tbody>
          {sortedRaces.map((race) => (
            <tr key={race.id}>
              <td className="athlete-name">
                {race.profile_photo && (
                  <img src={race.profile_photo} alt="" className="athlete-photo" />
                )}
                <span>{race.firstname} {race.lastname}</span>
              </td>
              <td>{formatDate(race.date)}</td>
              <td className="event-name">
                <EditableEvent
                  race={race}
                  isAdmin={isAdmin}
                  availableEvents={availableEvents}
                  onSave={handleEventUpdate}
                  currentAthleteId={currentAthleteId}
                  allRaces={races}
                />
              </td>
              <td>
                <a
                  href={`https://www.strava.com/activities/${race.strava_activity_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="activity-link"
                >
                  {race.name}
                </a>
              </td>
              <td>
                <EditableDistance
                  race={race}
                  isOwner={isAdmin || race.strava_id === currentAthleteId}
                  onSave={handleDistanceUpdate}
                />
              </td>
              <td>
                <EditableTime
                  race={race}
                  isOwner={isAdmin || race.strava_id === currentAthleteId}
                  onSave={handleTimeUpdate}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
