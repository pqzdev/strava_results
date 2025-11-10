/**
 * Parkrun Smart Scraper - Automated Multi-Date Collection
 *
 * This script intelligently collects data across multiple dates by:
 * 1. Running entirely in the browser (bypassing parkrun's server-side blocking)
 * 2. Using fetch() with proper browser context to avoid detection
 * 3. Parsing responses without page reloads for speed
 * 4. Adding realistic delays to mimic human behavior
 *
 * HOW TO USE:
 * 1. Open https://www.parkrun.com/results/consolidatedclub/?clubNum=19959
 * 2. Open browser console (F12)
 * 3. Paste this script and press Enter
 * 4. Wait for completion (progress shown in console)
 * 5. Copy the CSV output
 *
 * ADVANTAGES over page-reload approach:
 * - Much faster (no page reloads)
 * - More reliable (stays in one tab)
 * - Better for parkrun's servers (fewer full page loads)
 * - Handles errors gracefully
 */

(async function() {
  console.clear();
  console.log('🏃 Parkrun Smart Scraper v2.0');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // ========== CONFIGURATION ==========
  // Get config from URL params or use defaults
  const urlParams = new URLSearchParams(window.location.search);
  const CONFIG = {
    clubNum: parseInt(urlParams.get('clubNum') || '19959'), // Woodstock Runners
    startDate: urlParams.get('startDate') || '2024-01-01', // Start of 2024
    endDate: urlParams.get('endDate') || new Date().toISOString().split('T')[0], // Today
    delayBetweenRequests: 2000, // 2 seconds (be respectful)
    clubNameFilter: /woodstock/i, // Filter for this club
    maxRetries: 2, // Retry failed requests
    includeSpecialDates: ['2024-12-25', '2025-01-01'], // Christmas and New Year parkruns
    apiEndpoint: urlParams.get('apiEndpoint') || '', // API endpoint to POST results
    autoUpload: urlParams.get('autoUpload') === 'true', // Auto-upload to API
  };

  // ========== HELPER FUNCTIONS ==========

  function getSaturdaysInRange(startDate, endDate) {
    const saturdays = [];
    const start = new Date(startDate);
    const end = new Date(endDate);

    const current = new Date(start);
    while (current.getDay() !== 6) {
      current.setDate(current.getDate() + 1);
    }

    while (current <= end) {
      saturdays.push(current.toISOString().split('T')[0]);
      current.setDate(current.getDate() + 7);
    }

    return saturdays;
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function parseHTMLString(html) {
    const parser = new DOMParser();
    return parser.parseFromString(html, 'text/html');
  }

  function extractResultsFromHTML(html, eventDate) {
    const doc = parseHTMLString(html);

    const tables = doc.querySelectorAll('table');
    let resultsTable = null;

    // Find results table
    for (const table of tables) {
      const headers = table.querySelectorAll('th');
      const headerText = Array.from(headers).map(h => h.textContent.trim().toLowerCase());

      if (headerText.some(h => h.includes('runner') || h.includes('time'))) {
        resultsTable = table;
        break;
      }
    }

    // Extract event name from h2 header preceding the results table
    let eventName = '';
    if (resultsTable) {
      // Find the closest h2 before this table
      let currentElement = resultsTable.previousElementSibling;
      while (currentElement) {
        if (currentElement.tagName === 'H2') {
          const text = currentElement.textContent.trim();
          // Clean up the event name (remove "parkrun" suffix if present)
          eventName = text.replace(/\s+parkrun$/i, '').trim();
          break;
        }
        currentElement = currentElement.previousElementSibling;
      }
    }

    console.log('  Event name from h2:', eventName);

    if (!resultsTable) {
      return [];
    }

    // Get headers
    const headerRow = resultsTable.querySelector('thead tr') || resultsTable.querySelector('tr');
    if (!headerRow) return [];

    const headers = Array.from(headerRow.querySelectorAll('th, td')).map(h => h.textContent.trim());

    console.log('  Table headers found:', headers);
    console.log('  Total columns:', headers.length);

    // Map column indices - note: no Date or Event columns in table
    const colIndex = {
      pos: headers.findIndex(h => /^position$/i.test(h)),
      genderPos: headers.findIndex(h => /gender\s*position/i.test(h)),
      runner: headers.findIndex(h => /parkrunner/i.test(h)),
      club: headers.findIndex(h => /^club$/i.test(h)),
      time: headers.findIndex(h => /^time$/i.test(h)),
    };

    console.log('  Column mapping:', colIndex);

    // Validate critical columns
    if (colIndex.runner < 0) {
      console.warn('  ⚠️  Could not find runner column!');
    }

    // Extract rows
    const tbody = resultsTable.querySelector('tbody') || resultsTable;
    const rows = Array.from(tbody.querySelectorAll('tr')).slice(1); // Skip header

    const results = [];
    let sampleRowLogged = false;

    for (const row of rows) {
      const cells = Array.from(row.querySelectorAll('td'));
      if (cells.length === 0) continue;

      // Log first row for debugging
      if (!sampleRowLogged && cells.length > 0) {
        console.log('  Sample row data:', cells.map((c, i) => `[${i}] ${c.textContent.trim()}`).join(', '));
        sampleRowLogged = true;
      }

      const club = colIndex.club >= 0 ? cells[colIndex.club]?.textContent.trim() : '';

      // Filter by club
      if (!club || !CONFIG.clubNameFilter.test(club)) {
        continue;
      }

      // Build result object with correct column mapping
      const result = {
        Date: eventDate,
        Event: eventName,
        Pos: colIndex.pos >= 0 ? cells[colIndex.pos]?.textContent.trim() : '',
        parkrunner: colIndex.runner >= 0 ? cells[colIndex.runner]?.textContent.trim() : '',
        Time: colIndex.time >= 0 ? cells[colIndex.time]?.textContent.trim() : '',
        'Gender Pos': colIndex.genderPos >= 0 ? cells[colIndex.genderPos]?.textContent.trim() : '',
      };

      results.push(result);
    }

    return results;
  }

  async function fetchDateResults(eventDate, retryCount = 0) {
    const url = `https://www.parkrun.com/results/consolidatedclub/?clubNum=${CONFIG.clubNum}&eventdate=${eventDate}`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        credentials: 'include', // Important: includes cookies
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const html = await response.text();
      const results = extractResultsFromHTML(html, eventDate);

      return { success: true, results, date: eventDate };

    } catch (error) {
      if (retryCount < CONFIG.maxRetries) {
        console.warn(`  ⚠️  Retry ${retryCount + 1}/${CONFIG.maxRetries} for ${eventDate}...`);
        await sleep(CONFIG.delayBetweenRequests * 2); // Longer delay for retry
        return fetchDateResults(eventDate, retryCount + 1);
      }

      console.error(`  ❌ Failed ${eventDate}: ${error.message}`);
      return { success: false, results: [], date: eventDate, error: error.message };
    }
  }

  function generateCSV(results) {
    if (results.length === 0) return '';

    // Get all unique keys from results (dynamic headers)
    const allKeys = new Set();
    results.forEach(result => {
      Object.keys(result).forEach(key => allKeys.add(key));
    });

    // Order headers: Date, Event, Pos, parkrunner, Time, then others
    const priorityHeaders = ['Date', 'Event', 'Pos', 'parkrunner', 'Time'];
    const otherHeaders = Array.from(allKeys).filter(h => !priorityHeaders.includes(h)).sort();
    const csvHeaders = [...priorityHeaders.filter(h => allKeys.has(h)), ...otherHeaders];

    const csvRows = [csvHeaders.join(',')];

    results.forEach(result => {
      const row = csvHeaders.map(header => {
        const value = result[header] || '';
        // Escape commas, quotes, and newlines
        if (value.includes(',') || value.includes('"') || value.includes('\n')) {
          return `"${value.replace(/"/g, '""')}"`;
        }
        return value;
      });
      csvRows.push(row.join(','));
    });

    return csvRows.join('\n');
  }

  // ========== MAIN EXECUTION ==========

  const saturdays = getSaturdaysInRange(CONFIG.startDate, CONFIG.endDate);

  // Add special dates (Christmas, New Year) and remove duplicates
  const allDates = [...new Set([...saturdays, ...CONFIG.includeSpecialDates])].sort();

  console.log(`📅 Date Range: ${CONFIG.startDate} to ${CONFIG.endDate}`);
  console.log(`📊 Found ${saturdays.length} Saturdays`);
  console.log(`🎄 Plus ${CONFIG.includeSpecialDates.length} special dates (Christmas, New Year)`);
  console.log(`📆 Total dates to process: ${allDates.length}`);
  console.log(`⏱️  Estimated time: ~${Math.round(allDates.length * CONFIG.delayBetweenRequests / 1000 / 60)} minutes`);
  console.log(`🏃 Club: ${CONFIG.clubNum}\n`);

  const allResults = [];
  const stats = {
    total: allDates.length,
    processed: 0,
    successful: 0,
    failed: 0,
    totalResults: 0
  };

  const startTime = Date.now();

  // Process each date
  for (let i = 0; i < allDates.length; i++) {
    const date = allDates[i];
    const progress = Math.round((i / allDates.length) * 100);

    console.log(`[${i + 1}/${allDates.length}] ${progress}% - ${date}`);

    const result = await fetchDateResults(date);

    stats.processed++;
    if (result.success) {
      stats.successful++;
      stats.totalResults += result.results.length;
      allResults.push(...result.results);
      console.log(`  ✓ Found ${result.results.length} results`);
    } else {
      stats.failed++;
      console.log(`  ❌ Failed: ${result.error}`);
    }

    // Delay before next request (except for last one)
    if (i < allDates.length - 1) {
      await sleep(CONFIG.delayBetweenRequests);
    }
  }

  const elapsedSeconds = Math.round((Date.now() - startTime) / 1000);

  // ========== RESULTS ==========

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✅ SCRAPING COMPLETE!\n');
  console.log(`📊 Statistics:`);
  console.log(`   • Dates processed: ${stats.processed}/${stats.total}`);
  console.log(`   • Successful: ${stats.successful}`);
  console.log(`   • Failed: ${stats.failed}`);
  console.log(`   • Total results: ${stats.totalResults}`);
  console.log(`   • Time taken: ${Math.floor(elapsedSeconds / 60)}m ${elapsedSeconds % 60}s`);
  console.log(`   • Average: ${(stats.totalResults / stats.successful).toFixed(1)} results per date\n`);

  if (allResults.length === 0) {
    console.warn('⚠️  No results found. Check your date range and club number.');
    return;
  }

  // Generate CSV
  const csv = generateCSV(allResults);

  // ========== UPLOAD TO API ==========

  if (CONFIG.autoUpload && CONFIG.apiEndpoint) {
    console.log('\n📤 Uploading to API...');

    try {
      const formData = new FormData();
      const blob = new Blob([csv], { type: 'text/csv' });
      formData.append('file', blob, 'parkrun-results.csv');

      const response = await fetch(CONFIG.apiEndpoint, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        throw new Error(`Upload failed: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();

      console.log('\n✅ UPLOAD SUCCESSFUL!\n');
      console.log(`📊 Upload Results:`);
      if (result.deleted > 0) {
        console.log(`   • Deleted existing: ${result.deleted}`);
      }
      console.log(`   • Total rows: ${result.total}`);
      console.log(`   • Imported: ${result.imported}`);
      console.log(`   • Skipped (duplicates): ${result.skipped}`);
      console.log(`   • Errors: ${result.errors}`);
      if (result.restored > 0) {
        console.log(`   • Restored hidden athletes: ${result.restored}`);
      }
      console.log('\n✓ Data has been automatically uploaded to your dashboard!');
      console.log('You can close this tab now.');

    } catch (err) {
      console.error('\n❌ Upload failed:', err.message);
      console.log('\n⚠️  Falling back to manual download...');

      // Show CSV for manual download
      console.log('\n=== CSV OUTPUT (Copy everything below) ===\n');
      console.log(csv);
      console.log('\n=== END CSV OUTPUT ===\n');
    }
  } else {
    // No auto-upload - show CSV output
    console.log('=== CSV OUTPUT (Copy everything below) ===\n');
    console.log(csv);
    console.log('\n=== END CSV OUTPUT ===\n');

    // Copy to clipboard
    if (navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(csv);
        console.log('✓ CSV copied to clipboard!');
      } catch (err) {
        console.log('⚠️  Could not auto-copy to clipboard. Please copy manually.');
      }
    }

    console.log('\n📝 Next Steps:');
    console.log('1. CSV data is shown above (and copied to clipboard)');
    console.log('2. Save as parkrun-results.csv');
    console.log('3. Upload to your parkrun dashboard');
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Return data for programmatic access
  return {
    stats,
    results: allResults,
    csv
  };

})();
