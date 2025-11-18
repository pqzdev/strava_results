// API endpoint for manually importing parkrun CSV data

import { Env } from '../types';

interface CSVRow {
  [key: string]: string;
}

/**
 * Parse time string (MM:SS or HH:MM:SS) to seconds
 */
function parseTimeToSeconds(timeStr: string): number {
  const parts = timeStr.split(':').map(Number);
  if (parts.length === 2) {
    // MM:SS
    return parts[0] * 60 + parts[1];
  } else if (parts.length === 3) {
    // HH:MM:SS
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return 0;
}

/**
 * POST /api/parkrun/import - Import parkrun results from CSV
 *
 * Expected CSV format from parkrun consolidated club results:
 * Date,Event,Pos,parkrunner,Parkrun ID,Time,Gender Pos,Age Grade,Age Cat
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
          let eventName = row.Event || row.event;
          const position = parseInt(row.Pos || row.pos || row.Position || '0');
          const genderPositionStr = row['Gender Pos'] || row.genderPos || row['gender pos'] || row.GenderPos || '';
          const genderPosition = genderPositionStr ? parseInt(genderPositionStr) : null;
          const athleteName = row.parkrunner || row.Parkrunner || row['Park Runner'];
          const parkrunId = row['Parkrun ID'] || row.parkrunId || row['parkrun id'] || row.ParkrunID || '';
          const timeString = row.Time || row.time;
          const ageGrade = row['Age Grade'] || row.ageGrade || row['age grade'];
          const ageCategory = row['Age Cat'] || row.ageCat || row['age cat'];

          if (!date || !eventName || !athleteName || !timeString) {
            console.warn('Skipping invalid row:', row);
            skipped++;
            continue;
          }

          // Normalize event name: remove " parkrun" from middle or end
          // Examples: "Albert parkrun, Melbourne" → "Albert, Melbourne"
          //          "Cooks River parkrun" → "Cooks River"
          eventName = eventName.replace(/\s+parkrun,/i, ','); // "Name parkrun, Location" → "Name, Location"
          eventName = eventName.replace(/\s+parkrun$/i, '');  // "Name parkrun" → "Name"
          eventName = eventName.trim();

          // Remove language-specific prefixes FIRST (e.g., "parkrun de/du Montsouris" → "Montsouris")
          // Must check these BEFORE "parkrun " to avoid leaving language prefix
          if (eventName.startsWith('parkrun de ')) {
            eventName = eventName.substring(11); // Remove "parkrun de " (11 characters)
          } else if (eventName.startsWith('parkrun du ')) {
            eventName = eventName.substring(11); // Remove "parkrun du " (11 characters)
          }
          // Remove "parkrun " prefix (e.g., "parkrun Ogród Saski, Lublin" → "Ogród Saski, Lublin")
          else if (eventName.startsWith('parkrun ')) {
            eventName = eventName.substring(8); // Remove "parkrun " (8 characters)
          }

          eventName = eventName.trim();

          // Apply database-driven event name mappings
          const mappingResult = await env.DB.prepare(
            `SELECT to_name FROM parkrun_event_name_mappings WHERE from_name = ?`
          ).bind(eventName).first<{ to_name: string }>();

          if (mappingResult) {
            eventName = mappingResult.to_name;
          }

          // Extract event number from event name (e.g., "Event name #123" -> 123)
          const eventNumberMatch = eventName.match(/#(\d+)/);
          const eventNumber = eventNumberMatch ? parseInt(eventNumberMatch[1]) : 0;

          const timeSeconds = parseTimeToSeconds(timeString);

          // Check if record exists with this parkrun_athlete_id
          const existing = parkrunId
            ? await env.DB.prepare(
                `SELECT id, data_source FROM parkrun_results
                 WHERE parkrun_athlete_id = ? AND event_name = ? AND date = ?`
              )
                .bind(parkrunId, eventName.replace(/#\d+/, '').trim(), date)
                .first<{ id: number; data_source: string | null }>()
            : null;

          if (existing) {
            // Update existing record - club data takes precedence (has gender_position)
            await env.DB.prepare(
              `UPDATE parkrun_results
               SET athlete_name = ?,
                   parkrun_athlete_id = ?,
                   event_number = ?,
                   position = ?,
                   gender_position = ?,
                   time_seconds = ?,
                   time_string = ?,
                   age_grade = ?,
                   age_category = ?,
                   club_name = ?,
                   data_source = 'club'
               WHERE id = ?`
            )
              .bind(
                athleteName,
                parkrunId || null,
                eventNumber,
                position,
                genderPosition,
                timeSeconds,
                timeString,
                ageGrade || null,
                ageCategory || null,
                'Woodstock',
                existing.id
              )
              .run();
            imported++;
          } else {
            // Insert new record
            await env.DB.prepare(
              `INSERT INTO parkrun_results
               (athlete_name, parkrun_athlete_id, event_name, event_number, position, gender_position, time_seconds,
                time_string, age_grade, age_category, date, club_name, data_source)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'club')
               ON CONFLICT(athlete_name, event_name, event_number, date) DO UPDATE SET
                 parkrun_athlete_id = excluded.parkrun_athlete_id,
                 gender_position = excluded.gender_position,
                 age_category = excluded.age_category,
                 club_name = excluded.club_name,
                 data_source = 'club'`
            )
              .bind(
                athleteName,
                parkrunId || null,
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
          }
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
 * Properly handles quoted fields with commas
 */
function parseCSV(csvText: string): CSVRow[] {
  const lines = csvText.trim().split('\n');
  if (lines.length < 2) return [];

  // Parse header row
  const headers = parseCSVLine(lines[0]);
  const rows: CSVRow[] = [];

  // Parse data rows
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const row: CSVRow = {};

    headers.forEach((header, index) => {
      row[header] = values[index] || '';
    });

    rows.push(row);
  }

  return rows;
}

/**
 * Parse a single CSV line, properly handling quoted fields
 * Handles: commas inside quotes, escaped quotes (""), and mixed quoted/unquoted fields
 */
function parseCSVLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;
  let i = 0;

  while (i < line.length) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        // Escaped quote ("")
        current += '"';
        i += 2;
        continue;
      } else {
        // Toggle quote mode
        inQuotes = !inQuotes;
        i++;
        continue;
      }
    }

    if (char === ',' && !inQuotes) {
      // End of field
      values.push(current.trim());
      current = '';
      i++;
      continue;
    }

    // Regular character
    current += char;
    i++;
  }

  // Push the last field
  values.push(current.trim());

  return values;
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
