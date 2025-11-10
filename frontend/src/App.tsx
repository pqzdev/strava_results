import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Home from './pages/Home';
import Dashboard from './pages/Dashboard';
import Parkrun from './pages/Parkrun';
import Admin from './pages/Admin';
import './App.css';

function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="races" element={<Dashboard />} />
        <Route path="parkrun" element={<Parkrun />} />
        <Route path="admin" element={<Admin />} />
        {/* Legacy route for backwards compatibility */}
        <Route path="dashboard" element={<Dashboard />} />
      </Route>
    </Routes>
  );
}

export default App;
