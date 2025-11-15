import { useState, useEffect } from 'react';
import './ParkrunWeeklySummary.css';

interface WeeklySummary {
  date: string;
  availableDates: string[];
  summary: {
    athleteCount: number;
    eventCount: number;
  };
  popularEvents: Array<{ name: string; count: number }>;
  firstTimeEvents: string[];
  rarePokemons: Array<{ name: string; visitCount: number }>;
}

export default function ParkrunWeeklySummary() {
  const [summary, setSummary] = useState<WeeklySummary | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [showCalendar, setShowCalendar] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(new Date());

  useEffect(() => {
    fetchSummary(selectedDate);
  }, [selectedDate]);

  useEffect(() => {
    if (selectedDate) {
      setCurrentMonth(new Date(selectedDate));
    }
  }, [selectedDate]);

  // Close calendar when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as HTMLElement;
      if (showCalendar && !target.closest('.date-picker')) {
        setShowCalendar(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showCalendar]);

  async function fetchSummary(date?: string) {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (date) {
        params.append('date', date);
      }

      const response = await fetch(`/api/parkrun/weekly-summary?${params}`);
      if (!response.ok) {
        throw new Error('Failed to fetch weekly summary');
      }

      const data = await response.json();
      setSummary(data);
      if (!selectedDate && data.date) {
        setSelectedDate(data.date);
      }
    } catch (error) {
      console.error('Error fetching weekly summary:', error);
    } finally {
      setLoading(false);
    }
  }

  function handleDateSelect(date: string) {
    setSelectedDate(date);
    setShowCalendar(false);
  }

  function jumpToMostRecent() {
    if (summary && summary.availableDates.length > 0) {
      const mostRecent = summary.availableDates[0]; // Array is sorted DESC
      setSelectedDate(mostRecent);
      setCurrentMonth(new Date(mostRecent));
    }
  }

  function handleMonthChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const newMonth = parseInt(event.target.value);
    setCurrentMonth(new Date(currentMonth.getFullYear(), newMonth, 1));
  }

  function handleYearChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const newYear = parseInt(event.target.value);
    setCurrentMonth(new Date(newYear, currentMonth.getMonth(), 1));
  }

  function previousMonth() {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
  }

  function nextMonth() {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));
  }

  if (loading || !summary) {
    return <div className="weekly-summary loading">Loading weekly summary...</div>;
  }

  const availableDatesSet = new Set(summary.availableDates);

  // Get available years from available dates
  const availableYears = Array.from(
    new Set(summary.availableDates.map(date => new Date(date).getFullYear()))
  ).sort((a, b) => b - a); // Descending order

  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  // Generate calendar days for current month
  function generateCalendar() {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay();

    const days: Array<{ date: string; day: number; isAvailable: boolean; isSelected: boolean }> = [];

    // Add empty cells for days before the start of the month
    for (let i = 0; i < startingDayOfWeek; i++) {
      days.push({ date: '', day: 0, isAvailable: false, isSelected: false });
    }

    // Add all days in the month
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const isAvailable = availableDatesSet.has(dateStr);
      const isSelected = dateStr === selectedDate;
      days.push({ date: dateStr, day, isAvailable, isSelected });
    }

    return days;
  }

  const calendarDays = generateCalendar();
  const formattedDate = new Date(selectedDate).toLocaleDateString('en-AU', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  return (
    <div className="weekly-summary">
      <div className="summary-header">
        <h2>Woodstock parkruns - {formattedDate}</h2>
        <div className="date-picker">
          <button
            onClick={() => setShowCalendar(!showCalendar)}
            className="date-picker-button"
          >
            {showCalendar ? 'Close Calendar' : 'Change Date'}
          </button>

          {showCalendar && (
            <div className="calendar-dropdown">
              <div className="calendar-controls">
                <button onClick={jumpToMostRecent} className="jump-to-recent">
                  Jump to most recent
                </button>
              </div>

              <div className="calendar-header">
                <button onClick={previousMonth} className="nav-button">‹</button>
                <div className="date-selectors">
                  <select
                    value={currentMonth.getMonth()}
                    onChange={handleMonthChange}
                    className="month-select"
                  >
                    {months.map((month, index) => (
                      <option key={index} value={index}>
                        {month}
                      </option>
                    ))}
                  </select>
                  <select
                    value={currentMonth.getFullYear()}
                    onChange={handleYearChange}
                    className="year-select"
                  >
                    {availableYears.map((year) => (
                      <option key={year} value={year}>
                        {year}
                      </option>
                    ))}
                  </select>
                </div>
                <button onClick={nextMonth} className="nav-button">›</button>
              </div>

              <div className="calendar-grid">
                <div className="calendar-day-header">Sun</div>
                <div className="calendar-day-header">Mon</div>
                <div className="calendar-day-header">Tue</div>
                <div className="calendar-day-header">Wed</div>
                <div className="calendar-day-header">Thu</div>
                <div className="calendar-day-header">Fri</div>
                <div className="calendar-day-header">Sat</div>

                {calendarDays.map((day, index) => (
                  <div
                    key={index}
                    className={`calendar-day ${day.isAvailable ? 'available' : ''} ${day.isSelected ? 'selected' : ''}`}
                    onClick={() => day.isAvailable && handleDateSelect(day.date)}
                  >
                    {day.day || ''}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="summary-stats">
        <p>
          👟 <strong>{summary.summary.athleteCount}</strong> Woodstock parkrunners across{' '}
          <strong>{summary.summary.eventCount}</strong> different event{summary.summary.eventCount !== 1 ? 's' : ''}
        </p>

        {summary.popularEvents.length > 0 && (
          <p>
            🏆 <strong>Most popular events:</strong>{' '}
            {summary.popularEvents.map((event, index) => (
              <span key={event.name}>
                {index > 0 && ', '}
                {event.name} ({event.count})
              </span>
            ))}
          </p>
        )}

        {summary.firstTimeEvents.length > 0 && (
          <p>
            🎉 <strong>First time Woodstock participation:</strong>{' '}
            {summary.firstTimeEvents.join(', ')}
          </p>
        )}

        {summary.rarePokemons.length > 0 && (
          <p>
            🦄 <strong>Rare Pokémon:</strong>{' '}
            {summary.rarePokemons.map((pokemon, index) => (
              <span key={pokemon.name}>
                {index > 0 && ', '}
                {pokemon.name} ({getOrdinal(pokemon.visitCount)} Woodstock visit)
              </span>
            ))}
          </p>
        )}
      </div>
    </div>
  );
}

function getOrdinal(n: number): string {
  const suffixes = ['th', 'st', 'nd', 'rd'];
  const value = n % 100;
  return n + (suffixes[(value - 20) % 10] || suffixes[value] || suffixes[0]);
}
