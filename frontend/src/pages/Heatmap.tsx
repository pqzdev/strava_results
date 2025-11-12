import { useState, useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import polyline from '@mapbox/polyline';
import './Heatmap.css';

interface Race {
  id: number;
  strava_activity_id: number;
  name: string;
  event_name?: string;
  distance: number;
  polyline?: string;
  date: string;
  firstname: string;
  lastname: string;
}

// Sydney coordinates for initial map center
const SYDNEY_CENTER = {
  lat: -33.8688,
  lng: 151.2093,
};

export default function Heatmap() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState({ total: 0, withPolylines: 0, inSydney: 0 });
  const mapRef = useRef<L.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchAndRenderHeatmap();
  }, []);

  async function fetchAndRenderHeatmap() {
    try {
      setLoading(true);
      setError(null);

      // Fetch all races with a high limit to get as much data as possible
      const response = await fetch('/api/races?limit=10000');

      if (!response.ok) {
        throw new Error('Failed to fetch races');
      }

      const data = await response.json();
      const races: Race[] = data.races;

      console.log(`Fetched ${races.length} races`);

      // Filter races with polylines (all locations)
      const racesWithPolylines = races.filter((race) => race.polyline);
      console.log(`${racesWithPolylines.length} races have polylines`);

      // Log sample of races with polylines to see geographic distribution
      if (racesWithPolylines.length > 0) {
        console.log('Sample races with polylines:', racesWithPolylines.slice(0, 10).map(r => ({
          name: r.name,
          date: r.date,
          athlete: `${r.firstname} ${r.lastname}`
        })));
      }

      // Log races without polylines
      const racesWithoutPolylines = races.filter((race) => !race.polyline);
      console.log(`${racesWithoutPolylines.length} races missing polylines`);
      if (racesWithoutPolylines.length > 0) {
        console.log('Sample races without polylines:', racesWithoutPolylines.slice(0, 5).map(r => ({
          name: r.name,
          date: r.date,
          athlete: `${r.firstname} ${r.lastname}`
        })));
      }

      setStats({
        total: races.length,
        withPolylines: racesWithPolylines.length,
        inSydney: racesWithPolylines.length, // All races are shown
      });

      // Initialize map if not already done
      if (!mapRef.current && mapContainerRef.current) {
        // Center on Sydney initially
        const map = L.map(mapContainerRef.current).setView(
          [SYDNEY_CENTER.lat, SYDNEY_CENTER.lng],
          12
        );

        // Add CartoDB Positron tiles (light background for better line visibility)
        L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
          maxZoom: 19,
          subdomains: 'abcd',
        }).addTo(map);

        mapRef.current = map;
      }

      // Draw all polylines with semi-transparent blue color
      // Overlapping lines will appear brighter (closer to white)
      // Map starts centered on Sydney but shows all races worldwide
      if (mapRef.current && racesWithPolylines.length > 0) {
        for (const race of racesWithPolylines) {
          if (!race.polyline) continue;

          try {
            const coordinates = polyline.decode(race.polyline);
            const latLngs: [number, number][] = coordinates.map(([lat, lng]) => [
              lat,
              lng,
            ]);

            const line = L.polyline(latLngs, {
              color: '#0055ff',
              weight: 2.5,
              opacity: 0.3,
              smoothFactor: 0.5,
              lineCap: 'round',
              lineJoin: 'round',
            }).addTo(mapRef.current);

            // Add tooltip with event name that appears on hover
            // Show custom event name if set, otherwise fall back to activity name
            line.bindTooltip(race.event_name || race.name, {
              sticky: true, // Tooltip follows the mouse cursor
              opacity: 0.9,
              className: 'polyline-tooltip'
            });

            // Highlight polyline on hover
            line.on('mouseover', function(this: L.Polyline) {
              this.setStyle({
                weight: 4,
                opacity: 0.8,
              });
            });

            line.on('mouseout', function(this: L.Polyline) {
              this.setStyle({
                weight: 2.5,
                opacity: 0.3,
              });
            });
          } catch (error) {
            console.error('Error drawing polyline:', error);
          }
        }
      }

      setLoading(false);
    } catch (err) {
      console.error('Error rendering heatmap:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      setLoading(false);
    }
  }

  return (
    <div className="heatmap-container">
      <div className="heatmap-header">
        <h1>Sydney Racing Heatmap</h1>
        <div className="heatmap-stats">
          {loading ? (
            <p>Loading activities...</p>
          ) : error ? (
            <p className="error">Error: {error}</p>
          ) : (
            <>
              <p>
                <strong>{stats.total}</strong> total races
              </p>
              <p>
                <strong>{stats.withPolylines}</strong> with route data
              </p>
              <p>
                <strong>{stats.inSydney}</strong> displayed on map
              </p>
            </>
          )}
        </div>
      </div>
      <div ref={mapContainerRef} className="heatmap-map"></div>
    </div>
  );
}
