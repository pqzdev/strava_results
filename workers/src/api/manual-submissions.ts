// API endpoints for manual Strava activity submissions

import { Env } from '../types';

interface ExtractedActivity {
  strava_activity_id: number;
  strava_url: string;
  athlete_name: string;
  athlete_strava_id: number | null;
  athlete_profile_photo: string | null;
  activity_name: string;
  activity_type: string;
  date: string;
  distance: number | null;
  time_seconds: number | null;
  elevation_gain: number | null;
}

interface SubmissionActivity extends ExtractedActivity {
  original_distance: number | null;
  original_time_seconds: number | null;
  original_elevation_gain: number | null;
  edited_distance: number | null;
  edited_time_seconds: number | null;
  edited_elevation_gain: number | null;
  event_name: string | null;
  notes: string | null;
}

/**
 * Extract Strava activity ID from URL or plain number
 * Handles various formats:
 * - Full URLs: https://www.strava.com/activities/16440077551
 * - URLs with params: https://www.strava.com/activities/16440077551?foo=bar
 * - URLs without protocol: strava.com/activities/16440077551
 * - Just the ID: 16440077551
 */
function extractActivityId(input: string): number | null {
  // Try to extract from URL first
  const urlMatch = input.match(/(?:strava\.com\/activities\/)?(\d+)/);
  if (urlMatch) {
    return parseInt(urlMatch[1]);
  }

  // Try to parse as plain number
  const trimmed = input.trim();
  if (/^\d+$/.test(trimmed)) {
    return parseInt(trimmed);
  }

  return null;
}

/**
 * Build canonical Strava URL from activity ID
 */
function buildStravaUrl(activityId: number): string {
  return `https://www.strava.com/activities/${activityId}`;
}

/**
 * Parse time string to seconds
 */
function parseTimeToSeconds(timeStr: string): number | null {
  // Handle formats: "1:23:45" (HH:MM:SS), "23:45" (MM:SS), "1h 23m 45s"

  // Try HH:MM:SS or MM:SS format
  const colonMatch = timeStr.match(/^(?:(\d+):)?(\d+):(\d+)$/);
  if (colonMatch) {
    const hours = colonMatch[1] ? parseInt(colonMatch[1]) : 0;
    const minutes = parseInt(colonMatch[2]);
    const seconds = parseInt(colonMatch[3]);
    return hours * 3600 + minutes * 60 + seconds;
  }

  // Try "1h 23m 45s" format
  const textMatch = timeStr.match(/(?:(\d+)h\s*)?(?:(\d+)m\s*)?(?:(\d+)s)?/);
  if (textMatch) {
    const hours = textMatch[1] ? parseInt(textMatch[1]) : 0;
    const minutes = textMatch[2] ? parseInt(textMatch[2]) : 0;
    const seconds = textMatch[3] ? parseInt(textMatch[3]) : 0;
    return hours * 3600 + minutes * 60 + seconds;
  }

  return null;
}

/**
 * Extract activity data from Strava page HTML
 */
