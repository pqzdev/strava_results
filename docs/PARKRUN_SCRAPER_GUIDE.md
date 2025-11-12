# Parkrun Data Scraper - Complete Guide

## Overview

This guide covers how to extract parkrun data for Woodstock Runners club using the browser-based scraper that bypasses parkrun's anti-scraping protection.

## Why Browser-Based?

Parkrun actively blocks automated scraping from servers (returns HTTP 403/450 errors). However, fetching data from the browser console works because:
- Requests include your browser's cookies and session
- Requests appear to come from a real browser with normal headers
- You're already logged in and have access to the data

## Quick Start

### Step 1: Open Parkrun Page

Navigate to:
```
https://www.parkrun.com/results/consolidatedclub/?clubNum=19959
```

This is the Woodstock Runners consolidated club results page.

### Step 2: Open Browser Console

- **Chrome/Edge**: Press `F12` or `Ctrl+Shift+J` (Windows) / `Cmd+Option+J` (Mac)
- **Firefox**: Press `F12` or `Ctrl+Shift+K`
- **Safari**: Enable Developer menu, then press `Cmd+Option+C`

### Step 3: Run the Scraper

1. Go to your deployed site at `https://woodstock-results.pages.dev/parkrun-smart-scraper.js`
2. Copy the entire script contents
3. Paste into the browser console
4. Press Enter

Alternatively, open the file at `/Users/pqz/Code/strava_results/frontend/public/parkrun-smart-scraper.js` and copy its contents.

The scraper will automatically:
- Collect data from every Saturday since January 1, 2024
- Include special dates: December 25 and January 1 (Christmas/New Year parkruns)
- Add 2-second delays between requests (respectful to parkrun)
- Show progress in the console
- Generate a CSV file

### Step 4: Wait for Completion

The script will process approximately:
- **~100 Saturdays** (from 2024-01-01 to today)
- **2 special dates** (Dec 25, Jan 1)
- **Total time: ~3-4 minutes** (with 2-second delays)

You'll see progress like:
```
[1/102] 0% - 2024-01-06
  ✓ Found 12 results
[2/102] 1% - 2024-01-13
  ✓ Found 15 results
...
```

### Step 5: Copy the CSV

When complete, the console will show:
```
=== CSV OUTPUT (Copy everything below) ===

Date,Event,Pos,parkrunner,Time,Age Grade,Age Cat
2024-01-06,Bushy Park,15,John Doe,21:30,75.5%,SM35-39
...

=== END CSV OUTPUT ===

✓ CSV copied to clipboard!
```

The CSV is automatically copied to your clipboard. If not, manually copy the text between the `===` markers.

### Step 6: Save and Upload

1. Create a new file: `parkrun-results.csv`
2. Paste the CSV data
3. Go to your parkrun dashboard page
4. Upload the CSV file

## Configuration

You can customize the scraper by editing these values at the top of the script:

```javascript
const CONFIG = {
  clubNum: 19959,              // Woodstock Runners club number
  startDate: '2024-01-01',     // Start date for data collection
  endDate: new Date().toISOString().split('T')[0], // Today
  delayBetweenRequests: 2000,  // Milliseconds between requests (2 seconds)
  clubNameFilter: /woodstock/i, // Only include Woodstock runners
  maxRetries: 2,               // Retry failed requests
  includeSpecialDates: ['2024-12-25', '2025-01-01'], // Christmas/New Year
};
```

### To collect different date ranges:

```javascript
// Last 3 months only
startDate: new Date(Date.now() - 90*24*60*60*1000).toISOString().split('T')[0]

// Specific year
startDate: '2023-01-01'
endDate: '2023-12-31'

// Since club founding
startDate: '2020-01-01'
```

## Troubleshooting

### "No results found"
- Check that dates are Saturdays (parkrun typically runs on Saturdays)
- Verify club number (19959 for Woodstock Runners)
- Try a more recent date range

### "Failed: HTTP 403"
- Very rare when running in browser, but can happen if:
  - You make too many requests too quickly (reduce `delayBetweenRequests`)
  - Parkrun detects unusual activity (wait and try again)
  - Your session expired (refresh the page and re-run)

### "Error parsing row"
- Parkrun changed their table structure
- Open an issue with the new table format
- The scraper can be updated to match new structure

### Script doesn't run
- Make sure you copied the entire script
- Check browser console for syntax errors
- Try refreshing the page and running again

## Technical Details

### How It Works

1. **Date Generation**: Calculates all Saturdays in the date range plus special dates
2. **Fetch Loop**: For each date:
   - Fetches HTML using browser's native `fetch()` API
   - Includes cookies and session automatically
   - Parses HTML using `DOMParser`
   - Extracts results from table
   - Filters for Woodstock Runners only
3. **CSV Generation**: Converts all results to CSV format
4. **Clipboard**: Automatically copies to clipboard

### Why It's Fast

- No page reloads (stays in one tab)
- Parallel HTML parsing (doesn't block)
- Efficient DOM queries
- Minimal memory footprint

### Anti-Detection Features

- Uses browser's native `fetch()` with credentials
- Adds realistic delays between requests
- Includes proper HTTP headers
- Mimics human browsing behavior
- Respects parkrun's servers

## Data Format

The generated CSV has these columns:

| Column | Description | Example |
|--------|-------------|---------|
| Date | Event date | 2024-01-06 |
| Event | Parkrun location | Bushy Park |
| Pos | Overall position | 15 |
| parkrunner | Runner name | John Doe |
| Time | Finish time | 21:30 |
| Age Grade | Age-graded performance | 75.5% |
| Age Cat | Age category | SM35-39 |

## Advanced Usage

### Run Multiple Times

The scraper handles duplicates gracefully. You can:
1. Run for 2024 data first
2. Upload to dashboard
3. Run again for 2025 data
4. Upload again (duplicates are automatically handled)

### Export for Analysis

Save the CSV and open in:
- Excel / Google Sheets for analysis
- Python pandas for data science
- R for statistics
- Your own scripts

### Monitor Progress

The console shows detailed stats:
```
📊 Statistics:
   • Dates processed: 102/102
   • Successful: 98
   • Failed: 4
   • Total results: 1,234
   • Time taken: 3m 24s
   • Average: 12.6 results per date
```

## Support

If you encounter issues:
1. Check this guide first
2. Verify the parkrun website structure hasn't changed
3. Try a smaller date range to test
4. Check browser console for detailed error messages

## Updates

The latest version of the scraper is available at `https://woodstock-results.pages.dev/parkrun-smart-scraper.js` or in the source code at `/Users/pqz/Code/strava_results/frontend/public/parkrun-smart-scraper.js`.

Version history:
- **v2.0** (2025-11-10): Multi-date support, special dates, progress tracking
- **v1.0** (2025-10-25): Initial single-page scraper
