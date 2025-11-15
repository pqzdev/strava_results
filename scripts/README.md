# Parkrun Automated Scraper Scripts

This directory contains automation scripts for parkrun data collection.

## Files

- **`parkrun-automated.js`** - Playwright automation script that runs the parkrun scraper in a headless browser

## Usage

### Local Testing

```bash
# Install dependencies first
npm install

# Install Playwright browsers
npx playwright install chromium

# Run the scraper
PARKRUN_API_ENDPOINT=https://your-api.workers.dev/api/parkrun/import \
START_DATE=2024-11-01 \
END_DATE=2024-11-15 \
node scripts/parkrun-automated.js
```

### With Proxy (IP Rotation)

```bash
# Using a proxy to avoid 403 blocks
PARKRUN_API_ENDPOINT=https://your-api.workers.dev/api/parkrun/import \
PROXY_URL=http://username:password@proxy-host:port \
START_DATE=2024-11-01 \
END_DATE=2024-11-15 \
node scripts/parkrun-automated.js
```

### Environment Variables

- `PARKRUN_API_ENDPOINT` - **(Required)** API endpoint to upload results
- `PROXY_URL` - (Optional) Proxy server URL for IP rotation
- `START_DATE` - (Optional) Start date in YYYY-MM-DD format (default: 2 weeks ago)
- `END_DATE` - (Optional) End date in YYYY-MM-DD format (default: today)
- `REPLACE_MODE` - (Optional) Set to 'true' to delete all existing data before scraping

## How It Works

1. Launches headless Chromium browser with Playwright
2. Navigates to parkrun consolidated club page with URL parameters
3. Loads `../frontend/public/parkrun-smart-scraper.js` from disk
4. Injects the scraper script into the page
5. Monitors console output for completion signals:
   - "🎉 All done! All data uploaded successfully"
   - "All data uploaded successfully in batches"
   - "⚠️ No results found"
6. Waits for completion (timeout: 10 minutes)
7. Logs everything to `parkrun-scraper.log`

## GitHub Actions

The automated workflow runs weekly via GitHub Actions.

See `.github/workflows/parkrun-scraper.yml` for configuration.

**Schedule:** Every Sunday at 12:00 UTC

**Manual trigger:** Go to Actions tab → Parkrun Automated Scraper → Run workflow

## Logs

Logs are written to `scripts/parkrun-scraper.log` with timestamps.

GitHub Actions also uploads logs as artifacts for each run.

## Troubleshooting

### 403 Forbidden Error

Parkrun is blocking your IP address. Solutions:
1. Use a proxy (set `PROXY_URL` environment variable)
2. Try a different time of day
3. Fall back to manual browser scraper

### Timeout Error

Scraper took longer than 10 minutes. Solutions:
1. Reduce date range (scrape smaller chunks)
2. Check parkrun.com is accessible
3. Increase timeout in the script (line 214)

### No Results Found

Check that:
- Date range includes Saturdays
- Club number is correct (19959 for Woodstock Runners)
- Club members have registered with parkrun

## See Also

- **Full documentation:** `../docs/PARKRUN_AUTOMATION.md`
- **Manual scraper:** Use admin panel → Parkrun tab
