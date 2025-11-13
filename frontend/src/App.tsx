import { Suspense, lazy } from 'react';
import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import './App.css';

// Lazy load page components for code splitting
const Home = lazy(() => import('./pages/Home'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Parkrun = lazy(() => import('./pages/Parkrun'));
const Admin = lazy(() => import('./pages/Admin'));
const SyncMonitor = lazy(() => import('./pages/SyncMonitor'));
// const Heatmap = lazy(() => import('./pages/Heatmap')); // Temporarily disabled - requires Strava API
const SubmitActivities = lazy(() => import('./pages/SubmitActivities'));
const SubmitActivitiesReview = lazy(() => import('./pages/SubmitActivitiesReview'));

function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route
          index
          element={
            <Suspense fallback={<div className="loading"><div className="spinner"></div><p>Loading...</p></div>}>
              <Home />
            </Suspense>
          }
        />
        <Route
          path="races"
          element={
            <Suspense fallback={<div className="loading"><div className="spinner"></div><p>Loading...</p></div>}>
              <Dashboard />
            </Suspense>
          }
        />
        <Route
          path="parkrun"
          element={
            <Suspense fallback={<div className="loading"><div className="spinner"></div><p>Loading...</p></div>}>
              <Parkrun />
            </Suspense>
          }
        />
        <Route
          path="admin"
          element={
            <Suspense fallback={<div className="loading"><div className="spinner"></div><p>Loading...</p></div>}>
              <Admin />
            </Suspense>
          }
        />
        <Route
          path="sync-monitor"
          element={
            <Suspense fallback={<div className="loading"><div className="spinner"></div><p>Loading...</p></div>}>
              <SyncMonitor />
            </Suspense>
          }
        />
        {/* Heatmap temporarily disabled - requires Strava API */}
        {/* <Route
          path="heatmap"
          element={
            <Suspense fallback={<div className="loading"><div className="spinner"></div><p>Loading...</p></div>}>
              <Heatmap />
            </Suspense>
          }
        /> */}
        <Route
          path="submit-activities"
          element={
            <Suspense fallback={<div className="loading"><div className="spinner"></div><p>Loading...</p></div>}>
              <SubmitActivities />
            </Suspense>
          }
        />
        <Route
          path="submit-activities/review"
          element={
            <Suspense fallback={<div className="loading"><div className="spinner"></div><p>Loading...</p></div>}>
              <SubmitActivitiesReview />
            </Suspense>
          }
        />
        {/* Legacy route for backwards compatibility */}
        <Route
          path="dashboard"
          element={
            <Suspense fallback={<div className="loading"><div className="spinner"></div><p>Loading...</p></div>}>
              <Dashboard />
            </Suspense>
          }
        />
      </Route>
    </Routes>
  );
}

export default App;
