import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import './Parkrun.css';
import ParkrunChart from '../components/ParkrunChart';
import ParkrunWeeklySummary from '../components/ParkrunWeeklySummary';
import MultiSelectAutocomplete from '../components/MultiSelectAutocomplete';

// Default date range for parkrun filters
const DEFAULT_DATE_FROM = '2022-01-01';
const getDefaultDateTo = () => new Date().toISOString().split('T')[0];

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
type SortDirection = 'asc' | 'desc';

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

  // Initialize filters from URL params using lazy initializer
  const [filters, setFilters] = useState<Filters>(() => {
    const athletesParam = searchParams.get('athletes');
    const eventsParam = searchParams.get('events');
    return {
      athletes: athletesParam ? athletesParam.split('|').filter(Boolean) : [],
      events: eventsParam ? eventsParam.split('|').filter(Boolean) : [],
      dateFrom: searchParams.get('dateFrom') || DEFAULT_DATE_FROM,
      dateTo: searchParams.get('dateTo') || getDefaultDateTo(),
    };
  });
  const [availableAthletes, setAvailableAthletes] = useState<string[]>([]);
  const [availableEvents, setAvailableEvents] = useState<string[]>([]);
  const [pagination, setPagination] = useState({ total: 0, limit: 50, offset: 0 });
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  useEffect(() => {
    fetchResults();
    fetchStats();
  }, [filters, pagination.offset, sortField, sortDirection]);

  useEffect(() => {
    fetchAvailableOptions();
    fetchAbsoluteDateRange();
  }, []);

  async function fetchResults() {
    setLoading(true);
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

      const response = await fetch(`/api/parkrun?${params}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const data = await response.json();

      setResults(data.results || []);
      setPagination(prev => ({ ...prev, total: data.pagination?.total || 0 }));
    } catch (error) {
      console.error('Error fetching parkrun results:', error);
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

      const response = await fetch(`/api/parkrun/stats?${params}`);
      const data = await response.json();
      setStats(data);
    } catch (error) {
      console.error('Error fetching parkrun stats:', error);
    }
  }

  async function fetchAvailableOptions() {
    try {
      // Fetch all results without pagination to get unique athletes and events
      const response = await fetch('/api/parkrun?limit=10000');
      const data = await response.json();

      if (data.results) {
        const athletes = Array.from(
          new Set(data.results.map((r: ParkrunResult) => r.athlete_name))
        ).sort() as string[];

        const events = Array.from(
          new Set(data.results.map((r: ParkrunResult) => r.event_name))
        ).sort() as string[];

        setAvailableAthletes(athletes);
        setAvailableEvents(events);
      }
    } catch (error) {
      console.error('Error fetching available options:', error);
    }
  }

  async function fetchAbsoluteDateRange() {
    try {
      // Fetch unfiltered stats to get absolute earliest/latest dates for date picker constraints
      const response = await fetch('/api/parkrun/stats');
      const data = await response.json();
      setAbsoluteDateRange({
        earliest: data.earliestDate,
        latest: data.latestDate,
      });
    } catch (error) {
      console.error('Error fetching absolute date range:', error);
    }
  }

  function handleFilterChange(newFilters: Partial<Filters>) {
    let updatedFilters = { ...filters, ...newFilters };

    // Enforce minimum date to earliest available data
    if (absoluteDateRange.earliest && updatedFilters.dateFrom && updatedFilters.dateFrom < absoluteDateRange.earliest) {
      updatedFilters.dateFrom = absoluteDateRange.earliest;
    }

    // Enforce maximum date to today
    const today = getDefaultDateTo();
    if (updatedFilters.dateTo && updatedFilters.dateTo > today) {
      updatedFilters.dateTo = today;
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

  function getSortIcon(field: SortField): string {
    if (sortField !== field) return '↕️';
    return sortDirection === 'asc' ? '↑' : '↓';
  }

  return (
    <div className="parkrun-page">
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
                  max={filters.dateTo || getDefaultDateTo()}
                  value={filters.dateFrom || DEFAULT_DATE_FROM}
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
                  min={filters.dateFrom || DEFAULT_DATE_FROM}
                  max={getDefaultDateTo()}
                  value={filters.dateTo || getDefaultDateTo()}
                  onChange={e => handleFilterChange({ dateTo: e.target.value })}
                  className="date-input"
                />
                <button
                  type="button"
                  onClick={() => handleFilterChange({ dateTo: getDefaultDateTo() })}
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
            handleFilterChange({ athletes: [], events: [], dateFrom: DEFAULT_DATE_FROM, dateTo: getDefaultDateTo() })
          }
          className="clear-filters-btn"
        >
          Clear Filters
        </button>
      </div>

      <ParkrunChart filters={filters} onDateClick={handleDateClick} />

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
