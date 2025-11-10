/**
 * Parkrun Browser Console Scraper
 *
 * HOW TO USE:
 * 1. Open https://www.parkrun.com/results/consolidatedclub/?clubNum=19959&eventdate=2025-10-25
 * 2. Open browser console (F12 or Ctrl+Shift+J)
 * 3. Paste this entire script and press Enter
 * 4. Copy the CSV output that appears
 * 5. Save as a .csv file
 * 6. Upload to your parkrun page
 */

(function() {
  console.log('Starting Parkrun data extraction for Woodstock Runners...');

  // Find the results table
  const tables = document.querySelectorAll('table');
  let resultsTable = null;

  // Find the table with results (usually has headers like Runner, Time, etc.)
  for (const table of tables) {
    const headers = table.querySelectorAll('th');
    const headerText = Array.from(headers).map(h => h.textContent.trim().toLowerCase());

    if (headerText.includes('runner') || headerText.includes('parkrunner') ||
        headerText.includes('athlete') || headerText.includes('time')) {
      resultsTable = table;
      break;
    }
  }

  if (!resultsTable) {
    console.error('Could not find results table');
    return;
  }

  console.log('Found results table');

  // Get headers
  const headerRow = resultsTable.querySelector('thead tr') || resultsTable.querySelector('tr');
  const headers = Array.from(headerRow.querySelectorAll('th, td')).map(h => h.textContent.trim());

  console.log('Table headers:', headers);

  // Find column indices
  const colIndex = {
    date: headers.findIndex(h => /date/i.test(h)),
    event: headers.findIndex(h => /event/i.test(h)),
    pos: headers.findIndex(h => /pos/i.test(h) || /position/i.test(h)),
    runner: headers.findIndex(h => /runner|parkrunner|athlete|name/i.test(h)),
    time: headers.findIndex(h => /time/i.test(h)),
    ageGrade: headers.findIndex(h => /age.*grade/i.test(h)),
    ageCat: headers.findIndex(h => /age.*cat/i.test(h)),
    club: headers.findIndex(h => /club/i.test(h)),
  };

  console.log('Column mapping:', colIndex);

  // Extract data rows
  const tbody = resultsTable.querySelector('tbody') || resultsTable;
  const rows = Array.from(tbody.querySelectorAll('tr')).slice(headerRow ? 1 : 0);

  console.log(`Found ${rows.length} total rows`);

  const results = [];

  rows.forEach((row, index) => {
    const cells = Array.from(row.querySelectorAll('td'));

    if (cells.length === 0) return; // Skip empty rows

    // Extract data
    const date = colIndex.date >= 0 ? cells[colIndex.date]?.textContent.trim() : '';
    const event = colIndex.event >= 0 ? cells[colIndex.event]?.textContent.trim() : '';
    const pos = colIndex.pos >= 0 ? cells[colIndex.pos]?.textContent.trim() : '';
    const runner = colIndex.runner >= 0 ? cells[colIndex.runner]?.textContent.trim() : '';
    const time = colIndex.time >= 0 ? cells[colIndex.time]?.textContent.trim() : '';
    const ageGrade = colIndex.ageGrade >= 0 ? cells[colIndex.ageGrade]?.textContent.trim() : '';
    const ageCat = colIndex.ageCat >= 0 ? cells[colIndex.ageCat]?.textContent.trim() : '';
    const club = colIndex.club >= 0 ? cells[colIndex.club]?.textContent.trim() : '';

    // Filter for Woodstock Runners only
    if (club && /woodstock/i.test(club)) {
      results.push({
        Date: date,
        Event: event,
        Pos: pos,
        parkrunner: runner,
        Time: time,
        'Age Grade': ageGrade,
        'Age Cat': ageCat,
        Club: club
      });
    }
  });

  console.log(`Found ${results.length} Woodstock Runners results`);

  if (results.length === 0) {
    console.warn('No Woodstock Runners found. The page might use a different structure.');
    console.log('Here\'s a sample of the first row for debugging:');
    if (rows.length > 0) {
      const firstRow = rows[0];
      const cells = Array.from(firstRow.querySelectorAll('td'));
      cells.forEach((cell, i) => {
        console.log(`Cell ${i}: "${cell.textContent.trim()}"`);
      });
    }
    return;
  }

  // Convert to CSV
  const csvHeaders = ['Date', 'Event', 'Pos', 'parkrunner', 'Time', 'Age Grade', 'Age Cat'];
  const csvRows = [csvHeaders.join(',')];

  results.forEach(result => {
    const row = csvHeaders.map(header => {
      const value = result[header] || '';
      // Escape commas and quotes
      if (value.includes(',') || value.includes('"')) {
        return `"${value.replace(/"/g, '""')}"`;
      }
      return value;
    });
    csvRows.push(row.join(','));
  });

  const csv = csvRows.join('\n');

  console.log('\n=== CSV OUTPUT (Copy everything below) ===\n');
  console.log(csv);
  console.log('\n=== END CSV OUTPUT ===\n');
  console.log(`\nTotal results: ${results.length}`);
  console.log('Instructions:');
  console.log('1. Copy the CSV output above (between the === markers)');
  console.log('2. Save it as a .csv file (e.g., parkrun-results.csv)');
  console.log('3. Upload to your parkrun page');

  // Also copy to clipboard if available
  if (navigator.clipboard) {
    navigator.clipboard.writeText(csv).then(() => {
      console.log('✓ CSV copied to clipboard!');
    }).catch(err => {
      console.log('Could not copy to clipboard:', err);
    });
  }

  return {
    totalResults: results.length,
    csv: csv,
    results: results
  };
})();
