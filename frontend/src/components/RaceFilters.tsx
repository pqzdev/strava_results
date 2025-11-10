import './RaceFilters.css';

interface Filters {
  athlete: string;
  activityName: string;
  dateFrom: string;
  dateTo: string;
  minDistance: string;
  maxDistance: string;
}

interface RaceFiltersProps {
  filters: Filters;
  onFilterChange: (filters: Partial<Filters>) => void;
  onClearFilters: () => void;
}

export default function RaceFilters({
  filters,
  onFilterChange,
  onClearFilters,
}: RaceFiltersProps) {
  const hasActiveFilters = Object.values(filters).some((value) => value);

  return (
    <div className="race-filters">
      <div className="filters-grid">
        <div className="filter-group">
          <label htmlFor="athlete">Athlete Name</label>
          <input
            id="athlete"
            type="text"
            placeholder="Search by name..."
            value={filters.athlete}
            onChange={(e) => onFilterChange({ athlete: e.target.value })}
          />
        </div>

        <div className="filter-group">
          <label htmlFor="activityName">Activity Name</label>
          <input
            id="activityName"
            type="text"
            placeholder="Search by activity..."
            value={filters.activityName}
            onChange={(e) => onFilterChange({ activityName: e.target.value })}
          />
        </div>

        <div className="filter-group">
          <label htmlFor="dateFrom">From Date</label>
          <input
            id="dateFrom"
            type="date"
            value={filters.dateFrom}
            onChange={(e) => onFilterChange({ dateFrom: e.target.value })}
          />
        </div>

        <div className="filter-group">
          <label htmlFor="dateTo">To Date</label>
          <input
            id="dateTo"
            type="date"
            value={filters.dateTo}
            onChange={(e) => onFilterChange({ dateTo: e.target.value })}
          />
        </div>

        <div className="filter-group">
          <label htmlFor="minDistance">Min Distance (m)</label>
          <input
            id="minDistance"
            type="number"
            placeholder="e.g., 5000"
            value={filters.minDistance}
            onChange={(e) => onFilterChange({ minDistance: e.target.value })}
          />
        </div>

        <div className="filter-group">
          <label htmlFor="maxDistance">Max Distance (m)</label>
          <input
            id="maxDistance"
            type="number"
            placeholder="e.g., 42195"
            value={filters.maxDistance}
            onChange={(e) => onFilterChange({ maxDistance: e.target.value })}
          />
        </div>

        {hasActiveFilters && (
          <div className="filter-group filter-actions">
            <button
              className="button button-clear"
              onClick={onClearFilters}
            >
              Clear Filters
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
