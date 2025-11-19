#!/usr/bin/env node

/**
 * Generate Parkrun Event Name Mappings
 *
 * This script fetches the official parkrun events.json and generates
 * event name mappings by transforming EventShortName to a normalized
 * version of EventLongName (with " parkrun" removed).
 *
 * Usage:
 *   node generate-parkrun-event-mappings.js [--sql] [--json] [--diff] [--file <path>]
 *
 * Options:
 *   --sql         Output as SQL INSERT statements (default)
 *   --json        Output as JSON
 *   --diff        Only show mappings where input differs from output
 *   --file <path> Read events.json from local file instead of fetching
 */

const https = require('https');
const fs = require('fs');

// Australian state abbreviations
const AU_STATE_ABBREVS = {
  'QLD': 'Queensland',
  'NSW': 'New South Wales',
  'VIC': 'Victoria',
  'SA': 'South Australia',
  'WA': 'Western Australia',
  'TAS': 'Tasmania',
  'NT': 'Northern Territory',
  'ACT': 'Australian Capital Territory',
};

/**
 * Fetch JSON from URL
 */
function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Failed to parse JSON: ${e.message}`));
        }
      });
    }).on('error', reject);
  });
}

/**
 * Normalize event name by removing "parkrun" variations
 */
function normalizeEventLongName(longName) {
  let normalized = longName;

  // Remove " parkrun," -> ","
  normalized = normalized.replace(/\s+parkrun,/gi, ',');

  // Remove " parkrun" at end
  normalized = normalized.replace(/\s+parkrun$/gi, '');

  // Remove "parkrun " at start (handles "parkrun de/du" prefixes)
  if (normalized.toLowerCase().startsWith('parkrun de ')) {
    normalized = normalized.substring(11);
  } else if (normalized.toLowerCase().startsWith('parkrun du ')) {
    normalized = normalized.substring(11);
  } else if (normalized.toLowerCase().startsWith('parkrun ')) {
    normalized = normalized.substring(8);
  }

  return normalized.trim();
}

/**
 * Expand Australian state abbreviations in event names
 * e.g., "Mansfield QLD" -> "Mansfield, Queensland"
 */
function expandStateAbbreviation(name) {
  for (const [abbrev, full] of Object.entries(AU_STATE_ABBREVS)) {
    const pattern = new RegExp(`\\s+${abbrev}$`, 'i');
    if (pattern.test(name)) {
      return name.replace(pattern, `, ${full}`);
    }
  }
  return name;
}

/**
 * Generate mapping from EventShortName to normalized EventLongName
 */
function generateMapping(event) {
  const shortName = event.properties.EventShortName;
  const longName = event.properties.EventLongName;

  if (!shortName || !longName) {
    return null;
  }

  // Normalize the long name
  let normalized = normalizeEventLongName(longName);

  // Expand state abbreviations in the short name if present
  const expandedShortName = expandStateAbbreviation(shortName);

  return {
    from: shortName,
    to: normalized,
    expandedFrom: expandedShortName !== shortName ? expandedShortName : null,
  };
}

/**
 * Format mappings as SQL INSERT statements
 */
function formatAsSQL(mappings) {
  const lines = [
    '-- Auto-generated parkrun event name mappings',
    '-- Generated from https://images.parkrun.com/events.json',
    `-- Date: ${new Date().toISOString()}`,
    '',
    'INSERT OR IGNORE INTO parkrun_event_name_mappings (from_name, to_name, notes) VALUES',
  ];

  const values = mappings.map((m, i) => {
    const comma = i < mappings.length - 1 ? ',' : ';';
    const escapedFrom = m.from.replace(/'/g, "''");
    const escapedTo = m.to.replace(/'/g, "''");
    return `  ('${escapedFrom}', '${escapedTo}', 'Auto-generated from events.json')${comma}`;
  });

  return lines.concat(values).join('\n');
}

/**
 * Format mappings as JSON
 */
function formatAsJSON(mappings) {
  return JSON.stringify(mappings.map(m => ({
    from_name: m.from,
    to_name: m.to,
  })), null, 2);
}

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2);
  const outputSQL = args.includes('--sql') || !args.includes('--json');
  const outputJSON = args.includes('--json');
  const diffOnly = args.includes('--diff');

  // Check for --file argument
  const fileIndex = args.indexOf('--file');
  const localFile = fileIndex !== -1 ? args[fileIndex + 1] : null;

  let data;

  try {
    if (localFile) {
      console.error(`Reading events from local file: ${localFile}`);
      const content = fs.readFileSync(localFile, 'utf8');
      data = JSON.parse(content);
    } else {
      console.error('Fetching parkrun events from https://images.parkrun.com/events.json...');
      data = await fetchJSON('https://images.parkrun.com/events.json');
    }

    if (!data.features || !Array.isArray(data.features)) {
      throw new Error('Invalid events.json format: missing features array');
    }

    console.error(`Found ${data.features.length} events`);

    // Generate mappings
    const mappings = [];
    const seenFrom = new Set();

    for (const event of data.features) {
      // Skip junior parkruns (seriesid 2)
      if (event.properties.seriesid === 2) {
        continue;
      }

      const mapping = generateMapping(event);
      if (!mapping) continue;

      // Skip duplicates
      if (seenFrom.has(mapping.from)) continue;
      seenFrom.add(mapping.from);

      // If diffOnly, only include where from != to
      if (diffOnly && mapping.from === mapping.to) {
        continue;
      }

      mappings.push(mapping);
    }

    // Sort by from_name
    mappings.sort((a, b) => a.from.localeCompare(b.from));

    console.error(`Generated ${mappings.length} mappings${diffOnly ? ' (diff only)' : ''}`);

    // Output
    if (outputJSON) {
      console.log(formatAsJSON(mappings));
    } else {
      console.log(formatAsSQL(mappings));
    }

    // Show some example transformations
    console.error('\nExample transformations:');
    const examples = [
      'Albert Melbourne',
      'Bushy Park',
      'Kingsway',
      'Camperdown',
      'Brockwell',
      'Finsbury Park',
      'Pollok',
    ];

    for (const example of examples) {
      const mapping = mappings.find(m => m.from === example);
      if (mapping) {
        console.error(`  "${mapping.from}" -> "${mapping.to}"`);
      }
    }

  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

main();
