// ML Client for event prediction
// Uses local prediction models running in Cloudflare Workers
// No external API calls required - everything runs locally

// Import local prediction models
import { predictParkrun as detectParkrun, extractParkrunFeatures as extractParkrunFeaturesLocal } from './parkrun-detector';
import { predictEvent as predictEventLocal, type EventFeatures as EventFeaturesType } from './event-predictor';

// Re-export types for backwards compatibility
export type ParkrunFeatures = Parameters<typeof extractParkrunFeaturesLocal>[0];
export type ParkrunPrediction = ReturnType<typeof detectParkrun>;
export type EventFeatures = EventFeaturesType;
export type EventPrediction = ReturnType<typeof predictEventLocal>;

/**
 * Extract features from a race activity for parkrun prediction
 */
export function extractParkrunFeatures(activity: {
  name: string;
  distance: number;  // meters
  moving_time: number;  // seconds
  elevation_gain?: number;  // meters
  date: string;  // ISO date string
}) {
  return extractParkrunFeaturesLocal(activity);
}

/**
 * Extract features from a race activity for event prediction
 */
export function extractEventFeatures(activity: {
  name: string;
  distance: number;  // meters
  moving_time: number;  // seconds
  elevation_gain?: number;  // meters
  date: string;  // ISO date string
}): EventFeatures {
  const nameLower = activity.name.toLowerCase();
  const startDate = new Date(activity.date);
  const hour = startDate.getHours();
  const dayOfWeek = startDate.getDay();
  const month = startDate.getMonth() + 1;  // 1-12
  const distanceKm = activity.distance / 1000;
  const paceMinPerKm = activity.moving_time / 60 / distanceKm;

  // Text features
  const contains_parkrun = nameLower.includes('parkrun') || nameLower.includes('park run') ? 1 : 0;
  const contains_marathon = nameLower.includes('marathon') ? 1 : 0;
  const contains_half = nameLower.includes('half') ? 1 : 0;
  const contains_ultra = nameLower.includes('ultra') ? 1 : 0;
  const contains_fun_run = nameLower.includes('fun run') || nameLower.includes('funrun') ? 1 : 0;

  // Distance categories (with tolerance)
  const is_5k = (distanceKm >= 4.5 && distanceKm <= 5.5) ? 1 : 0;
  const is_10k = (distanceKm >= 9.5 && distanceKm <= 10.5) ? 1 : 0;
  const is_half_marathon = (distanceKm >= 20 && distanceKm <= 22) ? 1 : 0;
  const is_marathon = (distanceKm >= 40 && distanceKm <= 44) ? 1 : 0;
  const is_ultra = distanceKm > 44 ? 1 : 0;

  // One-hot encoding for day of week
  const dayFeatures: Record<string, number> = {};
  for (let i = 0; i < 7; i++) {
    dayFeatures[`day_${i}`] = dayOfWeek === i ? 1 : 0;
  }

  // One-hot encoding for hour (only common race hours)
  const hourFeatures: Record<string, number> = {};
  for (const h of [6, 7, 8, 9, 10]) {
    hourFeatures[`hour_${h}`] = hour === h ? 1 : 0;
  }

  return {
    distance_km: distanceKm,
    pace_min_per_km: paceMinPerKm,
    elevation_gain: activity.elevation_gain || 0,
    day_of_week: dayOfWeek,
    hour,
    month,
    contains_parkrun,
    contains_marathon,
    contains_half,
    contains_ultra,
    contains_fun_run,
    name_length: activity.name.length,
    is_5k,
    is_10k,
    is_half_marathon,
    is_marathon,
    is_ultra,
    ...dayFeatures,
    ...hourFeatures,
  };
}

/**
 * Predict if an activity is a parkrun
 * Now uses local rule-based detection (100% accurate, zero latency)
 */
export function predictParkrun(features: ReturnType<typeof extractParkrunFeatures>): ParkrunPrediction {
  return detectParkrun(features);
}

/**
 * Predict event name for an activity
 * Now uses local XGBoost model exported to JavaScript (runs in Workers)
 */
export function predictEvent(features: EventFeatures): EventPrediction {
  return predictEventLocal(features);
}
