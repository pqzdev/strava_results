import './AthleteSummary.css';

interface Race {
  id: number;
  strava_activity_id: number;
  name: string;
  distance: number;
  elapsed_time: number;
  moving_time: number;
  manual_time?: number;
  manual_distance?: number;
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

interface AthleteSummaryProps {
  races: Race[];
}

interface AthleteStat {
  athleteName: string;
  profilePhoto?: string;
  activityCount: number;
  totalDistance: number;
  totalTime: number;
  averagePace: number;
}

export default function AthleteSummary({ races }: AthleteSummaryProps) {
  // Group races by athlete and calculate statistics
  const athleteStats = races.reduce((acc, race) => {
    const athleteKey = `${race.firstname} ${race.lastname}`;

    if (!acc[athleteKey]) {
      acc[athleteKey] = {
        athleteName: athleteKey,
        profilePhoto: race.profile_photo,
        activityCount: 0,
        totalDistance: 0,
        totalTime: 0,
      };
    }

    // Use manual values if available, otherwise use Strava values
    const distance = race.manual_distance || race.distance;
    const time = race.manual_time || race.moving_time;

    acc[athleteKey].activityCount += 1;
    acc[athleteKey].totalDistance += distance;
    acc[athleteKey].totalTime += time;

    return acc;
  }, {} as Record<string, Omit<AthleteStat, 'averagePace'>>);

  // Calculate average pace and convert to final format
  const summaryData: AthleteStat[] = Object.values(athleteStats).map((stat) => ({
    ...stat,
    averagePace: stat.totalDistance > 0 ? (stat.totalTime / 60) / (stat.totalDistance / 1000) : 0,
  }));

  // Sort by total distance descending
  summaryData.sort((a, b) => b.totalDistance - a.totalDistance);

  const formatDistance = (meters: number) => {
    return (meters / 1000).toFixed(2);
  };

  const formatTime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m ${secs}s`;
  };

  const formatPace = (paceMinPerKm: number) => {
    if (!isFinite(paceMinPerKm) || paceMinPerKm <= 0) {
      return '-';
    }
    const minutes = Math.floor(paceMinPerKm);
    const seconds = Math.round((paceMinPerKm - minutes) * 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  if (summaryData.length === 0) {
    return null;
  }

  return (
    <div className="athlete-summary">
      <h2 className="summary-title">Athlete Summary</h2>
      <div className="summary-table-container">
        <table className="summary-table">
          <thead>
            <tr>
              <th>Athlete</th>
              <th>Activities</th>
              <th>Total Distance</th>
              <th>Total Time</th>
              <th>Avg Pace</th>
            </tr>
          </thead>
          <tbody>
            {summaryData.map((stat) => (
              <tr key={stat.athleteName}>
                <td>
                  <div className="athlete-cell">
                    {stat.profilePhoto && (
                      <img
                        src={stat.profilePhoto}
                        alt={stat.athleteName}
                        className="athlete-avatar-small"
                      />
                    )}
                    <span>{stat.athleteName}</span>
                  </div>
                </td>
                <td>{stat.activityCount}</td>
                <td>{formatDistance(stat.totalDistance)} km</td>
                <td>{formatTime(stat.totalTime)}</td>
                <td>{formatPace(stat.averagePace)} /km</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
