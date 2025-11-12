// API endpoints for manual Strava activity submissions

import { Env } from '../types';

interface ExtractedActivity {
  strava_activity_id: number;
  strava_url: string;
  athlete_name: string;
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

    // Parse HTML to extract activity details
    // Note: This is a simple regex-based parser. For production, consider using a proper HTML parser.

    // Extract athlete name
    const athleteMatch = html.match(/<a[^>]*class="[^"]*minimal-athlete[^"]*"[^>]*>([^<]+)<\/a>/i) ||
                        html.match(/<span[^>]*class="[^"]*athlete-name[^"]*"[^>]*>([^<]+)<\/span>/i) ||
                        html.match(/Athlete:<\/strong>\s*([^<]+)/i);
    const athleteName = athleteMatch ? athleteMatch[1].trim() : 'Unknown Athlete';

    // Extract activity title
    const titleMatch = html.match(/<h1[^>]*class="[^"]*activity-name[^"]*"[^>]*>([^<]+)<\/h1>/i) ||
                      html.match(/<title>([^|]+)/i);
    const activityName = titleMatch ? titleMatch[1].trim() : 'Untitled Activity';

    // Extract activity type
    const typeMatch = html.match(/Activity Type:<\/strong>\s*([^<]+)/i) ||
                     html.match(/data-activity-type="([^"]+)"/i) ||
                     html.match(/<span[^>]*class="[^"]*activity-type[^"]*"[^>]*>([^<]+)<\/span>/i);
    const activityType = typeMatch ? typeMatch[1].trim() : 'Run';

    // Extract date
    const dateMatch = html.match(/<time[^>]*datetime="([^"]+)"/i) ||
                     html.match(/data-date="([^"]+)"/i);
    const date = dateMatch ? dateMatch[1].split('T')[0] : new Date().toISOString().split('T')[0];

    // Extract distance (in meters, convert to km)
    const distanceMatch = html.match(/Distance:<\/strong>\s*([0-9.]+)\s*km/i) ||
                         html.match(/data-distance="([0-9.]+)"/i);
    const distance = distanceMatch ? parseFloat(distanceMatch[1]) : null;

    // Extract time
    const timeMatch = html.match(/Moving Time:<\/strong>\s*([0-9:hms\s]+)/i) ||
                     html.match(/Elapsed Time:<\/strong>\s*([0-9:hms\s]+)/i) ||
                     html.match(/data-elapsed-time="([0-9]+)"/i);
    let timeSeconds: number | null = null;
    if (timeMatch) {
      if (timeMatch[1].match(/^\d+$/)) {
        // Already in seconds
        timeSeconds = parseInt(timeMatch[1]);
      } else {
        timeSeconds = parseTimeToSeconds(timeMatch[1]);
      }
    }

    // Extract elevation gain
    const elevationMatch = html.match(/Elevation Gain:<\/strong>\s*([0-9,]+)\s*m/i) ||
                          html.match(/data-elevation-gain="([0-9.]+)"/i);
    const elevationGain = elevationMatch ? parseFloat(elevationMatch[1].replace(/,/g, '')) : null;

    return {
      strava_activity_id: activityId,
      strava_url: canonicalUrl,
      athlete_name: athleteName,
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
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
          RETURNING id`
        )
          .bind(
            body.session_id,
            activity.strava_activity_id,
            activity.strava_url,
            activity.athlete_name,
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
    const distance = submission.edited_distance ?? submission.original_distance;
    const timeSeconds = submission.edited_time_seconds ?? submission.original_time_seconds;
    const elevationGain = submission.edited_elevation_gain ?? submission.original_elevation_gain;

    // Calculate moving time and pace
    const movingTime = timeSeconds;
    const elapsedTime = timeSeconds;

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
      ) VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?)
      RETURNING id`
    )
      .bind(
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
