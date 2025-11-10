import './RaceCard.css';

interface Race {
  id: number;
  strava_activity_id: number;
  name: string;
  distance: number;
  elapsed_time: number;
  moving_time: number;
  date: string;
  elevation_gain: number;
  average_heartrate?: number;
  max_heartrate?: number;
  firstname: string;
  lastname: string;
  profile_photo?: string;
  strava_id: number;
}

interface RaceCardProps {
  race: Race;
}

export default function RaceCard({ race }: RaceCardProps) {
  const formatDistance = (meters: number) => {
    const km = meters / 1000;
    return `${km.toFixed(2)} km`;
  };

  const formatPace = (timeSeconds: number, distanceMeters: number) => {
    const kmTime = timeSeconds / (distanceMeters / 1000);
    const minutes = Math.floor(kmTime / 60);
    const seconds = Math.floor(kmTime % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')} /km`;
  };

  const formatTime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const stravaUrl = `https://www.strava.com/activities/${race.strava_activity_id}`;

  return (
    <div className="race-card">
      <div className="race-card-header">
        <div className="athlete-info">
          {race.profile_photo ? (
            <img
              src={race.profile_photo}
              alt={`${race.firstname} ${race.lastname}`}
              className="athlete-avatar"
            />
          ) : (
            <div className="athlete-avatar-placeholder">
              {race.firstname[0]}
              {race.lastname[0]}
            </div>
          )}
          <div className="athlete-name">
            {race.firstname} {race.lastname}
          </div>
        </div>
        <div className="race-date">{formatDate(race.date)}</div>
      </div>

      <div className="race-card-body">
        <h3 className="race-name">{race.name}</h3>

        <div className="race-metrics">
          <div className="metric">
            <div className="metric-label">Distance</div>
            <div className="metric-value">{formatDistance(race.distance)}</div>
          </div>
          <div className="metric">
            <div className="metric-label">Time</div>
            <div className="metric-value">{formatTime(race.elapsed_time)}</div>
          </div>
          <div className="metric">
            <div className="metric-label">Pace</div>
            <div className="metric-value">
              {formatPace(race.elapsed_time, race.distance)}
            </div>
          </div>
          {race.elevation_gain > 0 && (
            <div className="metric">
              <div className="metric-label">Elevation</div>
              <div className="metric-value">{Math.round(race.elevation_gain)}m</div>
            </div>
          )}
        </div>

        {(race.average_heartrate || race.max_heartrate) && (
          <div className="race-heartrate">
            {race.average_heartrate && (
              <span>Avg HR: {Math.round(race.average_heartrate)} bpm</span>
            )}
            {race.max_heartrate && (
              <span>Max HR: {Math.round(race.max_heartrate)} bpm</span>
            )}
          </div>
        )}
      </div>

      <div className="race-card-footer">
        <a
          href={stravaUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="strava-link"
        >
          View on Strava →
        </a>
      </div>
    </div>
  );
}