async function extractActivityFromPage(input: string, env: Env): Promise<ExtractedActivity | { error: string }> {
  try {
    const activityId = extractActivityId(input);
    if (!activityId) {
      return { error: 'Invalid input - could not extract activity ID' };
    }

    // Check for duplicates in races table
    const existingRace = await env.DB.prepare(
      'SELECT id FROM races WHERE strava_activity_id = ?'
    )
      .bind(activityId)
      .first();

    if (existingRace) {
      return { error: `Activity ${activityId} already exists in database` };
    }

    // Check for duplicates in pending submissions
    const existingSubmission = await env.DB.prepare(
      'SELECT id FROM manual_submissions WHERE strava_activity_id = ? AND status = ?'
    )
      .bind(activityId, 'pending')
      .first();

    if (existingSubmission) {
      return { error: `Activity ${activityId} already has a pending submission` };
    }

    // Build canonical URL
    const canonicalUrl = buildStravaUrl(activityId);

    // Fetch the page
    const response = await fetch(canonicalUrl);
    if (!response.ok) {
      return { error: `HTTP ${response.status}: ${response.statusText}` };
    }

    const html = await response.text();

    // Check if this is a private activity
    // Private activities return a page without activity data, just the base Strava template
    if (html.includes('"noindex, nofollow"') && !html.includes('"distance":')) {
      return { error: 'This activity is private. Only public activities can be submitted.' };
    }

    // Parse HTML to extract activity details
    // Try multiple patterns for robustness

    // Extract athlete name - try various patterns
    let athleteName = 'Unknown Athlete';
    const athletePatterns = [
      /<h3[^>]*>([^<]+)<\/h3>/i,  // Simple h3 tag
      /<a[^>]*class="[^"]*minimal-athlete[^"]*"[^>]*>([^<]+)<\/a>/i,
      /<span[^>]*class="[^"]*athlete-name[^"]*"[^>]*>([^<]+)<\/span>/i,
      /Athlete:<\/strong>\s*([^<]+)/i,
      /"athlete_firstname":"([^"]+)","athlete_lastname":"([^"]+)"/i
    ];
    for (const pattern of athletePatterns) {
      const match = html.match(pattern);
      if (match) {
        athleteName = match[2] ? `${match[1]} ${match[2]}` : match[1].trim();
        break;
      }
    }

    // Extract athlete profile photo
    let athleteProfilePhoto: string | null = null;
    const photoPatterns = [
      /"profileImageUrl":"([^"]+)"/i,  // Primary pattern: profileImageUrl in JSON
      /"athlete_profile":"([^"]+)"/i,
      /<img[^>]*class="[^"]*avatar[^"]*"[^>]*src="([^"]+)"/i,
      /<img[^>]*src="([^"]*avatar[^"]+)"/i,
      /"avatar":"([^"]+)"/i,
      /https?:\/\/dgalywyr863hv\.cloudfront\.net\/pictures\/athletes\/\d+\/\d+\/\d+\/large\.jpg/i  // Direct CloudFront URL pattern
    ];
    for (const pattern of photoPatterns) {
      const match = html.match(pattern);
      if (match) {
        athleteProfilePhoto = match[1] || match[0];  // Use capture group if available, otherwise full match
        // Ensure we got a valid URL
        if (athleteProfilePhoto && athleteProfilePhoto.startsWith('http')) {
          // Transform large.jpg to medium.jpg to match API format
          athleteProfilePhoto = athleteProfilePhoto.replace('/large.jpg', '/medium.jpg');
          break;
        }
      }
    }

    // Extract athlete Strava ID
    let athleteStravaId: number | null = null;
    const athleteIdPatterns = [
      /"athlete":\{"id":"(\d+)"/i,  // Primary pattern: "athlete":{"id":"55442995"
      /"athlete":\{"id":(\d+)/i,    // Alternative without quotes: "athlete":{"id":55442995
      /"athleteId":(\d+)/i,
      /"athlete_id":(\d+)/i
    ];
    for (const pattern of athleteIdPatterns) {
      const match = html.match(pattern);
      if (match) {
        athleteStravaId = parseInt(match[1]);
        if (athleteStravaId && athleteStravaId > 0) {
          break;
        }
      }
    }

    // Extract activity title - try various patterns
    let activityName = 'Untitled Activity';
    const titlePatterns = [
      /<h1[^>]*>([^<]+)<\/h1>/i,  // Simple h1 tag
      /<h1[^>]*class="[^"]*activity-name[^"]*"[^>]*>([^<]+)<\/h1>/i,
      /<title>([^|]+)/i,
      /"name":"([^"]+)"/i
    ];
    for (const pattern of titlePatterns) {
      const match = html.match(pattern);
      if (match) {
        activityName = match[1].trim();
        if (activityName !== 'Untitled Activity' && activityName.length > 0) break;
      }
    }

    // Extract activity type
    let activityType = 'Run';
    const typePatterns = [
      /<span[^>]*class="[^"]*Summary_typeText[^"]*"[^>]*>([^<]+)<\/span>/i,  // Primary: Summary_typeText class
      /"type":"([^"]+)"/i,
      /Activity Type:<\/strong>\s*([^<]+)/i,
      /data-activity-type="([^"]+)"/i,
      /<span[^>]*class="[^"]*activity-type[^"]*"[^>]*>([^<]+)<\/span>/i
    ];
    for (const pattern of typePatterns) {
      const match = html.match(pattern);
      if (match) {
        activityType = match[1].trim();
        break;
      }
    }

    // Extract date
    let date = new Date().toISOString().split('T')[0];
    const datePatterns = [
      /<time[^>]*datetime="([^"]+)"/i,
      /data-date="([^"]+)"/i,
      /"start_date":"([^"]+)"/i,
      /"start_date_local":"([^"]+)"/i
    ];
    for (const pattern of datePatterns) {
      const match = html.match(pattern);
      if (match) {
        date = match[1].split('T')[0];
        break;
      }
    }

    // Extract distance (in km)
    let distance: number | null = null;
    const distancePatterns = [
      // Most specific patterns first - target the actual distance stat element
      /data-cy="summary-distance"[^>]*>.*?<div[^>]*class="[^"]*statValue[^"]*"[^>]*>([0-9.,]+)\s*km/is,  // New Strava UI with data-cy
      /Stat_statValue[^>]*>([0-9.,]+)\s*km/i,  // Stat value class
      /<div[^>]*class="[^"]*inline-stats[^"]*"[^>]*>.*?Distance[^<]*<[^>]*>([0-9.,]+)\s*km/is,
      /Distance:<\/strong>\s*([0-9.,]+)\s*km/i,
      /data-distance="([0-9.]+)"/i,
      /"distance":([0-9.]+)/i,
      /([0-9.,]+)\s*km/i  // Generic pattern as last resort
    ];
    for (const pattern of distancePatterns) {
      const match = html.match(pattern);
      if (match) {
        const value = parseFloat(match[1].replace(/,/g, ''));
        if (value > 0) {
          // If it's a very large number, it might be in meters
          distance = value > 1000 ? value / 1000 : value;
          break;
        }
      }
    }

    // Extract time
    let timeSeconds: number | null = null;
    const timePatterns = [
      /([0-9]+)h\s*([0-9]+)m\s*([0-9]+)s/i,  // Match "9h 37m 44s"
      /Time:<\/strong>\s*([0-9:hms\s]+)/i,
      /Moving Time:<\/strong>\s*([0-9:hms\s]+)/i,
      /Elapsed Time:<\/strong>\s*([0-9:hms\s]+)/i,
      /data-elapsed-time="([0-9]+)"/i,
      /"elapsed_time":([0-9]+)/i,
      /"moving_time":([0-9]+)/i
    ];
    for (const pattern of timePatterns) {
      const match = html.match(pattern);
      if (match) {
        if (match.length > 3 && match[1] && match[2] && match[3]) {
          // Format: 9h 37m 44s
          timeSeconds = parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseInt(match[3]);
        } else if (match[1].match(/^\d+$/)) {
          // Already in seconds
          timeSeconds = parseInt(match[1]);
        } else {
          // Try to parse time string
          timeSeconds = parseTimeToSeconds(match[1]);
        }
        if (timeSeconds && timeSeconds > 0) break;
      }
    }

    // Extract elevation gain (in meters)
    let elevationGain: number | null = null;
    const elevationPatterns = [
      // Primary: Target the Stat_statValue class after Stat_statLabel with "Elevation"
      /<span[^>]*class="[^"]*Stat_statLabel[^"]*"[^>]*>Elevation<\/span>[^<]*<div[^>]*class="[^"]*Stat_statValue[^"]*"[^>]*>([0-9,]+)\s*m/is,
      /Elevation<\/span>[^<]*<div[^>]*>([0-9,]+)\s*m/is,
      /Elevation:<\/div>[^<]*<div[^>]*>([0-9,]+)\s*m/i,
      /Elevation Gain:<\/strong>\s*([0-9,]+)\s*m/i,
      /data-elevation-gain="([0-9.]+)"/i,
      /"total_elevation_gain":([0-9.]+)/i
    ];
    for (const pattern of elevationPatterns) {
      const match = html.match(pattern);
      if (match) {
        const value = parseFloat(match[1].replace(/,/g, ''));
        if (value >= 0) {  // Allow 0 elevation
          elevationGain = value;
          break;
        }
      }
    }

    // Validate that we extracted meaningful data
    if (athleteName === 'Unknown Athlete' && activityName === 'Untitled Activity' && !distance && !timeSeconds) {
      return {
        error: 'Could not extract activity data. The activity may be private or have restricted visibility. Only public activities can be submitted.'
      };
    }

    return {
      strava_activity_id: activityId,
      strava_url: canonicalUrl,
      athlete_name: athleteName,
      athlete_strava_id: athleteStravaId,
      athlete_profile_photo: athleteProfilePhoto,
      activity_name: activityName,
      activity_type: activityType,
      date,
      distance,
      time_seconds: timeSeconds,
      elevation_gain: elevationGain
    };
  } catch (error) {
    console.error('Error extracting activity:', error);
    return { error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * POST /api/manual-submissions/extract
 * Extract activity data from Strava URLs
 */
export async function extractActivities(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json() as { urls: string[] };

    if (!body.urls || !Array.isArray(body.urls) || body.urls.length === 0) {
      return new Response(
        JSON.stringify({ error: 'URLs array is required' }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }

    const activities: ExtractedActivity[] = [];
    const errors: { url: string; error: string }[] = [];

    // Process each URL/ID
    for (const input of body.urls) {
      const result = await extractActivityFromPage(input, env);

      if ('error' in result) {
        errors.push({ url: input, error: result.error });
      } else {
        activities.push(result);
      }
    }

    return new Response(
      JSON.stringify({ activities, errors }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (error) {
    console.error('Error in extractActivities:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to extract activities' }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }
}

/**
 * POST /api/manual-submissions/submit
 * Submit activities for admin review
 */
export async function submitActivities(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json() as {
      session_id: string;
      activities: SubmissionActivity[];
    };

    if (!body.session_id || !body.activities || !Array.isArray(body.activities)) {
      return new Response(
        JSON.stringify({ error: 'session_id and activities array are required' }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }

    const submissionIds: number[] = [];
    const submittedAt = Math.floor(Date.now() / 1000);

    for (const activity of body.activities) {
      try {
        const result = await env.DB.prepare(
          `INSERT INTO manual_submissions (
            submission_session_id,
            strava_activity_id,
            strava_url,
            athlete_name,
            athlete_strava_id,
            athlete_profile_photo,
            activity_name,
            activity_type,
            date,
            original_distance,
            original_time_seconds,
            original_elevation_gain,
            edited_distance,
            edited_time_seconds,
            edited_elevation_gain,
            event_name,
            notes,
            status,
            submitted_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
          RETURNING id`
        )
          .bind(
            body.session_id,
            activity.strava_activity_id,
            activity.strava_url,
            activity.athlete_name,
            activity.athlete_strava_id || null,
            activity.athlete_profile_photo || null,
            activity.activity_name,
            activity.activity_type,
            activity.date,
            activity.original_distance,
            activity.original_time_seconds,
            activity.original_elevation_gain,
            activity.edited_distance,
            activity.edited_time_seconds,
            activity.edited_elevation_gain,
            activity.event_name,
            activity.notes,
            submittedAt
          )
          .first<{ id: number }>();

        if (result?.id) {
          submissionIds.push(result.id);
        }
      } catch (error) {
        console.error('Error inserting submission:', error);
        // Continue with other activities
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        submission_ids: submissionIds,
        count: submissionIds.length
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (error) {
    console.error('Error in submitActivities:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to submit activities' }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }
}

/**
 * GET /api/admin/manual-submissions
 * Get all manual submissions (admin only)
 */
export async function getManualSubmissions(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url);
    const adminStravaId = url.searchParams.get('admin_strava_id');
    const status = url.searchParams.get('status') || 'pending';

    // Verify admin
    if (!adminStravaId) {
      return new Response(
        JSON.stringify({ error: 'admin_strava_id is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const admin = await env.DB.prepare(
      'SELECT is_admin FROM athletes WHERE strava_id = ?'
    )
      .bind(parseInt(adminStravaId))
      .first<{ is_admin: number }>();

    if (!admin || admin.is_admin !== 1) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Get submissions
    const query = status === 'all'
      ? 'SELECT * FROM manual_submissions ORDER BY submitted_at DESC'
      : 'SELECT * FROM manual_submissions WHERE status = ? ORDER BY submitted_at DESC';

    const result = status === 'all'
      ? await env.DB.prepare(query).all()
      : await env.DB.prepare(query).bind(status).all();

    const submissions = result.results.map((sub: any) => ({
      ...sub,
      has_edits: sub.edited_distance !== null || sub.edited_time_seconds !== null || sub.edited_elevation_gain !== null
    }));

    return new Response(
      JSON.stringify({
        submissions,
        total: submissions.length
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (error) {
    console.error('Error in getManualSubmissions:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to get submissions' }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }
}

/**
 * POST /api/admin/manual-submissions/:id/approve
 * Approve a manual submission and create race entry
 */
export async function approveSubmission(request: Request, env: Env, submissionId: number): Promise<Response> {
  try {
    const body = await request.json() as { admin_strava_id: number };

    // Verify admin
    const admin = await env.DB.prepare(
      'SELECT is_admin FROM athletes WHERE strava_id = ?'
    )
      .bind(body.admin_strava_id)
      .first<{ is_admin: number }>();

    if (!admin || admin.is_admin !== 1) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Get submission
    const submission = await env.DB.prepare(
      'SELECT * FROM manual_submissions WHERE id = ?'
    )
      .bind(submissionId)
      .first<any>();

    if (!submission) {
      return new Response(
        JSON.stringify({ error: 'Submission not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (submission.status !== 'pending') {
      return new Response(
        JSON.stringify({ error: 'Submission already processed' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Use edited values if available, otherwise use original values
    // Convert distance from km to meters (races table expects meters)
    const distanceKm = submission.edited_distance ?? submission.original_distance;
    const distance = distanceKm ? distanceKm * 1000 : null;
    const timeSeconds = submission.edited_time_seconds ?? submission.original_time_seconds;
    const elevationGain = submission.edited_elevation_gain ?? submission.original_elevation_gain;

    // Calculate moving time and pace
    const movingTime = timeSeconds;
    const elapsedTime = timeSeconds;

    // Find or create athlete based on Strava ID or name
    // Split athlete_name into firstname and lastname
    const nameParts = submission.athlete_name.trim().split(/\s+/);
    const firstname = nameParts[0] || '';
    const lastname = nameParts.slice(1).join(' ') || '';

    let athleteId: number | null = null;
    let athlete: { id: number } | null = null;

    // If we have the real Strava athlete ID, try to find or create by that first
    if (submission.athlete_strava_id) {
      athlete = await env.DB.prepare(
        `SELECT id FROM athletes WHERE strava_id = ?`
      )
        .bind(submission.athlete_strava_id)
        .first<{ id: number }>();
    }

    // If not found by Strava ID, try matching by name
    if (!athlete) {
      athlete = await env.DB.prepare(
        `SELECT id FROM athletes WHERE firstname = ? AND lastname = ?`
      )
        .bind(firstname, lastname)
        .first<{ id: number }>();
    }

    if (!athlete) {
      // Create new athlete record for manual submission
      // Use the real Strava ID if available, otherwise use a placeholder negative ID
      const stravaId = submission.athlete_strava_id || -Math.floor(Date.now() / 1000);

      const newAthlete = await env.DB.prepare(
        `INSERT INTO athletes (
          strava_id,
          firstname,
          lastname,
          profile_photo,
          is_admin,
          is_hidden,
          is_blocked,
          created_at
        ) VALUES (?, ?, ?, ?, 0, 0, 0, strftime('%s', 'now'))
        RETURNING id`
      )
        .bind(stravaId, firstname, lastname, submission.athlete_profile_photo || null)
        .first<{ id: number }>();

      athleteId = newAthlete?.id || null;
      console.log(`Created new athlete for manual submission: ${submission.athlete_name} (Strava ID: ${stravaId}, DB ID: ${athleteId})`);
    } else {
      athleteId = athlete.id;
      console.log(`Found existing athlete: ${submission.athlete_name} (ID: ${athleteId})`);
    }

    // Insert into races table
    const raceResult = await env.DB.prepare(
      `INSERT INTO races (
        athlete_id,
        strava_activity_id,
        name,
        distance,
        moving_time,
        elapsed_time,
        elevation_gain,
        date,
        event_name,
        source,
        manual_submission_id,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?)
      RETURNING id`
    )
      .bind(
        athleteId,
        submission.strava_activity_id,
        submission.activity_name,
        distance,
        movingTime,
        elapsedTime,
        elevationGain,
        submission.date,
        submission.event_name,
        submissionId,
        Math.floor(Date.now() / 1000)
      )
      .first<{ id: number }>();

    // Update submission status
    await env.DB.prepare(
      `UPDATE manual_submissions
       SET status = 'approved', processed_at = ?
       WHERE id = ?`
    )
      .bind(Math.floor(Date.now() / 1000), submissionId)
      .run();

    return new Response(
      JSON.stringify({
        success: true,
        race_id: raceResult?.id
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (error) {
    console.error('Error in approveSubmission:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to approve submission' }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }
}

/**
 * POST /api/admin/manual-submissions/:id/reject
 * Reject a manual submission
 */
export async function rejectSubmission(request: Request, env: Env, submissionId: number): Promise<Response> {
  try {
    const body = await request.json() as { admin_strava_id: number; reason?: string };

    // Verify admin
    const admin = await env.DB.prepare(
      'SELECT is_admin FROM athletes WHERE strava_id = ?'
    )
      .bind(body.admin_strava_id)
      .first<{ is_admin: number }>();

    if (!admin || admin.is_admin !== 1) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Update submission status
    await env.DB.prepare(
      `UPDATE manual_submissions
       SET status = 'rejected',
           processed_at = ?,
           notes = CASE
             WHEN notes IS NULL THEN ?
             ELSE notes || ' | Rejection reason: ' || ?
           END
       WHERE id = ?`
    )
      .bind(
        Math.floor(Date.now() / 1000),
        body.reason || 'Rejected by admin',
        body.reason || 'Rejected by admin',
        submissionId
      )
      .run();

    return new Response(
      JSON.stringify({ success: true }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (error) {
    console.error('Error in rejectSubmission:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to reject submission' }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }
}

/**
 * DELETE /api/admin/manual-submissions/:id/delete
 * Delete an approved manual submission and its associated race
 */
export async function deleteSubmission(request: Request, env: Env, submissionId: number): Promise<Response> {
  try {
    const body = await request.json() as { admin_strava_id: number };

    // Verify admin
    const admin = await env.DB.prepare(
      'SELECT is_admin FROM athletes WHERE strava_id = ?'
    )
      .bind(body.admin_strava_id)
      .first<{ is_admin: number }>();

    if (!admin || admin.is_admin !== 1) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Get submission to verify it exists and is approved
    const submission = await env.DB.prepare(
      'SELECT * FROM manual_submissions WHERE id = ?'
    )
      .bind(submissionId)
      .first<any>();

    if (!submission) {
      return new Response(
        JSON.stringify({ error: 'Submission not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (submission.status !== 'approved') {
      return new Response(
        JSON.stringify({ error: 'Can only delete approved submissions' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Delete the race entry (this will cascade to delete related data)
    await env.DB.prepare(
      'DELETE FROM races WHERE manual_submission_id = ?'
    )
      .bind(submissionId)
      .run();

    // Delete the submission record
    await env.DB.prepare(
      'DELETE FROM manual_submissions WHERE id = ?'
    )
      .bind(submissionId)
      .run();

    return new Response(
      JSON.stringify({ success: true }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (error) {
    console.error('Error in deleteSubmission:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to delete submission' }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }
}
