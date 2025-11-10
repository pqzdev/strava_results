import { Outlet, Link, useLocation } from 'react-router-dom';
import './Layout.css';

export default function Layout() {
  const location = useLocation();

  return (
    <div className="layout">
      <header className="header">
        <div className="container">
          <div className="header-content">
            <Link to="/" className="logo">
              <span className="logo-icon">🏃</span>
              <span className="logo-text">Club Race Results</span>
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
                className={`nav-link ${location.pathname === '/dashboard' ? 'active' : ''}`}
              >
                Dashboard
              </Link>
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
