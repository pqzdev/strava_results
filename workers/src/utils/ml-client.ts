// ML API Client for event prediction
// Calls the Railway-hosted ML inference API

const ML_API_URL = 'https://woodstock-results-production.up.railway.app';

export interface ParkrunFeatures {
  contains_parkrun: number;  // 0 or 1
  is_5k: number;  // 0 or 1
  hour_8: number;  // 0 or 1
  hour: number;  // 0-23
  distance_km: number;
  name_length: number;
  elevation_gain: number;
  day_5: number;  // Saturday = 1
  pace_min_per_km: number;
  day_of_week: number;  // 0-6
}

export interface ParkrunPrediction {
  is_parkrun: boolean;
  probability: number;
  model: string;
}

export interface EventFeatures {
  // Core features
  distance_km: number;
  pace_min_per_km: number;
  elevation_gain: number;

  // Time features
  day_of_week: number;
  hour: number;
  month: number;

  // Text features
  contains_parkrun: number;
  contains_marathon: number;
  contains_half: number;
  contains_ultra: number;
  contains_fun_run: number;
  name_length: number;

  // Distance categories
  is_5k: number;
  is_10k: number;
  is_half_marathon: number;
  is_marathon: number;
  is_ultra: number;

  // One-hot encoded features
  day_0?: number;
  day_1?: number;
  day_2?: number;
  day_3?: number;
  day_4?: number;
  day_5?: number;
  day_6?: number;
  hour_6?: number;
  hour_7?: number;
  hour_8?: number;
  hour_9?: number;
  hour_10?: number;
}

export interface EventPrediction {
  event_name: string;
  probability: number;
  top_3: Array<{
    event_name: string;
    probability: number;
  }>;
  model: string;
}

/**
 * Extract features from a race activity for parkrun prediction
 */
export function extractParkrunFeatures(activity: {
  name: string;
  distance: number;  // meters
  moving_time: number;  // seconds
  elevation_gain?: number;  // meters
  date: string;  // ISO date string
}): ParkrunFeatures {
  const nameLower = activity.name.toLowerCase();
  const startDate = new Date(activity.date);
  const hour = startDate.getHours();
  const dayOfWeek = startDate.getDay();
  const distanceKm = activity.distance / 1000;
  const paceMinPerKm = activity.moving_time / 60 / distanceKm;

  return {
    contains_parkrun: nameLower.includes('parkrun') || nameLower.includes('park run') ? 1 : 0,
    is_5k: (distanceKm >= 4.5 && distanceKm <= 5.5) ? 1 : 0,
    hour_8: hour === 8 ? 1 : 0,
    hour,
    distance_km: distanceKm,
    name_length: activity.name.length,
    elevation_gain: activity.elevation_gain || 0,
    day_5: dayOfWeek === 6 ? 1 : 0,  // Saturday
    pace_min_per_km: paceMinPerKm,
    day_of_week: dayOfWeek,
  };
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
 */
export async function predictParkrun(features: ParkrunFeatures): Promise<ParkrunPrediction> {
  const response = await fetch(`${ML_API_URL}/predict/parkrun`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(features),
  });

  if (!response.ok) {
    throw new Error(`ML API error: ${response.status} ${response.statusText}`);
  }

  return await response.json();
}

/**
 * Predict event name for an activity
 */
export async function predictEvent(features: EventFeatures): Promise<EventPrediction> {
  const response = await fetch(`${ML_API_URL}/predict/event`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(features),
  });

  if (!response.ok) {
    throw new Error(`ML API error: ${response.status} ${response.statusText}`);
  }

  return await response.json();
}
