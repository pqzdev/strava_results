import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import RaceTable from '../components/RaceTable';
import RaceFilters from '../components/RaceFilters';
import AthleteSummary from '../components/AthleteSummary';
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
  athletes: string[];
  activityName: string;
  dateFrom: string;
  dateTo: string;
  minDistance: string;
  maxDistance: string;
}

// Helper function to get default start date (January 1st of previous year)
const getDefaultStartDate = () => {
  const now = new Date();
  const previousYear = now.getFullYear() - 1;
  return `${previousYear}-01-01`;
};

export default function Dashboard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [races, setRaces] = useState<Race[]>([]);
  const [loading, setLoading] = useState(true);

  // Initialize filters from URL params
  const [filters, setFilters] = useState<Filters>(() => {
    const athletesParam = searchParams.get('athletes');
    return {
      athletes: athletesParam ? athletesParam.split('|').filter(Boolean) : [],
      activityName: searchParams.get('activityName') || '',
      dateFrom: searchParams.get('dateFrom') || getDefaultStartDate(),
      dateTo: searchParams.get('dateTo') || '',
      minDistance: searchParams.get('minDistance') || '',
      maxDistance: searchParams.get('maxDistance') || '',
    };
  });

  const [currentAthleteId, setCurrentAthleteId] = useState<number | undefined>();
  const [pagination, setPagination] = useState({ total: 0, limit: 50, offset: 0 });
  const [earliestDate, setEarliestDate] = useState<string>();
  const [availableAthletes, setAvailableAthletes] = useState<string[]>([]);

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
    fetchAvailableAthletes();
  }, []);

  useEffect(() => {
    fetchRaces();
  }, [filters, pagination.offset]);

  const fetchEarliestDate = async () => {
    try {
      const response = await fetch('/api/races?limit=1000');
      const data = await response.json();
      if (data.races && data.races.length > 0) {
        const dates = data.races.map((r: Race) => r.date.split('T')[0]); // Extract just YYYY-MM-DD
        setEarliestDate(dates.sort()[0]);
      }
    } catch (error) {
      console.error('Failed to fetch earliest date:', error);
    }
  };

  const fetchAvailableAthletes = async () => {
    try {
      const response = await fetch('/api/races?limit=10000');
      const data = await response.json();
      if (data.races && data.races.length > 0) {
        const athletes = Array.from(
          new Set(data.races.map((r: Race) => `${r.firstname} ${r.lastname}`))
        ).sort() as string[];
        setAvailableAthletes(athletes);
      }
    } catch (error) {
      console.error('Failed to fetch available athletes:', error);
    }
  };

  const fetchRaces = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('limit', pagination.limit.toString());
      params.set('offset', pagination.offset.toString());

      // Handle multi-select athletes filter
      filters.athletes.forEach(athlete => params.append('athlete', athlete));

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
    const updatedFilters = { ...filters, ...newFilters };
    setFilters(updatedFilters);
    setPagination({ ...pagination, offset: 0 });

    // Update URL params (use pipe separator to avoid conflicts)
    const params = new URLSearchParams();
    if (updatedFilters.athletes.length > 0) {
      params.set('athletes', updatedFilters.athletes.join('|'));
    }
    if (updatedFilters.activityName) {
      params.set('activityName', updatedFilters.activityName);
    }
    if (updatedFilters.dateFrom) {
      params.set('dateFrom', updatedFilters.dateFrom);
    }
    if (updatedFilters.dateTo) {
      params.set('dateTo', updatedFilters.dateTo);
    }
    if (updatedFilters.minDistance) {
      params.set('minDistance', updatedFilters.minDistance);
    }
    if (updatedFilters.maxDistance) {
      params.set('maxDistance', updatedFilters.maxDistance);
    }
    setSearchParams(params, { replace: true });
  };

  const handleClearFilters = () => {
    setFilters({
      athletes: [],
      activityName: '',
      dateFrom: getDefaultStartDate(),
      dateTo: '',
      minDistance: '',
      maxDistance: '',
    });
    setPagination({ ...pagination, offset: 0 });
    setSearchParams({}, { replace: true });
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
          availableAthletes={availableAthletes}
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
            <AthleteSummary races={races} />

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
