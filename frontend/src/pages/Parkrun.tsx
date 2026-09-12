import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import './Parkrun.css';
import ParkrunChart from '../components/ParkrunChart';
import ParkrunWeeklySummary from '../components/ParkrunWeeklySummary';
import MultiSelectAutocomplete from '../components/MultiSelectAutocomplete';
import { fetchApi, ApiMaintenanceError } from '../utils/api';

// Placeholder defaults before actual data range is loaded
const PLACEHOLDER_DATE_FROM = '2022-01-01';
const getPlaceholderDateTo = () => new Date().toISOString().split('T')[0];

interface ParkrunResult {
  id: number;
  athlete_name: string;
  parkrun_athlete_id?: string;
  event_name: string;
  event_number: number;
  position: number;
  gender_position?: number;
  time_seconds: number;
  time_string: string;
  age_grade?: string;
  age_category?: string;
  date: string;
  club_name?: string;
}

interface Filters {
  athletes: string[];
  events: string[];
  dateFrom: string;
  dateTo: string;
}

type SortField = 'date' | 'event_name' | 'athlete_name' | 'position' | 'gender_position' | 'time_seconds';
type LeaderboardSortField = 'athlete_name' | 'total_runs' | 'distinct_events' | 'fastest_seconds';
type SortDirection = 'asc' | 'desc';

interface LeaderboardEntry {
  athlete_name: string;
  parkrun_athlete_id: string | null;
  total_runs: number;
  distinct_events: number;
  fastest_seconds: number;
  fastest_time_string: string | null;
}

interface ParkrunStats {
  totalResults: number;
  uniqueAthletes: number;
  uniqueEvents: number;
  earliestDate?: string;
  latestDate?: string;
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
  const [searchParams, setSearchParams] = useSearchParams();

  const [results, setResults] = useState<ParkrunResult[]>([]);
  const [stats, setStats] = useState<ParkrunStats | null>(null);
  const [absoluteDateRange, setAbsoluteDateRange] = useState<{ earliest?: string; latest?: string }>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Track if URL had date params (to know if we should override with data defaults)
  const [hadUrlDateParams] = useState(() => ({
    dateFrom: searchParams.has('dateFrom'),
    dateTo: searchParams.has('dateTo'),
  }));

  // Initialize filters from URL params using lazy initializer
  const [filters, setFilters] = useState<Filters>(() => {
    const athletesParam = searchParams.get('athletes');
    const eventsParam = searchParams.get('events');
    return {
      athletes: athletesParam ? athletesParam.split('|').filter(Boolean) : [],
      events: eventsParam ? eventsParam.split('|').filter(Boolean) : [],
      dateFrom: searchParams.get('dateFrom') || PLACEHOLDER_DATE_FROM,
      dateTo: searchParams.get('dateTo') || getPlaceholderDateTo(),
    };
  });
  const [availableAthletes, setAvailableAthletes] = useState<string[]>([]);
  const [availableEvents, setAvailableEvents] = useState<string[]>([]);
  const [pagination, setPagination] = useState({ total: 0, limit: 50, offset: 0 });
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [leaderboardTotal, setLeaderboardTotal] = useState(0);
  const [leaderboardOffset, setLeaderboardOffset] = useState(0);
  const [leaderboardSortField, setLeaderboardSortField] = useState<LeaderboardSortField>('total_runs');
  const [leaderboardSortDir, setLeaderboardSortDir] = useState<SortDirection>('desc');
  const LEADERBOARD_LIMIT = 10;

  useEffect(() => {
    fetchResults();
    fetchStats();
  }, [filters, pagination.offset, sortField, sortDirection]);

  // Reset leaderboard to page 1 when the relevant filters or sort change
  useEffect(() => {
    setLeaderboardOffset(0);
  }, [filters.events, filters.dateFrom, filters.dateTo, leaderboardSortField, leaderboardSortDir]);

  useEffect(() => {
    fetchLeaderboard();
  }, [filters.events, filters.dateFrom, filters.dateTo, leaderboardOffset, leaderboardSortField, leaderboardSortDir]);

  useEffect(() => {
    fetchAvailableOptions();
    fetchAbsoluteDateRange();
  }, []);

