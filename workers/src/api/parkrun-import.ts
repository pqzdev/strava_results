// API endpoint for manually importing parkrun CSV data

import { Env } from '../types';
import { parseTimeToSeconds } from '../utils/parkrun';

interface CSVRow {
  [key: string]: string;
}

/**
 * POST /api/parkrun/import - Import parkrun results from CSV
 *
 * Expected CSV format from parkrun consolidated club results:
 * Date,Event,Pos,Gender Pos,parkrunner,Time,Age Grade,Age Cat
 */
export async function importParkrunCSV(request: Request, env: Env): Promise<Response> {
  try {
    // Check if we should replace existing data
    const url = new URL(request.url);
    const shouldReplace = url.searchParams.get('replace') === 'true';

    const formData = await request.formData();
    const fileEntry = formData.get('file');

    if (!fileEntry || typeof fileEntry === 'string') {
      return new Response(
        JSON.stringify({ error: 'No file provided' }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }

    // At this point, fileEntry is guaranteed to be a File
    const file = fileEntry as File;
    const csvText = await file.text();
    const rows = parseCSV(csvText);

    let imported = 0;
    let skipped = 0;
    let errors = 0;
    let deleted = 0;

    // If replace mode, delete all existing parkrun data
    if (shouldReplace) {
      // Delete all results
      const deleteResult = await env.DB.prepare('DELETE FROM parkrun_results').run();
      deleted = deleteResult.meta.changes || 0;
    }

    // Create sync log entry
    const syncStartTime = Math.floor(Date.now() / 1000);
    const syncLogResult = await env.DB.prepare(
      `INSERT INTO parkrun_sync_logs (sync_started_at, club_num, status)
       VALUES (?, ?, 'running')
       RETURNING id`
    )
      .bind(syncStartTime, 19959) // Woodstock club
      .first<{ id: number }>();

    const syncLogId = syncLogResult?.id;

    try {
      for (const row of rows) {
        try {
          // Parse CSV row
          const date = parseParkrunDate(row.Date || row.date);
          const eventName = row.Event || row.event;
          const position = parseInt(row.Pos || row.pos || row.Position || '0');
          const genderPositionStr = row['Gender Pos'] || row.genderPos || row['gender pos'] || row.GenderPos || '';
          const genderPosition = genderPositionStr ? parseInt(genderPositionStr) : null;
          const athleteName = row.parkrunner || row.Parkrunner || row['Park Runner'];
          const timeString = row.Time || row.time;
          const ageGrade = row['Age Grade'] || row.ageGrade || row['age grade'];
          const ageCategory = row['Age Cat'] || row.ageCat || row['age cat'];

          if (!date || !eventName || !athleteName || !timeString) {
            console.warn('Skipping invalid row:', row);
            skipped++;
            continue;
          }

          // Extract event number from event name (e.g., "Event name #123" -> 123)
          const eventNumberMatch = eventName.match(/#(\d+)/);
          const eventNumber = eventNumberMatch ? parseInt(eventNumberMatch[1]) : 0;

          const timeSeconds = parseTimeToSeconds(timeString);

          // Insert into database
          await env.DB.prepare(
            `INSERT INTO parkrun_results
             (athlete_name, event_name, event_number, position, gender_position, time_seconds,
              time_string, age_grade, age_category, date, club_name)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(athlete_name, event_name, event_number, date) DO NOTHING`
          )
            .bind(
              athleteName,
              eventName.replace(/#\d+/, '').trim(), // Remove event number from name
              eventNumber,
              position,
              genderPosition,
              timeSeconds,
              timeString,
              ageGrade || null,
              ageCategory || null,
              date,
              'Woodstock'
            )
            .run();

          imported++;
        } catch (error) {
          console.error('Error importing row:', error);
          errors++;
        }
      }

      // Update sync log
      const syncCompletedTime = Math.floor(Date.now() / 1000);
      await env.DB.prepare(
        `UPDATE parkrun_sync_logs
         SET sync_completed_at = ?,
             results_fetched = ?,
             new_results_added = ?,
             errors_encountered = ?,
             status = 'completed'
         WHERE id = ?`
      )
        .bind(
          syncCompletedTime,
          rows.length,
          imported,
          errors,
          syncLogId
        )
        .run();

      return new Response(
        JSON.stringify({
          success: true,
          message: shouldReplace ? 'Parkrun data replaced successfully' : 'Parkrun data imported successfully',
          imported,
          skipped,
          errors,
          total: rows.length,
          deleted: shouldReplace ? deleted : 0,
        }),
        {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    } catch (error) {
      // Update sync log with failure
      await env.DB.prepare(
        `UPDATE parkrun_sync_logs
         SET status = 'failed',
             error_message = ?,
             results_fetched = ?,
             errors_encountered = ?
         WHERE id = ?`
      )
        .bind(
          error instanceof Error ? error.message : 'Unknown error',
          rows.length,
          errors + 1,
          syncLogId
        )
        .run();

      throw error;
    }
  } catch (error) {
    console.error('Error importing parkrun CSV:', error);
    return new Response(
      JSON.stringify({
        error: 'Failed to import parkrun data',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
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
 * Parse CSV text into array of objects
 */
function parseCSV(csvText: string): CSVRow[] {
  const lines = csvText.trim().split('\n');
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map(h => h.trim());
  const rows: CSVRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim());
    const row: CSVRow = {};

    headers.forEach((header, index) => {
      row[header] = values[index] || '';
    });

    rows.push(row);
  }

  return rows;
}

/**
 * Parse parkrun date format to ISO 8601
 * Parkrun typically uses DD/MM/YYYY format
 */
function parseParkrunDate(dateStr: string): string {
  if (!dateStr) return '';

  // Try DD/MM/YYYY format
  const parts = dateStr.split('/');
  if (parts.length === 3) {
    const day = parts[0].padStart(2, '0');
    const month = parts[1].padStart(2, '0');
    const year = parts[2];
    return `${year}-${month}-${day}`;
  }

  // Try YYYY-MM-DD format (already ISO)
  if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
    return dateStr;
  }

  return dateStr;
}
