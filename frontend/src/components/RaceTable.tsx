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
  onTimeUpdate?: () => void; // Callback to refresh races after update
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
      {hasManualTime && <span className="manual-indicator" title="Manually edited time">✏️</span>}
      {isOwner && (
        <button onClick={handleEdit} className="btn-edit" title="Edit time">
          Edit
        </button>
      )}
    </div>
  );
}

export default function RaceTable({ races, currentAthleteId, onTimeUpdate }: RaceTableProps) {
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

  return (
    <div className="race-table-container">
      <table className="race-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Date</th>
            <th>Activity Name</th>
            <th>Distance</th>
            <th>Time</th>
          </tr>
        </thead>
        <tbody>
          {races.map((race) => (
            <tr key={race.id}>
              <td className="athlete-name">
                {race.profile_photo && (
                  <img src={race.profile_photo} alt="" className="athlete-photo" />
                )}
                <span>{race.firstname} {race.lastname}</span>
              </td>
              <td>{formatDate(race.date)}</td>
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
              <td>{formatDistance(race.distance)}</td>
              <td>
                <EditableTime
                  race={race}
                  isOwner={race.strava_id === currentAthleteId}
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
