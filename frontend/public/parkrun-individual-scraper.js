/**
 * Parkrun Individual Athlete Scraper
 *
 * Scrapes all parkrun results for a single athlete from their individual results page.
 * URL format: https://www.parkrun.com.au/parkrunner/[ID]/all/
 *
 * HOW TO USE:
 * 1. Open https://www.parkrun.com.au/parkrunner/[PARKRUN_ID]/all/
 * 2. Open browser console (F12)
 * 3. Paste this script and press Enter
 * 4. Wait for completion
 * 5. Results auto-upload to API
 *
 * FEATURES:
 * - Extracts all parkrun results for the athlete
 * - Includes: Event, Date, Run Number, Position, Time, Age Grade
 * - Note: Individual pages don't include gender position (only club pages have that)
 * - Auto-uploads to API with 'individual' data source flag
 * - Marks results as from individual scraping (not club)
 */

(async function() {
  console.clear();
  console.log('🏃 Parkrun Individual Athlete Scraper v1.0');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // ========== CONFIGURATION ==========
  const urlParams = new URLSearchParams(window.location.search);

  const CONFIG = {
    apiEndpoint: urlParams.get('apiEndpoint') || '', // API endpoint from URL or default
    autoUpload: urlParams.get('autoUpload') !== 'false', // Auto-upload by default
  };

  // ========== EXTRACT PARKRUN ID ==========

  // Extract parkrun ID from URL or page
  let parkrunId = '';
  let athleteName = '';

  // Try to get from URL: /parkrunner/7796495/all/
  const urlMatch = window.location.pathname.match(/\/parkrunner\/(\d+)/);
  if (urlMatch) {
    parkrunId = urlMatch[1];
  }

  // Get athlete name from H2: "Pedro QUEIROZ (A7796495)"
  const h2 = document.querySelector('h2');
  if (h2) {
    const fullText = h2.textContent;
    // Extract name (everything before the ID in parentheses)
    const nameMatch = fullText.match(/^(.+?)\s*\(/);
    if (nameMatch) {
      athleteName = nameMatch[1].trim();
    }
    // Also extract ID from the (A7796495) format as backup
    const idMatch = fullText.match(/\(A(\d+)\)/);
    if (idMatch && !parkrunId) {
      parkrunId = idMatch[1];
    }
  }

  if (!parkrunId) {
    console.error('❌ Could not determine parkrun athlete ID from URL or page');
    console.log('   Make sure you are on a page like: https://www.parkrun.com.au/parkrunner/7796495/all/');
    return;
  }

  console.log('📋 Athlete Information:');
  console.log(`   Parkrun ID: ${parkrunId}`);
  console.log(`   Name: ${athleteName || 'Unknown'}`);
  console.log(`   API Endpoint: ${CONFIG.apiEndpoint || 'None (manual copy)'}`);
  console.log(`   Auto-upload: ${CONFIG.autoUpload ? 'Yes' : 'No'}\n`);

  // ========== FIND AND PARSE RESULTS TABLE ==========

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
    console.log('   Make sure you are on the /all/ page showing all results');
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

    // Remove "parkrun de " prefix FIRST (e.g., "parkrun de Montsouris" → "Montsouris")
    // Must check this BEFORE "parkrun " to avoid leaving "de " prefix
    if (eventName.startsWith('parkrun de ')) {
      eventName = eventName.substring(11); // Remove "parkrun de " (11 characters)
    }
    // Remove "parkrun " prefix (e.g., "parkrun Ogród Saski, Lublin" → "Ogród Saski, Lublin")
    else if (eventName.startsWith('parkrun ')) {
      eventName = eventName.substring(8); // Remove "parkrun " (8 characters)
    }

    eventName = eventName.trim();

    // Apply event name mappings (matches database table)
    const eventNameMappings = {
      'Albert Melbourne': 'Albert, Melbourne',
      'Bushy Park': 'Bushy',
      'Kingsway': 'Kingsway, Gloucester',
      'Presint 18': 'Presint 18, Putrajaya'
    };

    if (eventNameMappings[eventName]) {
      eventName = eventNameMappings[eventName];
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
      'Parkrun ID': parkrunId,
      'parkrunner': athleteName,
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
    console.log('⚠️  No results found');
    window.scraperCompleted = true;
    window.scraperResults = [];
    return;
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

    // Use the API endpoint directly (already set to import-individual by Admin UI)
    const url = new URL(CONFIG.apiEndpoint);

    console.log(`\n📤 Uploading to ${url.toString()}...`);
    console.log(`   Athlete ID: ${parkrunId}`);
    console.log(`   Results: ${results.length}\n`);

    try {
      // Create a File object from CSV data
      const blob = new Blob([csvData], { type: 'text/csv' });
      const file = new File([blob], `parkrun-individual-${parkrunId}.csv`, { type: 'text/csv' });

      // Create FormData
      const formData = new FormData();
      formData.append('file', file);
      formData.append('parkrun_athlete_id', parkrunId);
      formData.append('athlete_name', athleteName);

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
      console.log('   CSV data is still available below');
      return false;
    }
  }

  // Upload if auto-upload is enabled
  let uploadSuccess = false;
  if (CONFIG.autoUpload && CONFIG.apiEndpoint) {
    uploadSuccess = await uploadToAPI(csvData);
  }

  // ========== SHOW CSV IF UPLOAD FAILED OR DISABLED ==========

  if (!uploadSuccess) {
    console.log('\n📋 CSV OUTPUT:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(csvData);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('\n💡 TIP: Click in the CSV above, press Ctrl+A (or Cmd+A), then Ctrl+C (or Cmd+C) to copy');

    // Also copy to clipboard if possible
    if (navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(csvData);
        console.log('✅ CSV copied to clipboard!');
      } catch (e) {
        console.log('⚠️  Could not auto-copy to clipboard (please copy manually)');
      }
    }
  }

  // Signal completion for automation
  window.scraperCompleted = true;
  window.scraperResults = results;
  window.scraperUploaded = uploadSuccess;

  console.log('\n🎉 Done!\n');

})();
