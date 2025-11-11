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
  console.log('🏃 Parkrun Smart Scraper v3.0');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // ========== CONFIGURATION ==========
  // Get config from URL params or use defaults
  const urlParams = new URLSearchParams(window.location.search);
  const CONFIG = {
    clubNum: parseInt(urlParams.get('clubNum') || '19959'), // Woodstock Runners
    startDate: urlParams.get('startDate') || '2024-01-01', // Start of 2024
    endDate: urlParams.get('endDate') || new Date().toISOString().split('T')[0], // Today
    delayBetweenRequests: 2000, // 2 seconds (be respectful)
    clubName: 'Woodstock Runners', // Exact club name to filter
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

  /**
   * Extract results from consolidated club HTML
   * This page contains MULTIPLE events, each with:
   * - <h2>Event Name parkrun</h2>
   * - <p>Description with event link</p>
   * - <table> with results (Position | Gender Position | parkrunner | Club | Time)
   *
   * Important: First male and first female are marked with <strong> tags
   * and may be from other clubs. We ONLY want Woodstock Runners results.
   */
  function extractResultsFromHTML(html, eventDate) {
    const doc = parseHTMLString(html);
    const allResults = [];

    // Find all H2 headers (each represents an event)
    const eventHeaders = doc.querySelectorAll('h2');

    console.log(`  Found ${eventHeaders.length} event headers`);

    for (const h2 of eventHeaders) {
      // Get event name and clean it
      const eventName = h2.textContent.trim().replace(/\s+parkrun$/i, '').trim();

      // Skip if not an event name (like "Consolidated club report")
      if (!eventName || eventName.toLowerCase().includes('consolidated') || eventName.toLowerCase().includes('report')) {
        continue;
      }

      // Find the next table after this h2
      let currentElement = h2.nextElementSibling;
      let resultsTable = null;

      while (currentElement) {
        if (currentElement.tagName === 'TABLE') {
          resultsTable = currentElement;
          break;
        }
        if (currentElement.tagName === 'H2') {
          // Reached next event, stop looking
          break;
        }
        currentElement = currentElement.nextElementSibling;
      }

      if (!resultsTable) {
        console.log(`  ⚠️  No table found for ${eventName}`);
        continue;
      }

      console.log(`  Processing event: ${eventName}`);

      // Get all rows from the table body
      const tbody = resultsTable.querySelector('tbody') || resultsTable;
      const rows = Array.from(tbody.querySelectorAll('tr')).slice(1); // Skip header row

      let clubMembersFound = 0;

      for (const row of rows) {
        const cells = Array.from(row.querySelectorAll('td'));
        if (cells.length < 5) continue; // Need at least 5 columns

        // Column structure: [0] Position | [1] Gender Position | [2] parkrunner | [3] Club | [4] Time
        const position = cells[0]?.textContent.trim() || '';
        const genderPosition = cells[1]?.textContent.trim() || '';
        const runnerName = cells[2]?.textContent.trim() || '';
        const club = cells[3]?.textContent.trim() || '';
        const time = cells[4]?.textContent.trim() || '';

        // Check if this is a first finisher (wrapped in <strong> tags)
        const isFirstFinisher = row.querySelector('strong') !== null;

        // CRITICAL: Only include Woodstock Runners members
        // Skip first finishers who are NOT Woodstock Runners
        // Include first finishers who ARE Woodstock Runners
        if (!club.includes(CONFIG.clubName)) {
          // Not a Woodstock Runner - skip them
          continue;
        }

        // If we get here, they ARE a Woodstock Runner
        // Include them even if they're a first finisher

        clubMembersFound++;

        // Build result object
        const result = {
          Date: eventDate,
          Event: eventName,
          Pos: position,
          parkrunner: runnerName,
          Time: time,
          'Gender Pos': genderPosition,
        };

        allResults.push(result);
      }

      if (clubMembersFound > 0) {
        console.log(`    ✓ Found ${clubMembersFound} Woodstock Runners results`);
      }
    }

    return allResults;
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
      console.error(`  ❌ Error: ${error.message}`);

      if (retryCount < CONFIG.maxRetries) {
        console.log(`  🔄 Retrying (${retryCount + 1}/${CONFIG.maxRetries})...`);
        await sleep(CONFIG.delayBetweenRequests);
        return fetchDateResults(eventDate, retryCount + 1);
      }

      return { success: false, results: [], date: eventDate, error: error.message };
    }
  }

  function convertToCSV(allResults) {
    if (allResults.length === 0) {
      return 'No results found';
    }

    const headers = Object.keys(allResults[0]);
    const csvRows = [headers.join(',')];

    for (const result of allResults) {
      const row = headers.map(h => {
        const value = result[h] || '';
        // Escape commas and quotes
        if (value.includes(',') || value.includes('"') || value.includes('\n')) {
          return `"${value.replace(/"/g, '""')}"`;
        }
        return value;
      });
      csvRows.push(row.join(','));
    }

    return csvRows.join('\n');
  }

  async function uploadToAPI(csvData) {
    if (!CONFIG.apiEndpoint) {
      console.log('\n⚠️  No API endpoint configured, skipping upload');
      return false;
    }

    console.log(`\n📤 Uploading to ${CONFIG.apiEndpoint}...`);

    try {
      // Create a File object from CSV data
      const blob = new Blob([csvData], { type: 'text/csv' });
      const file = new File([blob], 'parkrun-results.csv', { type: 'text/csv' });

      // Create FormData
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch(CONFIG.apiEndpoint, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        // Try to get error details from response body
        let errorDetails = '';
        try {
          const errorData = await response.json();
          errorDetails = errorData.message || errorData.error || JSON.stringify(errorData);
        } catch {
          errorDetails = await response.text();
        }
        throw new Error(`Upload failed (${response.status}): ${errorDetails}`);
      }

      const result = await response.json();
      console.log('✅ UPLOAD SUCCESSFUL!');
      console.log('   Response:', result);
      return true;

    } catch (error) {
      console.error('❌ Upload failed:', error.message);
      console.log('   CSV data is still available in console (see above)');
      return false;
    }
  }

  // ========== MAIN EXECUTION ==========

  console.log('Configuration:');
  console.log(`  Club: ${CONFIG.clubName} (#${CONFIG.clubNum})`);
  console.log(`  Date range: ${CONFIG.startDate} to ${CONFIG.endDate}`);
  console.log(`  Delay: ${CONFIG.delayBetweenRequests}ms between requests`);
  console.log(`  API endpoint: ${CONFIG.apiEndpoint || 'None (manual copy)'}`);
  console.log(`  Auto-upload: ${CONFIG.autoUpload ? 'Yes' : 'No'}`);
  console.log('');

  // Get all dates to scrape
  const saturdays = getSaturdaysInRange(CONFIG.startDate, CONFIG.endDate);
  const specialDates = CONFIG.includeSpecialDates.filter(d => {
    const date = new Date(d);
    const start = new Date(CONFIG.startDate);
    const end = new Date(CONFIG.endDate);
    return date >= start && date <= end;
  });

  const allDates = [...new Set([...saturdays, ...specialDates])].sort();

  console.log(`📅 Dates to scrape: ${allDates.length} days`);
  console.log('');

  // Fetch all dates
  const allResults = [];
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < allDates.length; i++) {
    const date = allDates[i];
    const progress = Math.round((i / allDates.length) * 100);

    console.log(`[${i + 1}/${allDates.length}] ${progress}% - ${date}`);

    const { success, results } = await fetchDateResults(date);

    if (success) {
      successCount++;
      allResults.push(...results);
      console.log(`  ✓ Found ${results.length} results`);
    } else {
      failCount++;
    }

    // Add delay between requests (except on last one)
    if (i < allDates.length - 1) {
      await sleep(CONFIG.delayBetweenRequests);
    }
  }

  // ========== RESULTS ==========

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✅ SCRAPING COMPLETE');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log(`📊 Statistics:`);
  console.log(`   Dates processed: ${allDates.length}`);
  console.log(`   Successful: ${successCount}`);
  console.log(`   Failed: ${failCount}`);
  console.log(`   Total results: ${allResults.length}`);
  console.log('');

  if (allResults.length === 0) {
    console.log('⚠️  No results found. Check:');
    console.log('   - Club number is correct (19959 for Woodstock Runners)');
    console.log('   - Date range includes Saturdays');
    console.log('   - Members have registered their club with parkrun');
    return;
  }

  // Convert to CSV
  const csvData = convertToCSV(allResults);

  // Auto-upload if configured
  if (CONFIG.autoUpload && CONFIG.apiEndpoint) {
    const uploadSuccess = await uploadToAPI(csvData);
    if (uploadSuccess) {
      console.log('\n🎉 All done! Data uploaded successfully.');
      return;
    }
    console.log('\n⚠️  Upload failed, showing CSV for manual copy...\n');
  }

  // Show CSV for manual copy
  console.log('📋 CSV OUTPUT:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(csvData);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('\n💡 TIP: Click anywhere in the CSV above, press Ctrl+A (or Cmd+A), then Ctrl+C (or Cmd+C) to copy');

  // Also copy to clipboard if possible
  if (navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(csvData);
      console.log('✅ CSV copied to clipboard!');
    } catch (e) {
      console.log('⚠️  Could not auto-copy to clipboard (please copy manually)');
    }
  }

})();
