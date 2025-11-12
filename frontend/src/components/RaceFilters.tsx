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
  { label: '10K', minMeters: 9700, maxMeters: 10300 },
  { label: '14K', minMeters: 13700, maxMeters: 14300 },
  { label: 'Half Marathon', minMeters: 20800, maxMeters: 21600 },
  { label: '30K', minMeters: 29500, maxMeters: 30500 },
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
  const [otherDistanceEnabled, setOtherDistanceEnabled] = useState(false);
  const [customMin, setCustomMin] = useState('');
  const [customMax, setCustomMax] = useState('');

  const getDefaultDateTo = () => new Date().toISOString().split('T')[0];

  const calculateDistanceFilter = (
    presetSelections: boolean[],
    useCustom: boolean,
    customMinVal: string,
    customMaxVal: string
  ) => {
    const selectedRanges = DISTANCE_RANGES.filter((_, idx) => presetSelections[idx]);

    let minDistance = '';
    let maxDistance = '';

    if (selectedRanges.length > 0) {
      minDistance = Math.min(...selectedRanges.map(r => r.minMeters)).toString();
      maxDistance = Math.max(...selectedRanges.map(r => r.maxMeters)).toString();
    }

    // If "Other distances" is enabled and has values, combine with preset ranges
    if (useCustom) {
      if (customMinVal) {
        const customMinMeters = parseFloat(customMinVal) * 1000; // Convert km to meters
        if (minDistance) {
          minDistance = Math.min(parseFloat(minDistance), customMinMeters).toString();
        } else {
          minDistance = customMinMeters.toString();
        }
      } else if (!minDistance) {
        minDistance = ''; // No lower bound
      }

      if (customMaxVal) {
        const customMaxMeters = parseFloat(customMaxVal) * 1000; // Convert km to meters
        if (maxDistance) {
          maxDistance = Math.max(parseFloat(maxDistance), customMaxMeters).toString();
        } else {
          maxDistance = customMaxMeters.toString();
        }
      } else if (!maxDistance) {
        maxDistance = ''; // No upper bound
      }
    } else if (selectedRanges.length === 0) {
      // No presets selected and no custom range
      minDistance = '';
      maxDistance = '';
    }

    return { minDistance, maxDistance };
  };

  const handleDistanceToggle = (index: number) => {
    const newSelected = [...selectedDistances];
    newSelected[index] = !newSelected[index];
    setSelectedDistances(newSelected);

    const filters = calculateDistanceFilter(newSelected, otherDistanceEnabled, customMin, customMax);
    onFilterChange(filters);
  };

  const handleOtherDistanceToggle = () => {
    const newOtherEnabled = !otherDistanceEnabled;
    setOtherDistanceEnabled(newOtherEnabled);

    const filters = calculateDistanceFilter(selectedDistances, newOtherEnabled, customMin, customMax);
    onFilterChange(filters);
  };

  const handleCustomMinChange = (value: string) => {
    setCustomMin(value);
    const filters = calculateDistanceFilter(selectedDistances, otherDistanceEnabled, value, customMax);
    onFilterChange(filters);
  };

  const handleCustomMaxChange = (value: string) => {
    setCustomMax(value);
    const filters = calculateDistanceFilter(selectedDistances, otherDistanceEnabled, customMin, value);
    onFilterChange(filters);
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
    setOtherDistanceEnabled(false);
    setCustomMin('');
    setCustomMax('');
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
            <label className="distance-checkbox-label">
              <input
                type="checkbox"
                checked={otherDistanceEnabled}
                onChange={handleOtherDistanceToggle}
                className="distance-checkbox"
              />
              <span>Other distances</span>
            </label>
          </div>
          {otherDistanceEnabled && (
            <div className="custom-distance-range">
              <div className="custom-distance-inputs">
                <input
                  type="number"
                  placeholder="Min (km)"
                  value={customMin}
                  onChange={(e) => handleCustomMinChange(e.target.value)}
                  className="custom-distance-input"
                  min="0"
                  step="0.1"
                />
                <span className="distance-separator">to</span>
                <input
                  type="number"
                  placeholder="Max (km)"
                  value={customMax}
                  onChange={(e) => handleCustomMaxChange(e.target.value)}
                  className="custom-distance-input"
                  min="0"
                  step="0.1"
                />
              </div>
            </div>
          )}
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
