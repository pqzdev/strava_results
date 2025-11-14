import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import './Home.css';

interface Stats {
  athletes: number;
  total_races: number;
  total_distance_km: number;
  races_last_30_days: number;
  last_sync: {
    timestamp: number;
    new_races: number;
  } | null;
}

export default function Home() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      const response = await fetch('/api/stats');
      const data = await response.json();
      setStats(data);
    } catch (error) {
      console.error('Failed to fetch stats:', error);
    }
  };

  const handleConnectStrava = () => {
    window.location.href = 'https://strava-club-workers.pedroqueiroz.workers.dev/auth/authorize';
  };

  return (
    <div className="home">
      <div className="container">
        <div className="hero">
          <h1 className="hero-title">
            Track Woodstock Runners'
            <br />
            <span className="gradient-text">Race Results</span>
          </h1>
          <p className="hero-subtitle">
            Upload Strava activities for your races and view club-wide results in one place
          </p>

          <div className="hero-buttons">
            <button
              onClick={handleConnectStrava}
              className="button button-primary button-large"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style={{ marginRight: '0.5rem' }}>
                <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169"/>
              </svg>
              Connect with Strava
            </button>
          </div>

          <div className="hero-buttons hero-buttons-secondary">
            <Link to="/dashboard" className="button button-secondary">
              View Races
            </Link>
            <Link to="/parkrun" className="button button-secondary">
              View Parkrun
            </Link>
          </div>

          <div className="hero-buttons" style={{ marginTop: '1rem' }}>
            <Link to="/submit-activities" className="button button-tertiary">
              Manually upload Strava activities
            </Link>
          </div>
        </div>

        <div className="stats-grid">
          {stats ? (
            <>
              <div className="stat-card">
                <div className="stat-value">{stats.athletes}</div>
                <div className="stat-label">Connected Athletes</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{stats.total_races}</div>
                <div className="stat-label">Total Races</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{(stats.total_distance_km ?? 0).toLocaleString()}</div>
                <div className="stat-label">Total Distance (km)</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{stats.races_last_30_days}</div>
                <div className="stat-label">Races This Month</div>
              </div>
            </>
          ) : (
            <>
              <div className="stat-card stat-card-loading">
                <div className="stat-value">-</div>
                <div className="stat-label">Connected Athletes</div>
              </div>
              <div className="stat-card stat-card-loading">
                <div className="stat-value">-</div>
                <div className="stat-label">Total Races</div>
              </div>
              <div className="stat-card stat-card-loading">
                <div className="stat-value">-</div>
                <div className="stat-label">Total Distance (km)</div>
              </div>
              <div className="stat-card stat-card-loading">
                <div className="stat-value">-</div>
                <div className="stat-label">Races This Month</div>
              </div>
            </>
          )}
        </div>

        {stats?.last_sync && (
          <div className="sync-status">
            <p>
              Last sync: {new Date(stats.last_sync.timestamp * 1000).toLocaleString()}
              {stats.last_sync.new_races > 0 && ` • ${stats.last_sync.new_races} new races added`}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
