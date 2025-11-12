-- Migration: Add polyline column to races table
-- This stores the encoded polyline from Strava's map.summary_polyline for heatmap visualization

ALTER TABLE races ADD COLUMN polyline TEXT; -- Encoded polyline string, NULL if not available
