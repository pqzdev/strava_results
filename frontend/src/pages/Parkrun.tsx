import { useState, useEffect } from 'react';
import './Parkrun.css';

interface ParkrunResult {
  id: number;
  athlete_name: string;
  parkrun_athlete_id?: string;
  event_name: string;
  event_number: number;
  position: number;
  time_seconds: number;
  time_string: string;
  age_grade?: string;
  age_category?: string;
  date: string;
  club_name?: string;
}

interface Filters {
  athlete: string;
  event: string;
  dateFrom: string;
  dateTo: string;
}

interface ParkrunStats {
  totalResults: number;
  uniqueAthletes: number;
  uniqueEvents: number;
  fastestTime?: {
    athlete_name: string;
    event_name: string;
    time_string: string;
    date: string;
  };
  mostRecentResult?: {
    athlete_name: string;
    event_name: string;
    time_string: string;
    date: string;
  };
  mostActiveAthlete?: {
    athlete_name: string;
    count: number;
  };
}

export default function Parkrun() {
  const [results, setResults] = useState<ParkrunResult[]>([]);
  const [stats, setStats] = useState<ParkrunStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Filters>({
    athlete: '',
    event: '',
    dateFrom: '',
    dateTo: '',
  });
  const [pagination, setPagination] = useState({ total: 0, limit: 50, offset: 0 });

  useEffect(() => {
    fetchResults();
    fetchStats();
  }, [filters, pagination.offset]);

  async function fetchResults() {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit: pagination.limit.toString(),
        offset: pagination.offset.toString(),
      });

      if (filters.athlete) params.append('athlete', filters.athlete);
      if (filters.event) params.append('event', filters.event);
      if (filters.dateFrom) params.append('date_from', filters.dateFrom);
      if (filters.dateTo) params.append('date_to', filters.dateTo);

      const response = await fetch(`/api/parkrun?${params}`);
      const data = await response.json();

      setResults(data.results || []);
      setPagination(prev => ({ ...prev, total: data.pagination.total }));
    } catch (error) {
      console.error('Error fetching parkrun results:', error);
    } finally {
      setLoading(false);
    }
  }

  async function fetchStats() {
    try {
      const response = await fetch('/api/parkrun/stats');
      const data = await response.json();
      setStats(data);
    } catch (error) {
      console.error('Error fetching parkrun stats:', error);
    }
  }

  function handleFilterChange(newFilters: Partial<Filters>) {
    setFilters(prev => ({ ...prev, ...newFilters }));
    setPagination(prev => ({ ...prev, offset: 0 })); // Reset to first page
  }

  function handleNextPage() {
    if (pagination.offset + pagination.limit < pagination.total) {
      setPagination(prev => ({ ...prev, offset: prev.offset + prev.limit }));
    }
  }

  function handlePrevPage() {
    if (pagination.offset > 0) {
      setPagination(prev => ({
        ...prev,
        offset: Math.max(0, prev.offset - prev.limit),
      }));
    }
  }

  function formatPace(timeSeconds: number): string {
    const paceSeconds = timeSeconds / 5; // 5km parkrun
    const minutes = Math.floor(paceSeconds / 60);
    const seconds = Math.floor(paceSeconds % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}/km`;
  }

  return (
    <div className="parkrun-page">
      <div className="parkrun-header">
        <h1>Parkrun Results</h1>
        <p className="subtitle">Woodstock Running Club (Club #19959)</p>
      </div>

      {stats && (
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-value">{stats.totalResults}</div>
            <div className="stat-label">Total Parkruns</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{stats.uniqueAthletes}</div>
            <div className="stat-label">Athletes</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{stats.uniqueEvents}</div>
            <div className="stat-label">Different Events</div>
          </div>
        </div>
      )}

      <div className="filters-section">
        <input
          type="text"
          placeholder="Search athlete name..."
          value={filters.athlete}
          onChange={e => handleFilterChange({ athlete: e.target.value })}
          className="filter-input"
        />
        <input
          type="text"
          placeholder="Search event name..."
          value={filters.event}
          onChange={e => handleFilterChange({ event: e.target.value })}
          className="filter-input"
        />
        <input
          type="date"
          value={filters.dateFrom}
          onChange={e => handleFilterChange({ dateFrom: e.target.value })}
          className="filter-input"
        />
        <input
          type="date"
          value={filters.dateTo}
          onChange={e => handleFilterChange({ dateTo: e.target.value })}
          className="filter-input"
        />
        <button
          onClick={() =>
            handleFilterChange({ athlete: '', event: '', dateFrom: '', dateTo: '' })
          }
          className="clear-filters-btn"
        >
          Clear Filters
        </button>
      </div>

      {loading ? (
        <div className="loading">Loading parkrun results...</div>
      ) : results.length === 0 ? (
        <div className="empty-state">
          <p>No parkrun results found.</p>
          <p className="hint">
            Results are automatically synced daily. If you've just set up the system,
            please wait for the first sync to complete.
          </p>
        </div>
      ) : (
        <>
          <div className="results-table-container">
            <table className="results-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Event</th>
                  <th>Athlete</th>
                  <th>Position</th>
                  <th>Time</th>
                  <th>Pace</th>
                </tr>
              </thead>
              <tbody>
                {results.map(result => (
                  <tr key={result.id}>
                    <td>{new Date(result.date).toLocaleDateString()}</td>
                    <td>
                      <div className="event-name">{result.event_name}</div>
                      <div className="event-number">Event #{result.event_number}</div>
                    </td>
                    <td className="athlete-name">{result.athlete_name}</td>
                    <td className="position">{result.position}</td>
                    <td className="time">{result.time_string}</td>
                    <td className="pace">{formatPace(result.time_seconds)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="pagination">
            <button
              onClick={handlePrevPage}
              disabled={pagination.offset === 0}
              className="pagination-btn"
            >
              Previous
            </button>
            <span className="pagination-info">
              Showing {pagination.offset + 1} to{' '}
              {Math.min(pagination.offset + pagination.limit, pagination.total)} of{' '}
              {pagination.total} results
            </span>
            <button
              onClick={handleNextPage}
              disabled={pagination.offset + pagination.limit >= pagination.total}
              className="pagination-btn"
            >
              Next
            </button>
          </div>
        </>
      )}
    </div>
  );
}
