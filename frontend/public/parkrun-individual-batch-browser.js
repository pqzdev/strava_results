/**
 * Parkrun Individual Athlete Batch Scraper - Browser Version
 *
 * Automatically scrapes all athletes' individual parkrun histories
 * by navigating through each athlete's page in sequence.
 *
 * HOW TO USE:
 * 1. Open https://www.parkrun.com.au/parkrunner/ANYID/all/
 * 2. Open browser console (F12)
 * 3. Paste this script and press Enter
 * 4. The script will automatically cycle through all athletes
 *
 * FEATURES:
 * - Fetches list of athletes from API
 * - Automatically navigates to each athlete's page
 * - Scrapes and uploads results
 * - Shows progress
 * - Handles errors gracefully
 */

(async function() {
  console.clear();
  console.log('🏃 Parkrun Individual Batch Scraper (Browser) v1.0');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // ========== CONFIGURATION ==========
  const urlParams = new URLSearchParams(window.location.search);

  const CONFIG = {
    apiEndpoint: urlParams.get('apiEndpoint') || 'https://strava-club-workers.pedroqueiroz.workers.dev/api/parkrun/import-individual',
    athletesApiEndpoint: urlParams.get('athletesApiEndpoint') || 'https://strava-club-workers.pedroqueiroz.workers.dev/api/parkrun/athletes-to-scrape',
    mode: urlParams.get('mode') || 'all', // 'new' or 'all'
    delayBetweenAthletes: parseInt(urlParams.get('delay') || '3000'), // 3 seconds between athletes
    autoNavigate: urlParams.get('autoNavigate') !== 'false', // Auto-navigate to next athlete
  };

  console.log('📋 Configuration:');
  console.log(`   API Endpoint: ${CONFIG.apiEndpoint}`);
  console.log(`   Athletes API: ${CONFIG.athletesApiEndpoint}`);
  console.log(`   Mode: ${CONFIG.mode} (${CONFIG.mode === 'new' ? 'only unscraped athletes' : 'all athletes'})`);
  console.log(`   Delay between athletes: ${CONFIG.delayBetweenAthletes}ms`);
  console.log(`   Auto-navigate: ${CONFIG.autoNavigate ? 'Yes' : 'No'}\n`);

  // ========== FETCH ATHLETES TO SCRAPE ==========

  console.log('📊 Fetching athletes to scrape...');

  let athletes = [];
  try {
    const url = new URL(CONFIG.athletesApiEndpoint);
    url.searchParams.set('mode', CONFIG.mode);

    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }

    const data = await response.json();
    athletes = data.athletes || [];

    console.log(`✓ Found ${athletes.length} athletes to scrape\n`);

    if (athletes.length === 0) {
      console.log('⚠️  No athletes to scrape');
      if (CONFIG.mode === 'new') {
        console.log('   All athletes have already been scraped!');
        console.log('   Use mode=all to re-scrape everyone.');
      }
      return;
    }

  } catch (error) {
    console.error('❌ Failed to fetch athletes:', error.message);
    console.log('\nℹ️  You can manually provide athletes by setting window.athletesToScrape');
    console.log('   Example: window.athletesToScrape = [{parkrun_athlete_id: "123", athlete_name: "John"}]');
    return;
  }

  // ========== GET CURRENT ATHLETE INDEX ==========

  // Extract current athlete ID from URL
  const urlMatch = window.location.pathname.match(/\/parkrunner\/(\d+)/);
  const currentAthleteId = urlMatch ? urlMatch[1] : null;

  // Find current athlete in the list
  let currentIndex = -1;
  if (currentAthleteId) {
    currentIndex = athletes.findIndex(a => a.parkrun_athlete_id === currentAthleteId);
  }

  // If not found or first run, start at 0
  if (currentIndex === -1) {
    currentIndex = 0;
    console.log('⚠️  Current athlete not in list, starting from first athlete\n');
  }

  const currentAthlete = athletes[currentIndex];

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📍 Current Progress: ${currentIndex + 1}/${athletes.length}`);
  console.log(`🏃 Athlete: ${currentAthlete.athlete_name} (${currentAthlete.parkrun_athlete_id})`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  // ========== SCRAPE CURRENT ATHLETE ==========

  console.log('🔍 Looking for results table...\n');

  // Find the "All Results" table
  let resultsTable = null;
  const tables = document.querySelectorAll('table#results');

  for (const table of tables) {
    const caption = table.querySelector('caption');
    if (caption && caption.textContent.includes('All') && caption.textContent.includes('Results')) {
      resultsTable = table;
      break;
    }
  }

  if (!resultsTable) {
    console.error('❌ Could not find the "All Results" table on this page');
    console.log('   Make sure you are on the /all/ page showing all results\n');

    // Move to next athlete anyway
    if (CONFIG.autoNavigate && currentIndex + 1 < athletes.length) {
      await moveToNextAthlete(athletes, currentIndex);
    }
    return;
  }

  console.log('✓ Found results table\n');

  // ========== EXTRACT RESULTS ==========

  const results = [];
  const tbody = resultsTable.querySelector('tbody');

  if (!tbody) {
    console.error('❌ No table body found');
    return;
  }

  const rows = Array.from(tbody.querySelectorAll('tr'));
  console.log(`📊 Found ${rows.length} result rows\n`);

  for (const row of rows) {
    const cells = Array.from(row.querySelectorAll('td'));

    // Expected columns: Event | Run Date | Run Number | Pos | Time | Age Grade | PB?
    if (cells.length < 7) {
      console.warn('⚠️  Skipping row with insufficient columns:', cells.length);
      continue;
    }

    // Extract data from cells
    const eventCell = cells[0];
    const dateCell = cells[1];
    const runNumberCell = cells[2];
    const positionCell = cells[3];
    const timeCell = cells[4];
    const ageGradeCell = cells[5];
    const pbCell = cells[6];

    // Event name (from link text)
    const eventLink = eventCell.querySelector('a');
    let eventName = eventLink ? eventLink.textContent.trim() : eventCell.textContent.trim();

    // Normalize specific event names
    // "Presint 18" should always be "Presint 18, Putrajaya"
    if (eventName === 'Presint 18') {
      eventName = 'Presint 18, Putrajaya';
    }
    // "Albert Melbourne" should always be "Albert, Melbourne"
    if (eventName === 'Albert Melbourne') {
      eventName = 'Albert, Melbourne';
    }

    // Date (from span.format-date)
    const dateSpan = dateCell.querySelector('span.format-date');
    const dateText = dateSpan ? dateSpan.textContent.trim() : dateCell.textContent.trim();

    // Parse date from DD/MM/YYYY to YYYY-MM-DD
    let isoDate = '';
    if (dateText) {
      const dateParts = dateText.split('/');
      if (dateParts.length === 3) {
        const [day, month, year] = dateParts;
        isoDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      }
    }

    // Run number (event number)
    const runNumber = runNumberCell.textContent.trim();

    // Position
    const position = positionCell.textContent.trim();

    // Time
    const time = timeCell.textContent.trim();

    // Age Grade (remove % sign)
    let ageGrade = ageGradeCell.textContent.trim();
    if (ageGrade.endsWith('%')) {
      ageGrade = ageGrade.slice(0, -1);
    }

    // PB indicator (check if cell has content besides whitespace)
    const isPB = pbCell.textContent.trim() !== '';

    // Skip if essential data is missing
    if (!eventName || !isoDate || !time) {
      console.warn('⚠️  Skipping row with missing essential data:', {eventName, date: isoDate, time});
      continue;
    }

    // Build result object
    const result = {
      'Parkrun ID': currentAthlete.parkrun_athlete_id,
      'parkrunner': currentAthlete.athlete_name,
      'Event': eventName,
      'Date': isoDate,
      'Run Number': runNumber,
      'Pos': position,
      'Time': time,
      'Age Grade': ageGrade,
      'PB': isPB ? 'Yes' : '',
      'Data Source': 'individual'
    };

    results.push(result);
  }

  console.log(`✅ Extracted ${results.length} results\n`);

  if (results.length === 0) {
    console.log('⚠️  No results found for this athlete');
  }

  // ========== CONVERT TO CSV ==========

  function convertToCSV(data) {
    if (data.length === 0) return '';

    const headers = Object.keys(data[0]);
    const csvRows = [headers.join(',')];

    for (const row of data) {
      const values = headers.map(header => {
        const value = row[header] || '';
        // Escape commas and quotes
        if (value.includes(',') || value.includes('"') || value.includes('\n')) {
          return `"${value.replace(/"/g, '""')}"`;
        }
        return value;
      });
      csvRows.push(values.join(','));
    }

    return csvRows.join('\n');
  }

  const csvData = convertToCSV(results);

  // ========== UPLOAD TO API ==========

  async function uploadToAPI(csvData) {
    if (!CONFIG.apiEndpoint) {
      console.log('\n⚠️  No API endpoint configured, skipping upload');
      return false;
    }

    const url = new URL(CONFIG.apiEndpoint);

    console.log(`\n📤 Uploading to ${url.toString()}...`);
    console.log(`   Athlete ID: ${currentAthlete.parkrun_athlete_id}`);
    console.log(`   Results: ${results.length}\n`);

    try {
      // Create a File object from CSV data
      const blob = new Blob([csvData], { type: 'text/csv' });
      const file = new File([blob], `parkrun-individual-${currentAthlete.parkrun_athlete_id}.csv`, { type: 'text/csv' });

      // Create FormData
      const formData = new FormData();
      formData.append('file', file);
      formData.append('parkrun_athlete_id', currentAthlete.parkrun_athlete_id);
      formData.append('athlete_name', currentAthlete.athlete_name);

      const response = await fetch(url.toString(), {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
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
      console.log(`   New results added: ${result.new_results_added || 0}`);
      console.log(`   Duplicates skipped: ${result.duplicates_skipped || 0}`);
      return true;

    } catch (error) {
      console.error('❌ Upload failed:', error.message);
      return false;
    }
  }

  // Upload results
  let uploadSuccess = false;
  if (results.length > 0) {
    uploadSuccess = await uploadToAPI(csvData);
  } else {
    console.log('ℹ️  No results to upload');
    uploadSuccess = true; // Consider it successful even with no results
  }

  // ========== MOVE TO NEXT ATHLETE ==========

  async function moveToNextAthlete(athletes, currentIndex) {
    const nextIndex = currentIndex + 1;

    if (nextIndex >= athletes.length) {
      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('🎉 ALL ATHLETES COMPLETE!');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
      console.log(`✅ Scraped ${athletes.length} athletes total`);
      return;
    }

    const nextAthlete = athletes[nextIndex];

    console.log(`\n⏳ Waiting ${CONFIG.delayBetweenAthletes}ms before next athlete...\n`);
    await new Promise(resolve => setTimeout(resolve, CONFIG.delayBetweenAthletes));

    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`📍 Moving to athlete ${nextIndex + 1}/${athletes.length}`);
    console.log(`🏃 Next: ${nextAthlete.athlete_name} (${nextAthlete.parkrun_athlete_id})`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    // Build next URL
    const nextUrl = new URL(`https://www.parkrun.com.au/parkrunner/${nextAthlete.parkrun_athlete_id}/all/`);
    nextUrl.searchParams.set('apiEndpoint', CONFIG.apiEndpoint);
    nextUrl.searchParams.set('athletesApiEndpoint', CONFIG.athletesApiEndpoint);
    nextUrl.searchParams.set('mode', CONFIG.mode);
    nextUrl.searchParams.set('delay', CONFIG.delayBetweenAthletes.toString());
    nextUrl.searchParams.set('autoNavigate', 'true');

    console.log(`🌐 Navigating to: ${nextUrl.toString()}\n`);

    // Navigate to next athlete's page
    window.location.href = nextUrl.toString();
  }

  // Move to next athlete if auto-navigate is enabled
  if (CONFIG.autoNavigate && currentIndex + 1 < athletes.length) {
    await moveToNextAthlete(athletes, currentIndex);
  } else if (currentIndex + 1 >= athletes.length) {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🎉 ALL ATHLETES COMPLETE!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log(`✅ Scraped ${athletes.length} athletes total`);
  } else {
    console.log('\n✓ Current athlete complete');
    console.log(`\nℹ️  Auto-navigate is disabled. To continue:`);
    console.log(`   1. Manually navigate to next athlete's page`);
    console.log(`   2. Or enable auto-navigate with: ?autoNavigate=true`);
  }

})();
