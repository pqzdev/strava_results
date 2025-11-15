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

  useEffect(() => {
    fetchSummary(selectedDate);
  }, [selectedDate]);

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

  function handleDateChange(event: React.ChangeEvent<HTMLSelectElement>) {
    setSelectedDate(event.target.value);
  }

  if (loading || !summary) {
    return <div className="weekly-summary loading">Loading weekly summary...</div>;
  }

  // Format date range (earliest to latest available)
  const earliestDate = summary.availableDates[summary.availableDates.length - 1];
  const latestDate = summary.availableDates[0];
  const dateRangeText = earliestDate && latestDate
    ? `${new Date(earliestDate).toLocaleDateString()} - ${new Date(latestDate).toLocaleDateString()}`
    : '';

  return (
    <div className="weekly-summary">
      <div className="summary-header">
        <h2>Woodstock parkruns - {dateRangeText}</h2>
        <div className="date-picker">
          <label htmlFor="summary-date">Select date:</label>
          <select
            id="summary-date"
            value={selectedDate}
            onChange={handleDateChange}
            className="date-select"
          >
            {summary.availableDates.map((date) => (
              <option key={date} value={date}>
                {new Date(date).toLocaleDateString()}
              </option>
            ))}
          </select>
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
            🦄 <strong>Rare pokemons:</strong>{' '}
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
