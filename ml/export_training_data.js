#!/usr/bin/env node

/**
 * Export ML Training Data from D1 Database
 *
 * This script exports race data for training ML models:
 * 1. Parkrun classifier (parkrun vs non-parkrun)
 * 2. Event name predictor
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUTPUT_DIR = path.join(__dirname, 'data');
const RACES_OUTPUT = path.join(OUTPUT_DIR, 'races_training_data.csv');
const PARKRUN_OUTPUT = path.join(OUTPUT_DIR, 'parkrun_training_data.csv');
const STATS_OUTPUT = path.join(OUTPUT_DIR, 'data_stats.json');

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

console.log('🚀 Starting ML training data export...\n');

/**
 * Execute a D1 query and return results
 */
function executeQuery(sql) {
  const escapedSql = sql.replace(/"/g, '\\"').replace(/\n/g, ' ');
  const command = `npx wrangler d1 execute strava-club-db --remote --command "${escapedSql}" --json`;

  try {
    const output = execSync(command, { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 });
    const lines = output.split('\n');

    // Find the JSON output (skip wrangler's info messages)
    const jsonLine = lines.find(line => line.trim().startsWith('['));
    if (!jsonLine) {
      console.error('No JSON output found');
      console.error('Output:', output);
      return null;
    }

    const result = JSON.parse(jsonLine);
    if (result && result[0] && result[0].results) {
      return result[0].results;
    }
    return null;
  } catch (error) {
    console.error('Error executing query:', error.message);
    return null;
  }
}

/**
 * Convert array of objects to CSV
 */
function arrayToCSV(data, headers) {
  if (!data || data.length === 0) return '';

  // Use provided headers or extract from first object
  const cols = headers || Object.keys(data[0]);

  // Header row
  const csv = [cols.join(',')];

  // Data rows
  for (const row of data) {
    const values = cols.map(col => {
      const value = row[col];
      if (value === null || value === undefined) return '';

      // Escape values containing commas, quotes, or newlines
      const str = String(value);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    });
    csv.push(values.join(','));
  }

  return csv.join('\n');
}

/**
 * Export non-parkrun races from races table
 */
function exportRaces() {
  console.log('📊 Exporting race activities (non-parkrun)...');

  const query = `
    SELECT
      r.id,
      r.strava_activity_id,
      r.name as activity_name,
      r.distance,
      r.elapsed_time,
      r.moving_time,
      r.date,
      r.elevation_gain,
      r.average_heartrate,
      r.max_heartrate,
      COALESCE(r.manual_time, r.moving_time) as final_time,
      COALESCE(r.manual_distance, r.distance) as final_distance,
      r.event_name,
      r.polyline,
      r.source,
      r.is_hidden,
      a.first_name || ' ' || a.last_name as athlete_name
    FROM races r
    LEFT JOIN athletes a ON r.athlete_id = a.id
    WHERE r.is_hidden = 0
    ORDER BY r.date DESC
  `;

  const results = executeQuery(query);
  if (!results) {
    console.error('❌ Failed to export races');
    return;
  }

  console.log(`   Found ${results.length} race activities`);

  // Convert to CSV
  const csv = arrayToCSV(results);
  fs.writeFileSync(RACES_OUTPUT, csv);
  console.log(`   ✅ Saved to ${RACES_OUTPUT}\n`);

  return results;
}

/**
 * Export parkrun results
 */
function exportParkruns() {
  console.log('📊 Exporting parkrun results...');

  const query = `
    SELECT
      id,
      athlete_name,
      parkrun_athlete_id,
      event_name,
      event_number,
      position,
      time_seconds,
      time_string,
      age_grade,
      age_category,
      date,
      club_name,
      gender_position
    FROM parkrun_results
    ORDER BY date DESC
  `;

  const results = executeQuery(query);
  if (!results) {
    console.error('❌ Failed to export parkruns');
    return;
  }

  console.log(`   Found ${results.length} parkrun results`);

  // Convert to CSV
  const csv = arrayToCSV(results);
  fs.writeFileSync(PARKRUN_OUTPUT, csv);
  console.log(`   ✅ Saved to ${PARKRUN_OUTPUT}\n`);

  return results;
}

/**
 * Generate statistics about the data
 */
function generateStats(races, parkruns) {
  console.log('📈 Generating data statistics...');

  const stats = {
    races: {
      total: races.length,
      with_polyline: races.filter(r => r.polyline).length,
      unique_events: new Set(races.map(r => r.event_name)).size,
      event_distribution: {}
    },
    parkruns: {
      total: parkruns.length,
      unique_events: new Set(parkruns.map(p => p.event_name)).size,
      unique_athletes: new Set(parkruns.map(p => p.athlete_name)).size
    },
    combined: {
      total_activities: races.length + parkruns.length,
      polyline_coverage: (races.filter(r => r.polyline).length / races.length * 100).toFixed(1) + '%'
    }
  };

  // Event distribution for races
  for (const race of races) {
    const event = race.event_name || 'unknown';
    stats.races.event_distribution[event] = (stats.races.event_distribution[event] || 0) + 1;
  }

  // Sort events by frequency
  stats.races.top_events = Object.entries(stats.races.event_distribution)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => ({ name, count }));

  fs.writeFileSync(STATS_OUTPUT, JSON.stringify(stats, null, 2));
  console.log(`   ✅ Saved to ${STATS_OUTPUT}\n`);

  return stats;
}

/**
 * Main export function
 */
async function main() {
  const races = exportRaces();
  const parkruns = exportParkruns();

  if (races && parkruns) {
    const stats = generateStats(races, parkruns);

    console.log('📊 Data Summary:');
    console.log(`   • Race activities: ${stats.races.total}`);
    console.log(`   • Parkrun results: ${stats.parkruns.total}`);
    console.log(`   • Total: ${stats.combined.total_activities}`);
    console.log(`   • Unique race events: ${stats.races.unique_events}`);
    console.log(`   • Unique parkrun events: ${stats.parkruns.unique_events}`);
    console.log(`   • Polyline coverage: ${stats.combined.polyline_coverage}`);
    console.log('\n✨ Export complete!\n');
    console.log('Next steps:');
    console.log('1. Review the exported CSV files in ml/data/');
    console.log('2. Run exploratory data analysis: jupyter notebook ml/notebooks/eda.ipynb');
    console.log('3. Start feature engineering and model training');
  }
}

main();
