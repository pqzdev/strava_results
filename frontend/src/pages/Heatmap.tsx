import { useState, useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.heat';
import polyline from '@mapbox/polyline';
import './Heatmap.css';

// Extend Leaflet type to include heatLayer
declare module 'leaflet' {
  function heatLayer(
    latlngs: [number, number, number][],
    options?: any
  ): L.Layer;
}

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

// Convert polyline to dense point array for better heatmap rendering
function polylineToDensePoints(
  encodedPolyline: string,
  pointsPerSegment: number = 5
): [number, number, number][] {
  try {
    const coordinates = polyline.decode(encodedPolyline);
    const densePoints: [number, number, number][] = [];

    // Add points along each segment
    for (let i = 0; i < coordinates.length - 1; i++) {
      const [lat1, lng1] = coordinates[i];
      const [lat2, lng2] = coordinates[i + 1];

      // Only include points within Sydney bounds
      for (let j = 0; j <= pointsPerSegment; j++) {
        const t = j / pointsPerSegment;
        const lat = lat1 + (lat2 - lat1) * t;
        const lng = lng1 + (lng2 - lng1) * t;

        if (isInSydney(lat, lng)) {
          densePoints.push([lat, lng, 1]); // [lat, lng, intensity]
        }
      }
    }

    return densePoints;
  } catch (error) {
    console.error('Error decoding polyline:', error);
    return [];
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

      // Filter races with polylines
      const racesWithPolylines = races.filter((race) => race.polyline);
      console.log(`${racesWithPolylines.length} races have polylines`);

      // Process polylines and collect points
      const allPoints: [number, number, number][] = [];
      let racesInSydney = 0;

      for (const race of racesWithPolylines) {
        if (!race.polyline) continue;

        const points = polylineToDensePoints(race.polyline);
        if (points.length > 0) {
          allPoints.push(...points);
          racesInSydney++;
        }
      }

      console.log(
        `Collected ${allPoints.length} points from ${racesInSydney} races in Sydney`
      );

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

        // Add OpenStreetMap tiles
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
          maxZoom: 18,
        }).addTo(map);

        mapRef.current = map;
      }

      // Add heatmap layer
      if (mapRef.current && allPoints.length > 0) {
        const heatLayer = L.heatLayer(allPoints, {
          radius: 15,
          blur: 20,
          maxZoom: 17,
          max: 1.0,
          gradient: {
            0.0: 'blue',
            0.5: 'lime',
            0.7: 'yellow',
            0.9: 'orange',
            1.0: 'red',
          },
        });

        heatLayer.addTo(mapRef.current);
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
        <h1>Sydney Running Heatmap</h1>
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
