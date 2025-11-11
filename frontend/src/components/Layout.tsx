import { Outlet, Link, useLocation } from 'react-router-dom';
import { useState, useEffect } from 'react';
import './Layout.css';

export default function Layout() {
  const location = useLocation();
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    // Check if current user is an admin
    const checkAdmin = async () => {
      const athleteId = localStorage.getItem('strava_athlete_id');
      if (!athleteId) return;

      try {
        const response = await fetch(
          `/api/admin/athletes?admin_strava_id=${athleteId}`
        );
        setIsAdmin(response.ok);
      } catch {
        setIsAdmin(false);
      }
    };

    checkAdmin();
  }, []);

  return (
    <div className="layout">
      <header className="header">
        <div className="container">
          <div className="header-content">
            <Link to="/" className="logo">
              <span className="logo-icon">🏃</span>
              <span className="logo-text">Woodstock Runners results</span>
            </Link>
            <nav className="nav">
              <Link
                to="/"
                className={`nav-link ${location.pathname === '/' ? 'active' : ''}`}
              >
                Home
              </Link>
              <Link
                to="/dashboard"
                className={`nav-link ${location.pathname === '/dashboard' || location.pathname === '/races' ? 'active' : ''}`}
              >
                Races
              </Link>
              <Link
                to="/parkrun"
                className={`nav-link ${location.pathname === '/parkrun' ? 'active' : ''}`}
              >
                Parkrun
              </Link>
              {isAdmin && (
                <Link
                  to="/admin"
                  className={`nav-link ${location.pathname === '/admin' ? 'active' : ''}`}
                >
                  Admin
                </Link>
              )}
            </nav>
          </div>
        </div>
      </header>

      <main className="main">
        <Outlet />
      </main>

      <footer className="footer">
        <div className="container">
          <p>
            Powered by <a href="https://www.strava.com" target="_blank" rel="noopener noreferrer">Strava API</a>
            {' • '}
            <a href="https://github.com" target="_blank" rel="noopener noreferrer">Open Source</a>
          </p>
        </div>
      </footer>
    </div>
  );
}
