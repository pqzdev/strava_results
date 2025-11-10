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
  const [loading, setLoading] = useState(true);

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
    } finally {
      setLoading(false);
    }
  };

  const handleConnectStrava = () => {
    window.location.href = '/auth/authorize';
  };

  return (
    <div className="home">
      <div className="container">
        <div className="hero">
          <h1 className="hero-title">
            Track Your Running Club's
            <br />
            <span className="gradient-text">Race Results</span>
          </h1>
          <p className="hero-subtitle">
            Automatically sync race activities from Strava and view club-wide results in one place
          </p>

          <div className="hero-buttons">
            <button className="button button-primary" onClick={handleConnectStrava}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                <path d="M7.5 2L2 11h5.5l2-6 2 6H17l-5.5-9z"/>
              </svg>
              Connect with Strava
            </button>
            <Link to="/dashboard" className="button button-secondary">
              View Dashboard
            </Link>
          </div>
        </div>

        {!loading && stats && (
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-value">{stats.athletes}</div>
              <div className="stat-label">Connected Athletes</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{stats.total_races}</div>
              <div className="stat-label">Total Races</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{stats.total_distance_km.toLocaleString()}</div>
              <div className="stat-label">Total Distance (km)</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{stats.races_last_30_days}</div>
              <div className="stat-label">Races This Month</div>
            </div>
          </div>
        )}

        <div className="features">
          <h2 className="features-title">How It Works</h2>
          <div className="features-grid">
            <div className="feature">
              <div className="feature-icon">🔗</div>
              <h3 className="feature-title">Connect Your Strava</h3>
              <p className="feature-text">
                Securely link your Strava account with one click. We only access activities you've marked as races.
              </p>
            </div>
            <div className="feature">
              <div className="feature-icon">🔄</div>
              <h3 className="feature-title">Automatic Sync</h3>
              <p className="feature-text">
                Race results sync automatically every day. Just mark your activity as a "Race" in Strava.
              </p>
            </div>
            <div className="feature">
              <div className="feature-icon">📊</div>
              <h3 className="feature-title">View Club Results</h3>
              <p className="feature-text">
                See all club members' race results in one dashboard. Filter by date, distance, or athlete.
              </p>
            </div>
          </div>
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
