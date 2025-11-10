// TypeScript type definitions for the application

export interface Env {
  DB: D1Database;
  STRAVA_CLIENT_ID: string;
  STRAVA_CLIENT_SECRET: string;
  STRAVA_REDIRECT_URI: string;
  STRAVA_CLUB_ID: string;
}

export interface Athlete {
  id: number;
  strava_id: number;
  firstname: string;
  lastname: string;
  profile_photo?: string;
  access_token: string;
  refresh_token: string;
  token_expiry: number;
  created_at: number;
  updated_at: number;
  last_synced_at?: number;
}

export interface Race {
  id: number;
  athlete_id: number;
  strava_activity_id: number;
  name: string;
  distance: number;
  elapsed_time: number;
  moving_time: number;
  manual_time?: number;
  manual_distance?: number;
  date: string;
  elevation_gain?: number;
  average_heartrate?: number;
  max_heartrate?: number;
  created_at: number;
  // Additional fields for API responses
  athlete_name?: string;
  athlete_strava_id?: number;
}

export interface StravaTokenResponse {
  token_type: string;
  expires_at: number;
  expires_in: number;
  refresh_token: string;
  access_token: string;
  athlete: StravaAthlete;
}

export interface StravaAthlete {
  id: number;
  firstname: string;
  lastname: string;
  profile: string;
  profile_medium?: string;
}

export interface StravaActivity {
  id: number;
  name: string;
  distance: number;
  moving_time: number;
  elapsed_time: number;
  type: string;
  workout_type?: number; // 1 = Race
  start_date: string;
  start_date_local: string;
  timezone: string;
  total_elevation_gain: number;
  average_heartrate?: number;
  max_heartrate?: number;
}

export interface RateLimitInfo {
  limit_15min: number;
  usage_15min: number;
  limit_daily: number;
  usage_daily: number;
}
