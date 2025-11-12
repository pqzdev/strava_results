import { useState } from 'react';
import MultiSelectAutocomplete from './MultiSelectAutocomplete';
import './RaceFilters.css';

interface Filters {
  athletes: string[];
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
  earliestDate?: string;
  availableAthletes?: string[];
}

// Distance categories with meters and buffer
const DISTANCE_RANGES = [
  { label: '<5K', minMeters: 0, maxMeters: 4800 },
  { label: '5K', minMeters: 4800, maxMeters: 5200 },
  { label: '5K-10K', minMeters: 5200, maxMeters: 9700 },
  { label: '10K', minMeters: 9700, maxMeters: 10300 },
  { label: '10K-14K', minMeters: 10300, maxMeters: 13700 },
  { label: '14K', minMeters: 13700, maxMeters: 14300 },
  { label: '14K-HM', minMeters: 14300, maxMeters: 20800 },
  { label: 'Half Marathon', minMeters: 20800, maxMeters: 21600 },
  { label: 'HM-30K', minMeters: 21600, maxMeters: 29500 },
  { label: '30K', minMeters: 29500, maxMeters: 30500 },
  { label: '30K-Marathon', minMeters: 30500, maxMeters: 41700 },
  { label: 'Marathon', minMeters: 41700, maxMeters: 43200 },
  { label: 'Ultra', minMeters: 43200, maxMeters: 999999 },
];

export default function RaceFilters({
  filters,
  onFilterChange,
  onClearFilters,
  earliestDate,
  availableAthletes = [],
}: RaceFiltersProps) {
  const [selectedDistances, setSelectedDistances] = useState<boolean[]>(
    new Array(DISTANCE_RANGES.length).fill(true)
  );

  const getDefaultDateTo = () => new Date().toISOString().split('T')[0];

  const handleDistanceToggle = (index: number) => {
    const newSelected = [...selectedDistances];
    newSelected[index] = !newSelected[index];
    setSelectedDistances(newSelected);

    // Calculate min and max from selected ranges
    const selectedRanges = DISTANCE_RANGES.filter((_, idx) => newSelected[idx]);
    if (selectedRanges.length === 0) {
      // If nothing selected, show nothing (set impossible range)
      onFilterChange({ minDistance: '999999', maxDistance: '0' });
    } else {
      const minDistance = Math.min(...selectedRanges.map(r => r.minMeters)).toString();
      const maxDistance = Math.max(...selectedRanges.map(r => r.maxMeters)).toString();
      onFilterChange({ minDistance, maxDistance });
    }
  };

  const handleDateFromChange = (value: string) => {
    let dateFrom = value;
    // Enforce minimum date to earliest available data
    if (earliestDate && dateFrom && dateFrom < earliestDate) {
      dateFrom = earliestDate;
    }
    // Enforce that dateFrom is not after dateTo
    if (filters.dateTo && dateFrom > filters.dateTo) {
      dateFrom = filters.dateTo;
    }
    onFilterChange({ dateFrom });
  };

  const handleDateToChange = (value: string) => {
    let dateTo = value;
    // Enforce maximum date to today
    const today = getDefaultDateTo();
    if (dateTo && dateTo > today) {
      dateTo = today;
    }
    // Enforce that dateTo is not before dateFrom
    if (filters.dateFrom && dateTo < filters.dateFrom) {
      dateTo = filters.dateFrom;
    }
    onFilterChange({ dateTo });
  };

  const handleClear = () => {
    setSelectedDistances(new Array(DISTANCE_RANGES.length).fill(true));
    onClearFilters();
  };

  return (
    <div className="race-filters">
      <div className="filters-grid">
        <div className="filter-group filter-group-wide">
          <MultiSelectAutocomplete
            options={availableAthletes}
            selected={filters.athletes}
            onChange={athletes => onFilterChange({ athletes })}
            placeholder="Select athletes..."
            label="Filter by Athletes"
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

        {earliestDate && (
          <div className="filter-group filter-group-wide">
            <label>Date Range</label>
            <div className="date-range-inputs">
              <div className="date-input-wrapper">
                <input
                  type="date"
                  min={earliestDate}
                  max={filters.dateTo || getDefaultDateTo()}
                  value={filters.dateFrom || earliestDate}
                  onChange={(e) => handleDateFromChange(e.target.value)}
                  className="date-input"
                />
                <button
                  type="button"
                  onClick={() => handleDateFromChange(earliestDate)}
                  className="date-shortcut-link"
                  title="Set to earliest date"
                >
                  min
                </button>
              </div>
              <span className="date-separator">to</span>
              <div className="date-input-wrapper">
                <input
                  type="date"
                  min={filters.dateFrom || earliestDate}
                  max={getDefaultDateTo()}
                  value={filters.dateTo || getDefaultDateTo()}
                  onChange={(e) => handleDateToChange(e.target.value)}
                  className="date-input"
                />
                <button
                  type="button"
                  onClick={() => handleDateToChange(getDefaultDateTo())}
                  className="date-shortcut-link"
                  title="Set to today"
                >
                  today
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="filter-group filter-group-wide">
          <label>Distance</label>
          <div className="distance-checkboxes">
            {DISTANCE_RANGES.map((range, idx) => (
              <label key={idx} className="distance-checkbox-label">
                <input
                  type="checkbox"
                  checked={selectedDistances[idx]}
                  onChange={() => handleDistanceToggle(idx)}
                  className="distance-checkbox"
                />
                <span>{range.label}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="filter-group filter-actions">
          <button
            className="clear-filters-btn"
            onClick={handleClear}
          >
            Clear Filters
          </button>
        </div>
      </div>
    </div>
  );
}
