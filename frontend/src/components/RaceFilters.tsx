import { useState, useEffect } from 'react';
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
  earliestDate?: string;
}

// Distance categories with meters and buffer
const DISTANCE_CATEGORIES = [
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
}: RaceFiltersProps) {
  const [minDistIndex, setMinDistIndex] = useState(0);
  const [maxDistIndex, setMaxDistIndex] = useState(DISTANCE_CATEGORIES.length - 1);
  const [minDateIndex, setMinDateIndex] = useState(0);
  const [maxDateIndex, setMaxDateIndex] = useState(0);

  const getMonthsDiff = (date1: Date, date2: Date): number => {
    return (date2.getFullYear() - date1.getFullYear()) * 12 +
           (date2.getMonth() - date1.getMonth());
  };

  const getStartOfMonth = (date: Date): Date => {
    return new Date(date.getFullYear(), date.getMonth(), 1);
  };

  const [totalMonths, setTotalMonths] = useState<number>(0);
  const [startMonth, setStartMonth] = useState<string>('');

  useEffect(() => {
    if (earliestDate) {
      const earliest = getStartOfMonth(new Date(earliestDate));
      const today = new Date();
      const months = getMonthsDiff(earliest, today);
      setTotalMonths(months);
      setStartMonth(earliest.toISOString().split('T')[0]);
      setMinDateIndex(0);
      setMaxDateIndex(months); // Start with full range
    }
  }, [earliestDate]);

  const handleDistanceChange = (minIdx: number, maxIdx: number) => {
    setMinDistIndex(minIdx);
    setMaxDistIndex(maxIdx);

    const minCat = DISTANCE_CATEGORIES[minIdx];
    const maxCat = DISTANCE_CATEGORIES[maxIdx];

    onFilterChange({
      minDistance: minCat.minMeters.toString(),
      maxDistance: maxCat.maxMeters.toString(),
    });
  };

  const handleDateChange = (minIdx: number, maxIdx: number) => {
    setMinDateIndex(minIdx);
    setMaxDateIndex(maxIdx);

    if (startMonth && totalMonths > 0) {
      const start = new Date(startMonth);
      start.setMonth(start.getMonth() + minIdx);

      const end = new Date(startMonth);
      end.setMonth(end.getMonth() + maxIdx);

      onFilterChange({
        dateFrom: start.toISOString().split('T')[0],
        dateTo: end.toISOString().split('T')[0],
      });
    }
  };

  const hasActiveFilters = filters.athlete || filters.activityName ||
                           minDistIndex !== 0 || maxDistIndex !== DISTANCE_CATEGORIES.length - 1 ||
                           minDateIndex !== 0 || maxDateIndex !== totalMonths;

  const handleClear = () => {
    setMinDistIndex(0);
    setMaxDistIndex(DISTANCE_CATEGORIES.length - 1);
    setMinDateIndex(0);
    setMaxDateIndex(totalMonths);
    onClearFilters();
  };

  const formatDateLabel = (monthIndex: number): string => {
    if (!startMonth || totalMonths === 0) return '';
    const date = new Date(startMonth);
    date.setMonth(date.getMonth() + monthIndex);
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
  };

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

        {startMonth && totalMonths > 0 && (
          <div className="filter-group filter-group-wide">
            <label>
              Date Range: {formatDateLabel(minDateIndex)} to {formatDateLabel(maxDateIndex)}
            </label>
            <div className="dual-range">
              <div className="slider-track">
                <div
                  className="slider-range"
                  style={{
                    left: `${(minDateIndex / totalMonths) * 100}%`,
                    right: `${100 - (maxDateIndex / totalMonths) * 100}%`
                  }}
                />
              </div>
              <input
                type="range"
                min="0"
                max={totalMonths}
                value={minDateIndex}
                onChange={(e) => {
                  const newMin = parseInt(e.target.value);
                  if (newMin <= maxDateIndex) {
                    handleDateChange(newMin, maxDateIndex);
                  }
                }}
                className="range-slider range-slider-min"
              />
              <input
                type="range"
                min="0"
                max={totalMonths}
                value={maxDateIndex}
                onChange={(e) => {
                  const newMax = parseInt(e.target.value);
                  if (newMax >= minDateIndex) {
                    handleDateChange(minDateIndex, newMax);
                  }
                }}
                className="range-slider range-slider-max"
              />
            </div>
          </div>
        )}

        <div className="filter-group filter-group-wide">
          <label>
            Distance: {DISTANCE_CATEGORIES[minDistIndex].label} to {DISTANCE_CATEGORIES[maxDistIndex].label}
          </label>
          <div className="dual-range">
            <div className="slider-track">
              <div
                className="slider-range"
                style={{
                  left: `${(minDistIndex / (DISTANCE_CATEGORIES.length - 1)) * 100}%`,
                  right: `${100 - (maxDistIndex / (DISTANCE_CATEGORIES.length - 1)) * 100}%`
                }}
              />
            </div>
            <input
              type="range"
              min="0"
              max={DISTANCE_CATEGORIES.length - 1}
              value={minDistIndex}
              onChange={(e) => {
                const newMin = parseInt(e.target.value);
                if (newMin <= maxDistIndex) {
                  handleDistanceChange(newMin, maxDistIndex);
                }
              }}
              className="range-slider range-slider-min"
            />
            <input
              type="range"
              min="0"
              max={DISTANCE_CATEGORIES.length - 1}
              value={maxDistIndex}
              onChange={(e) => {
                const newMax = parseInt(e.target.value);
                if (newMax >= minDistIndex) {
                  handleDistanceChange(minDistIndex, newMax);
                }
              }}
              className="range-slider range-slider-max"
            />
          </div>
          <div className="slider-labels">
            {DISTANCE_CATEGORIES.map((cat, idx) => (
              <span
                key={idx}
                className="slider-label"
                style={{ left: `${(idx / (DISTANCE_CATEGORIES.length - 1)) * 100}%` }}
              >
                {cat.label}
              </span>
            ))}
          </div>
        </div>

        {hasActiveFilters && (
          <div className="filter-group filter-actions">
            <button
              className="button button-clear"
              onClick={handleClear}
            >
              Clear Filters
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
