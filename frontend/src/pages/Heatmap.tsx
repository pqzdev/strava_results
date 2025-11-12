import { useState, useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import polyline from '@mapbox/polyline';
import './Heatmap.css';

interface Race {
  id: number;
  strava_activity_id: number;
  name: string;
  distance: number;
  polyline?: string;
  date: string;
  firstname: string;
  lastname: string;
}

// Sydney bounding box
const SYDNEY_BOUNDS = {
  minLat: -34.2,
  maxLat: -33.5,
  minLng: 150.5,
  maxLng: 151.35,
};

// Check if a coordinate is within Sydney bounds
function isInSydney(lat: number, lng: number): boolean {
  return (
    lat >= SYDNEY_BOUNDS.minLat &&
    lat <= SYDNEY_BOUNDS.maxLat &&
    lng >= SYDNEY_BOUNDS.minLng &&
    lng <= SYDNEY_BOUNDS.maxLng
  );
}

// Check if a polyline has any points within Sydney bounds
function hasPointsInSydney(encodedPolyline: string): boolean {
  try {
    const coordinates = polyline.decode(encodedPolyline);
    return coordinates.some(([lat, lng]) => isInSydney(lat, lng));
  } catch (error) {
    console.error('Error decoding polyline:', error);
    return false;
  }
}

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

      // Check for specific activity 16247558055
      const targetActivity = races.find(r => r.strava_activity_id === 16247558055);
      if (targetActivity) {
        console.log('Found Bondi to Manly activity:', targetActivity);
        console.log('Has polyline:', !!targetActivity.polyline);
        if (targetActivity.polyline) {
          console.log('Polyline length:', targetActivity.polyline.length);
          console.log('Has points in Sydney:', hasPointsInSydney(targetActivity.polyline));
          try {
            const coords = polyline.decode(targetActivity.polyline);
            console.log('Decoded coordinates count:', coords.length);
            console.log('First coord:', coords[0]);
            console.log('Last coord:', coords[coords.length - 1]);
          } catch (e) {
            console.error('Error decoding target polyline:', e);
          }
        }
      } else {
        console.warn('Activity 16247558055 not found in fetched races');
      }

      // Filter races with polylines that have points in Sydney
      const racesWithPolylines = races.filter(
        (race) => race.polyline && hasPointsInSydney(race.polyline)
      );
      console.log(`${racesWithPolylines.length} races have polylines in Sydney`);

      const racesInSydney = racesWithPolylines.length;

      setStats({
        total: races.length,
        withPolylines: racesWithPolylines.length,
        inSydney: racesInSydney,
      });

      // Initialize map if not already done
      if (!mapRef.current && mapContainerRef.current) {
        // Center on Sydney
        const map = L.map(mapContainerRef.current).setView(
          [-33.8688, 151.2093],
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

      // Draw polylines with semi-transparent blue color
      // Overlapping lines will appear brighter (closer to white)
      if (mapRef.current && racesWithPolylines.length > 0) {
        for (const race of racesWithPolylines) {
          if (!race.polyline) continue;

          try {
            const coordinates = polyline.decode(race.polyline);
            const latLngs: [number, number][] = coordinates.map(([lat, lng]) => [
              lat,
              lng,
            ]);

            L.polyline(latLngs, {
              color: '#0055ff',
              weight: 2.5,
              opacity: 0.3,
              smoothFactor: 0.5,
              lineCap: 'round',
              lineJoin: 'round',
            }).addTo(mapRef.current);
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
                <strong>{stats.inSydney}</strong> in Sydney area
              </p>
            </>
          )}
        </div>
      </div>
      <div ref={mapContainerRef} className="heatmap-map"></div>
    </div>
  );
}
