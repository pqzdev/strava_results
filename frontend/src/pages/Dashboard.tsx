import { useState, useEffect } from 'react';
import RaceTable from '../components/RaceTable';
import RaceFilters from '../components/RaceFilters';
import './Dashboard.css';

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

interface Filters {
  athlete: string;
  activityName: string;
  dateFrom: string;
  dateTo: string;
  minDistance: string;
  maxDistance: string;
}

export default function Dashboard() {
  const [races, setRaces] = useState<Race[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Filters>({
    athlete: '',
    activityName: '',
    dateFrom: '',
    dateTo: '',
    minDistance: '',
    maxDistance: '',
  });
  const [currentAthleteId, setCurrentAthleteId] = useState<number | undefined>();
  const [pagination, setPagination] = useState({ total: 0, limit: 50, offset: 0 });
  const [earliestDate, setEarliestDate] = useState<string>();

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const athleteIdFromUrl = urlParams.get('athlete_id');

    if (athleteIdFromUrl) {
      localStorage.setItem('strava_athlete_id', athleteIdFromUrl);
      setCurrentAthleteId(parseInt(athleteIdFromUrl, 10));
      window.history.replaceState({}, '', '/dashboard');
    } else {
      const stravaId = localStorage.getItem('strava_athlete_id');
      if (stravaId) {
        setCurrentAthleteId(parseInt(stravaId, 10));
      }
    }
  }, []);

  useEffect(() => {
    fetchEarliestDate();
  }, []);

  useEffect(() => {
    fetchRaces();
  }, [filters, pagination.offset]);

  const fetchEarliestDate = async () => {
    try {
      const response = await fetch('/api/races?limit=1000');
      const data = await response.json();
      if (data.races && data.races.length > 0) {
        const dates = data.races.map((r: Race) => r.date);
        setEarliestDate(dates.sort()[0]);
      }
    } catch (error) {
      console.error('Failed to fetch earliest date:', error);
    }
  };

  const fetchRaces = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('limit', pagination.limit.toString());
      params.set('offset', pagination.offset.toString());

      if (filters.athlete) params.set('athlete', filters.athlete);
      if (filters.activityName) params.set('activity_name', filters.activityName);
      if (filters.dateFrom) params.set('date_from', filters.dateFrom);
      if (filters.dateTo) params.set('date_to', filters.dateTo);
      if (filters.minDistance) params.set('min_distance', filters.minDistance);
      if (filters.maxDistance) params.set('max_distance', filters.maxDistance);

      const response = await fetch(`/api/races?${params.toString()}`);
      const data = await response.json();
      setRaces(data.races || []);
      setPagination({
        ...pagination,
        total: data.pagination?.total || 0,
      });
    } catch (error) {
      console.error('Failed to fetch races:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleFilterChange = (newFilters: Partial<Filters>) => {
    setFilters({ ...filters, ...newFilters });
    setPagination({ ...pagination, offset: 0 });
  };

  const handleClearFilters = () => {
    setFilters({
      athlete: '',
      activityName: '',
      dateFrom: '',
      dateTo: '',
      minDistance: '',
      maxDistance: '',
    });
    setPagination({ ...pagination, offset: 0 });
  };

  const handlePageChange = (newOffset: number) => {
    setPagination({ ...pagination, offset: newOffset });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const totalPages = Math.ceil(pagination.total / pagination.limit);
  const currentPage = Math.floor(pagination.offset / pagination.limit) + 1;

  return (
    <div className="dashboard">
      <div className="container">
        <div className="dashboard-header">
          <h1>Race Results</h1>
          <p className="subtitle">View and filter race activities from all club members</p>
        </div>

        <RaceFilters
          filters={filters}
          onFilterChange={handleFilterChange}
          onClearFilters={handleClearFilters}
          earliestDate={earliestDate}
        />

        {loading ? (
          <div className="loading">
            <div className="spinner"></div>
            <p>Loading races...</p>
          </div>
        ) : races.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">🏃</div>
            <h3>No races found</h3>
            <p>
              {Object.values(filters).some((f) => f)
                ? 'Try adjusting your filters'
                : currentAthleteId
                ? 'Your races are being synced and will appear within a few hours. Initial sync may take 1-2 days during busy periods.'
                : 'Connect your Strava account to start syncing race results'}
            </p>
          </div>
        ) : (
          <>
            <div className="results-count">
              Showing {pagination.offset + 1}-{Math.min(pagination.offset + pagination.limit, pagination.total)} of {pagination.total} race{pagination.total !== 1 ? 's' : ''}
            </div>
            <RaceTable
              races={races}
              currentAthleteId={currentAthleteId}
              onTimeUpdate={fetchRaces}
            />

            {totalPages > 1 && (
              <div className="pagination">
                <button
                  className="pagination-button"
                  onClick={() => handlePageChange(pagination.offset - pagination.limit)}
                  disabled={currentPage === 1}
                >
                  Previous
                </button>
                <span className="pagination-info">
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  className="pagination-button"
                  onClick={() => handlePageChange(pagination.offset + pagination.limit)}
                  disabled={currentPage === totalPages}
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
