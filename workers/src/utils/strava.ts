// Strava API utility functions

import { Env, StravaTokenResponse, StravaActivity, RateLimitInfo, Athlete } from '../types';

const STRAVA_API_BASE = 'https://www.strava.com/api/v3';
const STRAVA_AUTH_BASE = 'https://www.strava.com/oauth';

/**
 * Exchange authorization code for access token
 */
export async function exchangeCodeForToken(
  code: string,
  env: Env
): Promise<StravaTokenResponse> {
  const response = await fetch(`${STRAVA_AUTH_BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: env.STRAVA_CLIENT_ID,
      client_secret: env.STRAVA_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
    }),
  });

  if (!response.ok) {
    throw new Error(`Strava token exchange failed: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Refresh an expired access token
 */
export async function refreshAccessToken(
  refreshToken: string,
  env: Env
): Promise<StravaTokenResponse> {
  const response = await fetch(`${STRAVA_AUTH_BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: env.STRAVA_CLIENT_ID,
      client_secret: env.STRAVA_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    throw new Error(`Token refresh failed: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Check if a token is expired or expiring soon (within 5 minutes)
 */
export function isTokenExpired(tokenExpiry: number): boolean {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const bufferSeconds = 300; // 5 minutes
  return tokenExpiry <= nowSeconds + bufferSeconds;
}

/**
 * Ensure athlete has a valid access token, refreshing if necessary
 */
export async function ensureValidToken(
  athlete: Athlete,
  env: Env
): Promise<string> {
  if (!isTokenExpired(athlete.token_expiry)) {
    return athlete.access_token;
  }

  console.log(`Refreshing token for athlete ${athlete.strava_id}`);
  const tokenData = await refreshAccessToken(athlete.refresh_token, env);

  // Update athlete's tokens in database
  await env.DB.prepare(
    `UPDATE athletes
     SET access_token = ?, refresh_token = ?, token_expiry = ?, updated_at = ?
     WHERE strava_id = ?`
  )
    .bind(
      tokenData.access_token,
      tokenData.refresh_token,
      tokenData.expires_at,
      Math.floor(Date.now() / 1000),
      athlete.strava_id
    )
    .run();

  return tokenData.access_token;
}

/**
 * Fetch activities for an athlete from Strava API
 * @param after - Unix timestamp to fetch activities after
 * @param perPage - Number of activities per page (max 200)
 */
export async function fetchAthleteActivities(
  accessToken: string,
  after?: number,
  perPage: number = 200
): Promise<{ activities: StravaActivity[]; rateLimits: RateLimitInfo }> {
  const allActivities: StravaActivity[] = [];
  let page = 1;
  let rateLimits: RateLimitInfo = {
    limit_15min: 100,
    usage_15min: 0,
    limit_daily: 1000,
    usage_daily: 0,
  };

  // Fetch all pages of activities
  while (true) {
    const url = new URL(`${STRAVA_API_BASE}/athlete/activities`);
    url.searchParams.set('per_page', perPage.toString());
    url.searchParams.set('page', page.toString());
    if (after) {
      url.searchParams.set('after', after.toString());
    }

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch activities: ${response.statusText}`);
    }

    // Parse rate limit headers
    rateLimits = {
      limit_15min: parseInt(response.headers.get('X-RateLimit-Limit')?.split(',')[0] || '100'),
      usage_15min: parseInt(response.headers.get('X-RateLimit-Usage')?.split(',')[0] || '0'),
      limit_daily: parseInt(response.headers.get('X-RateLimit-Limit')?.split(',')[1] || '1000'),
      usage_daily: parseInt(response.headers.get('X-RateLimit-Usage')?.split(',')[1] || '0'),
    };

    const activities: StravaActivity[] = await response.json();

    // If no activities returned, we've reached the end
    if (activities.length === 0) {
      break;
    }

    allActivities.push(...activities);

    // If we got fewer than perPage activities, this is the last page
    if (activities.length < perPage) {
      break;
    }

    page++;
  }

  return { activities: allActivities, rateLimits };
}

/**
 * Filter activities to only include races
 * Detects races by:
 * 1. workout_type === 1 (explicitly marked as race in Strava)
 * 2. Name contains race-related keywords (fallback detection)
 */
export function filterRaceActivities(activities: StravaActivity[]): StravaActivity[] {
  // Common race keywords to detect in activity names (fallback if not tagged)
  const raceKeywords = [
    'race', 'parkrun', 'marathon', 'half marathon', '10k', '5k',
    '10km', '5km', 'ultra', 'trail race', 'fun run', 'charity run',
    'xc', 'cross country', 'track meet', '800m', '1500m', '3000m', '5000m', '10000m'
  ];

  return activities.filter((activity) => {
    // Must be a running activity
    if (activity.type !== 'Run') {
      return false;
    }

    // Check if explicitly marked as race (primary detection)
    if (activity.workout_type === 1) {
      return true;
    }

    // Fallback: Check if activity name contains race keywords
    const nameLower = activity.name.toLowerCase();
    return raceKeywords.some(keyword => nameLower.includes(keyword));
  });
}

/**
 * Check if athlete is a member of a specific Strava club
 */
export async function isClubMember(
  accessToken: string,
  clubId: string
): Promise<boolean> {
  try {
    const url = `${STRAVA_API_BASE}/athletes/${clubId}/clubs`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      console.error(`Failed to fetch clubs: ${response.statusText}`);
      return false;
    }

    const clubs = await response.json();

    // Check if the athlete is a member of the specified club
    return Array.isArray(clubs) && clubs.some((club: any) => club.id.toString() === clubId);
  } catch (error) {
    console.error('Error checking club membership:', error);
    return false;
  }
}

/**
 * Get athlete's clubs (with pagination support)
 */
export async function getAthleteClubs(accessToken: string): Promise<any[]> {
  try {
    const allClubs: any[] = [];
    let page = 1;
    const perPage = 200; // Maximum allowed by Strava

    // Fetch all pages of clubs
    while (true) {
      const url = new URL(`${STRAVA_API_BASE}/athlete/clubs`);
      url.searchParams.set('per_page', perPage.toString());
      url.searchParams.set('page', page.toString());

      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        console.error(`Failed to fetch clubs: ${response.statusText}`);
        return allClubs; // Return what we have so far
      }

      const clubs = await response.json();

      // If no clubs returned, we've reached the end
      if (!Array.isArray(clubs) || clubs.length === 0) {
        break;
      }

      allClubs.push(...clubs);

      // If we got fewer than perPage clubs, this is the last page
      if (clubs.length < perPage) {
        break;
      }

      page++;
    }

    console.log(`Fetched ${allClubs.length} total clubs across ${page} page(s)`);
    return allClubs;
  } catch (error) {
    console.error('Error fetching athlete clubs:', error);
    return [];
  }
}

/**
 * Build Strava OAuth authorization URL
 */
export function buildAuthorizationUrl(env: Env): string {
  const url = new URL(`${STRAVA_AUTH_BASE}/authorize`);
  url.searchParams.set('client_id', env.STRAVA_CLIENT_ID);
  url.searchParams.set('redirect_uri', env.STRAVA_REDIRECT_URI);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'read,activity:read_all');
  return url.toString();
}
