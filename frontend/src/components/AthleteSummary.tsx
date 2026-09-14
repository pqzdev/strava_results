import { useState } from 'react';
import './AthleteSummary.css';

interface AthleteStat {
  athleteName: string;
  profilePhoto?: string;
  activityCount: number;
  totalDistance: number;
  totalTime: number;
  averagePace: number;
}

interface AthleteSummaryProps {
  athleteStats: AthleteStat[];
  selectedAthletes?: string[];
  onAthleteToggle?: (athleteName: string) => void;
}

export default function AthleteSummary({ athleteStats, selectedAthletes = [], onAthleteToggle }: AthleteSummaryProps) {
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(20);
  const [isCollapsed, setIsCollapsed] = useState(true);

  // Already aggregated and filtered server-side (GET /api/races/athlete-summary);
  // just sort by activity count descending for display.
  const summaryData: AthleteStat[] = [...athleteStats].sort((a, b) => b.activityCount - a.activityCount);

  // Pagination logic
  const totalAthletes = summaryData.length;
  const showAll = itemsPerPage === -1;
  const paginatedData = showAll
    ? summaryData
    : summaryData.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  const totalPages = showAll ? 1 : Math.ceil(totalAthletes / itemsPerPage);

  // Reset to page 1 when items per page changes
  const handleItemsPerPageChange = (value: number) => {
    setItemsPerPage(value);
    setCurrentPage(1);
  };

  const handleAthleteClick = (athleteName: string) => {
    if (onAthleteToggle) {
      onAthleteToggle(athleteName);
    }
  };

  const formatDistance = (meters: number) => {
    return (meters / 1000).toFixed(2);
  };

  const formatTime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m ${secs}s`;
  };

  const formatPace = (paceMinPerKm: number) => {
    if (!isFinite(paceMinPerKm) || paceMinPerKm <= 0) {
      return '-';
    }
    const minutes = Math.floor(paceMinPerKm);
    const seconds = Math.round((paceMinPerKm - minutes) * 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  if (summaryData.length === 0) {
    return null;
  }

  return (
    <div className="athlete-summary">
      <div className="summary-header">
        <h2 className="summary-title" onClick={() => setIsCollapsed(!isCollapsed)} style={{ cursor: 'pointer', userSelect: 'none', fontSize: '1.125rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {isCollapsed ? <i className="fa-solid fa-chevron-right"></i> : <i className="fa-solid fa-chevron-down"></i>}
          <span>Runners</span>
        </h2>
        {!isCollapsed && (
          <div className="summary-controls">
            <span className="summary-count">
              Showing {showAll ? totalAthletes : `${(currentPage - 1) * itemsPerPage + 1}-${Math.min(currentPage * itemsPerPage, totalAthletes)}`} of {totalAthletes} athlete{totalAthletes !== 1 ? 's' : ''}
            </span>
            <div className="per-page-selector">
              <label htmlFor="itemsPerPage">Per page:</label>
              <select
                id="itemsPerPage"
                value={itemsPerPage}
                onChange={(e) => handleItemsPerPageChange(Number(e.target.value))}
              >
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={-1}>All</option>
              </select>
            </div>
          </div>
        )}
      </div>

      {!isCollapsed && (
        <>
          <div className="summary-table-container">
            <table className="summary-table">
              <thead>
                <tr>
                  <th>Athlete</th>
                  <th>Races</th>
                  <th>Total Distance</th>
                  <th>Total Time</th>
                  <th>Avg Pace</th>
                </tr>
              </thead>
              <tbody>
                {paginatedData.map((stat) => {
                  const isSelected = selectedAthletes.includes(stat.athleteName);
                  return (
                    <tr key={stat.athleteName} className={isSelected ? 'selected-athlete' : ''}>
                      <td>
                        <div className="athlete-cell">
                          {stat.profilePhoto && (
                            <img
                              src={stat.profilePhoto}
                              alt={stat.athleteName}
                              className="athlete-avatar-small"
                            />
                          )}
                          <span
                            className="athlete-name-clickable"
                            onClick={() => handleAthleteClick(stat.athleteName)}
                            title={isSelected ? 'Click to remove from filter' : 'Click to add to filter'}
                          >
                            {stat.athleteName}
                          </span>
                        </div>
                      </td>
                      <td>{stat.activityCount}</td>
                      <td>{formatDistance(stat.totalDistance)} km</td>
                      <td>{formatTime(stat.totalTime)}</td>
                      <td>{formatPace(stat.averagePace)} /km</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {!showAll && totalPages > 1 && (
            <div className="summary-pagination">
              <button
                className="pagination-button"
                onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                disabled={currentPage === 1}
              >
                Previous
              </button>
              <span className="pagination-info">
                Page {currentPage} of {totalPages}
              </span>
              <button
                className="pagination-button"
                onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                disabled={currentPage === totalPages}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