  async function fetchResults() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        limit: pagination.limit.toString(),
        offset: pagination.offset.toString(),
      });

      // Handle multi-select filters
      filters.athletes.forEach(athlete => params.append('athlete', athlete));
      filters.events.forEach(event => params.append('event', event));

      if (filters.dateFrom) params.append('date_from', filters.dateFrom);
      if (filters.dateTo) params.append('date_to', filters.dateTo);
      params.append('sort_by', sortField);
      params.append('sort_dir', sortDirection);

      const data = await fetchApi<{ results: ParkrunResult[]; pagination?: { total: number } }>(`/api/parkrun?${params}`);

      setResults(data.results || []);
      setPagination(prev => ({ ...prev, total: data.pagination?.total || 0 }));
    } catch (err) {
      console.error('Error fetching parkrun results:', err);
      if (err instanceof ApiMaintenanceError) {
        setError(err.message);
      }
      // Don't clear results on error - keep showing previous data
      setResults([]);
      setPagination(prev => ({ ...prev, total: 0 }));
    } finally {
      setLoading(false);
    }
  }

  async function fetchStats() {
    try {
      const params = new URLSearchParams();

      // Apply same filters as results
      filters.athletes.forEach(athlete => params.append('athlete', athlete));
      filters.events.forEach(event => params.append('event', event));
      if (filters.dateFrom) params.append('date_from', filters.dateFrom);
      if (filters.dateTo) params.append('date_to', filters.dateTo);

      const data = await fetchApi<ParkrunStats>(`/api/parkrun/stats?${params}`);
      setStats(data);
    } catch (err) {
      console.error('Error fetching parkrun stats:', err);
      if (err instanceof ApiMaintenanceError) {
        setError(err.message);
      }
    }
  }

  async function fetchLeaderboard() {
    try {
      const params = new URLSearchParams({
        limit: LEADERBOARD_LIMIT.toString(),
        offset: leaderboardOffset.toString(),
        sort_by: leaderboardSortField,
        sort_dir: leaderboardSortDir,
      });
      // Deliberately exclude the athlete filter — the leaderboard ranks everyone,
      // clicking a name filters the results table instead.
      filters.events.forEach(e => params.append('event', e));
      // Only send date params when the user has actually narrowed the range —
      // the placeholder defaults mean "no filter", and omitting them lets the
      // backend use its precomputed all-time stats instead of a live scan.
      if (filters.dateFrom && filters.dateFrom !== PLACEHOLDER_DATE_FROM) {
        params.append('date_from', filters.dateFrom);
      }
      if (filters.dateTo && filters.dateTo !== getPlaceholderDateTo()) {
        params.append('date_to', filters.dateTo);
      }

      const data = await fetchApi<{
        leaderboard: LeaderboardEntry[];
        pagination: { total: number; limit: number; offset: number };
      }>(`/api/parkrun/leaderboard?${params}`);

      setLeaderboard(data.leaderboard || []);
      setLeaderboardTotal(data.pagination?.total || 0);
    } catch (err) {
      console.error('Error fetching leaderboard:', err);
    }
  }

  async function fetchAvailableOptions() {
    try {
      const data = await fetchApi<{ athletes: string[]; events: string[] }>('/api/parkrun/filter-options');
      setAvailableAthletes(data.athletes || []);
      setAvailableEvents(data.events || []);
    } catch (err) {
      console.error('Error fetching available options:', err);
      if (err instanceof ApiMaintenanceError) {
        setError(err.message);
      }
    }
  }

  async function fetchAbsoluteDateRange() {
    try {
      // Fetch unfiltered stats to get absolute earliest/latest dates for date picker constraints
      const data = await fetchApi<{ earliestDate?: string; latestDate?: string }>('/api/parkrun/stats');
      setAbsoluteDateRange({
        earliest: data.earliestDate,
        latest: data.latestDate,
      });

      // Update filter defaults to match actual data range (only if no URL params were provided)
      if (data.earliestDate || data.latestDate) {
        setFilters(prev => ({
          ...prev,
          dateFrom: hadUrlDateParams.dateFrom ? prev.dateFrom : (data.earliestDate || prev.dateFrom),
          dateTo: hadUrlDateParams.dateTo ? prev.dateTo : (data.latestDate || prev.dateTo),
        }));
      }
    } catch (err) {
      console.error('Error fetching absolute date range:', err);
      if (err instanceof ApiMaintenanceError) {
        setError(err.message);
      }
    }
  }

  function handleFilterChange(newFilters: Partial<Filters>) {
    let updatedFilters = { ...filters, ...newFilters };

    // Enforce minimum date to earliest available data
    if (absoluteDateRange.earliest && updatedFilters.dateFrom && updatedFilters.dateFrom < absoluteDateRange.earliest) {
      updatedFilters.dateFrom = absoluteDateRange.earliest;
    }

    // Enforce maximum date to latest available data (or today as fallback)
    const maxDate = absoluteDateRange.latest || getPlaceholderDateTo();
    if (updatedFilters.dateTo && updatedFilters.dateTo > maxDate) {
      updatedFilters.dateTo = maxDate;
    }

    setFilters(updatedFilters);
    setPagination(prev => ({ ...prev, offset: 0 })); // Reset to first page

    // Update URL params (use pipe separator to avoid conflicts with commas in names)
    const params = new URLSearchParams();
    if (updatedFilters.athletes.length > 0) {
      params.set('athletes', updatedFilters.athletes.join('|'));
    }
    if (updatedFilters.events.length > 0) {
      params.set('events', updatedFilters.events.join('|'));
    }
    if (updatedFilters.dateFrom) {
      params.set('dateFrom', updatedFilters.dateFrom);
    }
    if (updatedFilters.dateTo) {
      params.set('dateTo', updatedFilters.dateTo);
    }
    setSearchParams(params, { replace: true });
  }

  function handleDateClick(date: string) {
    // Filter to show only results from the clicked date
    handleFilterChange({ dateFrom: date, dateTo: date });
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

  function formatTime(timeSeconds: number): string {
    const hours = Math.floor(timeSeconds / 3600);
    const minutes = Math.floor((timeSeconds % 3600) / 60);
    const seconds = Math.floor(timeSeconds % 60);

    // Only show hours if time is over 59:59
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  function formatPace(timeSeconds: number): string {
    const paceSeconds = timeSeconds / 5; // 5km parkrun
    const minutes = Math.floor(paceSeconds / 60);
    const seconds = Math.floor(paceSeconds % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}/km`;
  }

  function formatNumber(num: number): string {
    return num.toLocaleString();
  }

  function handleSort(field: SortField) {
    if (sortField === field) {
      // Toggle direction if clicking same field
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      // New field - set default direction based on field type
      setSortField(field);
      if (field === 'date') {
        setSortDirection('desc'); // Newest first
      } else if (field === 'time_seconds' || field === 'position' || field === 'gender_position') {
        setSortDirection('asc'); // Fastest/best first
      } else {
        setSortDirection('asc'); // Alphabetical
      }
    }
    setPagination(prev => ({ ...prev, offset: 0 })); // Reset to first page
  }

  function getSortIcon(field: SortField): React.ReactNode {
    if (sortField !== field) return <i className="fa-solid fa-sort"></i>;
    return sortDirection === 'asc' ? <i className="fa-solid fa-sort-up"></i> : <i className="fa-solid fa-sort-down"></i>;
  }

  function handleLeaderboardSort(field: LeaderboardSortField) {
    if (leaderboardSortField === field) {
      setLeaderboardSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setLeaderboardSortField(field);
      // fastest_seconds: ascending (fastest first); others: descending
      setLeaderboardSortDir(field === 'fastest_seconds' || field === 'athlete_name' ? 'asc' : 'desc');
    }
  }

  function getLeaderboardSortIcon(field: LeaderboardSortField): React.ReactNode {
    if (leaderboardSortField !== field) return <i className="fa-solid fa-sort"></i>;
    return leaderboardSortDir === 'asc' ? <i className="fa-solid fa-sort-up"></i> : <i className="fa-solid fa-sort-down"></i>;
  }

  return (
    <div className="parkrun-page">
      {error && (
        <div style={{
          padding: '1rem',
          margin: '1rem 0',
          backgroundColor: '#fef3c7',
          border: '1px solid #f59e0b',
          borderRadius: '8px',
          textAlign: 'center',
          color: '#92400e',
        }}>
          {error}
        </div>
      )}
      <div className="parkrun-header">
        <h1>Parkrun Results</h1>
        <p className="subtitle">
          <a href="https://www.parkrun.com/results/consolidatedclub/?clubNum=19959">
            Woodstock Running Club (Club #19959)
          </a>
        </p>
        <p className="group-info">
          Join or leave the Woodstock Runners parkrun group{' '}
          <a
            href="https://www.parkrun.com/profile/groups#q=Woodstock%20Runners&id=19959"
            target="_blank"
            rel="noopener noreferrer"
          >
            here
          </a>
        </p>
      </div>

      <ParkrunWeeklySummary />

      <div className="stats-grid">
        {stats ? (
          <>
            <div className="stat-card">
              <div className="stat-value">{formatNumber(stats.totalResults)}</div>
              <div className="stat-label">Total Parkruns</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{formatNumber(stats.uniqueAthletes)}</div>
              <div className="stat-label">Athletes</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{formatNumber(stats.uniqueEvents)}</div>
              <div className="stat-label">Different Events</div>
            </div>
          </>
        ) : (
          <>
            <div className="stat-card stat-card-loading">
              <div className="stat-value">-</div>
              <div className="stat-label">Total Parkruns</div>
            </div>
            <div className="stat-card stat-card-loading">
              <div className="stat-value">-</div>
              <div className="stat-label">Athletes</div>
            </div>
            <div className="stat-card stat-card-loading">
              <div className="stat-value">-</div>
              <div className="stat-label">Different Events</div>
            </div>
          </>
        )}
      </div>

      <div className="filters-section">
        <MultiSelectAutocomplete
          options={availableAthletes}
          selected={filters.athletes}
          onChange={athletes => handleFilterChange({ athletes })}
          placeholder="Select athletes..."
          label="Filter by Athletes"
        />
        <MultiSelectAutocomplete
          options={availableEvents}
          selected={filters.events}
          onChange={events => handleFilterChange({ events })}
          placeholder="Select events..."
          label="Filter by Events"
        />
        {absoluteDateRange.earliest && absoluteDateRange.latest && (
          <div className="date-range-filter">
            <label>Date Range</label>
            <div className="date-inputs">
              <div className="date-input-wrapper">
                <input
                  type="date"
                  min={absoluteDateRange.earliest}
                  max={filters.dateTo || absoluteDateRange.latest}
                  value={filters.dateFrom || absoluteDateRange.earliest}
                  onChange={e => handleFilterChange({ dateFrom: e.target.value })}
                  className="date-input"
                />
                <button
                  type="button"
                  onClick={() => handleFilterChange({ dateFrom: absoluteDateRange.earliest })}
                  className="date-shortcut-link"
                >
                  min
                </button>
              </div>
              <span className="date-separator">to</span>
              <div className="date-input-wrapper">
                <input
                  type="date"
                  min={filters.dateFrom || absoluteDateRange.earliest}
                  max={absoluteDateRange.latest}
                  value={filters.dateTo || absoluteDateRange.latest}
                  onChange={e => handleFilterChange({ dateTo: e.target.value })}
                  className="date-input"
                />
                <button
                  type="button"
                  onClick={() => handleFilterChange({ dateTo: absoluteDateRange.latest })}
                  className="date-shortcut-link"
                >
                  max
                </button>
              </div>
            </div>
          </div>
        )}
        <button
          onClick={() =>
            handleFilterChange({
              athletes: [],
              events: [],
              dateFrom: absoluteDateRange.earliest || PLACEHOLDER_DATE_FROM,
              dateTo: absoluteDateRange.latest || getPlaceholderDateTo()
            })
          }
          className="clear-filters-btn"
        >
          Clear Filters
        </button>
      </div>

      <ParkrunChart filters={filters} onDateClick={handleDateClick} />

      {/* Woodstock Leaderboard */}
      <div className="leaderboard-section">
        <h2 className="leaderboard-title">Woodstock Leaderboard</h2>
        {leaderboard.length === 0 ? (
          <div className="leaderboard-empty">No results for the current filters.</div>
        ) : (
          <>
            <div className="leaderboard-table-container">
              <table className="leaderboard-table">
                <thead>
                  <tr>
                    <th className="leaderboard-rank">#</th>
                    <th
                      onClick={() => handleLeaderboardSort('athlete_name')}
                      className="leaderboard-th-sortable"
                    >
                      Athlete {getLeaderboardSortIcon('athlete_name')}
                    </th>
                    <th
                      onClick={() => handleLeaderboardSort('total_runs')}
                      className="leaderboard-th-sortable"
                    >
                      Total Runs {getLeaderboardSortIcon('total_runs')}
                    </th>
                    <th
                      onClick={() => handleLeaderboardSort('distinct_events')}
                      className="leaderboard-th-sortable"
                    >
                      Distinct Events {getLeaderboardSortIcon('distinct_events')}
                    </th>
                    <th
                      onClick={() => handleLeaderboardSort('fastest_seconds')}
                      className="leaderboard-th-sortable"
                    >
                      Fastest Time {getLeaderboardSortIcon('fastest_seconds')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboard.map((entry, i) => (
                    <tr key={entry.athlete_name}>
                      <td className="leaderboard-rank-cell">
                        {leaderboardOffset + i + 1}
                      </td>
                      <td className="leaderboard-athlete">
                        <button
                          className="leaderboard-athlete-btn"
                          onClick={() => handleFilterChange({ athletes: [entry.athlete_name] })}
                          title={`Filter results to ${entry.athlete_name}`}
                        >
                          {entry.athlete_name}
                        </button>
                      </td>
                      <td>{entry.total_runs}</td>
                      <td>{entry.distinct_events}</td>
                      <td className="leaderboard-time">
                        {entry.fastest_seconds > 0 ? formatTime(entry.fastest_seconds) : '–'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {leaderboardTotal > LEADERBOARD_LIMIT && (
              <div className="leaderboard-pagination">
                <button
                  onClick={() => setLeaderboardOffset(o => Math.max(0, o - LEADERBOARD_LIMIT))}
                  disabled={leaderboardOffset === 0}
                  className="pagination-btn"
                >
                  Previous
                </button>
                <span className="pagination-info">
                  {leaderboardOffset + 1}–{Math.min(leaderboardOffset + LEADERBOARD_LIMIT, leaderboardTotal)} of {leaderboardTotal}
                </span>
                <button
                  onClick={() => setLeaderboardOffset(o => o + LEADERBOARD_LIMIT)}
                  disabled={leaderboardOffset + LEADERBOARD_LIMIT >= leaderboardTotal}
                  className="pagination-btn"
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
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
                  <th onClick={() => handleSort('date')} style={{ cursor: 'pointer' }}>
                    Date {getSortIcon('date')}
                  </th>
                  <th onClick={() => handleSort('event_name')} style={{ cursor: 'pointer' }}>
                    Event {getSortIcon('event_name')}
                  </th>
                  <th onClick={() => handleSort('athlete_name')} style={{ cursor: 'pointer' }}>
                    Athlete {getSortIcon('athlete_name')}
                  </th>
                  <th onClick={() => handleSort('position')} style={{ cursor: 'pointer' }}>
                    Overall Pos {getSortIcon('position')}
                  </th>
                  <th onClick={() => handleSort('gender_position')} style={{ cursor: 'pointer' }}>
                    Gender Pos {getSortIcon('gender_position')}
                  </th>
                  <th onClick={() => handleSort('time_seconds')} style={{ cursor: 'pointer' }}>
                    Time {getSortIcon('time_seconds')}
                  </th>
                  <th>Pace</th>
                </tr>
              </thead>
              <tbody>
                {results.map(result => (
                  <tr key={result.id}>
                    <td>{new Date(result.date).toLocaleDateString()}</td>
                    <td>
                      <div className="event-name">{result.event_name}</div>
                      {result.event_number > 0 && (
                        <div className="event-number">Event #{result.event_number}</div>
                      )}
                    </td>
                    <td className="athlete-name">
                      {result.parkrun_athlete_id ? (
                        <a
                          href={`https://www.parkrun.com.au/parkrunner/${result.parkrun_athlete_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {result.athlete_name}
                        </a>
                      ) : (
                        result.athlete_name
                      )}
                    </td>
                    <td className="position">{result.position}</td>
                    <td className="position">{result.gender_position || '-'}</td>
                    <td className="time">{formatTime(result.time_seconds)}</td>
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
              Showing {formatNumber(pagination.offset + 1)} to{' '}
              {formatNumber(Math.min(pagination.offset + pagination.limit, pagination.total))} of{' '}
              {formatNumber(pagination.total)} results
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
