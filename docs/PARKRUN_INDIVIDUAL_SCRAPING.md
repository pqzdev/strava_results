# Parkrun Individual Athlete Scraping

## Overview

This system scrapes individual parkrun history for each athlete from their personal results page. This captures results from **before** they joined Woodstock Runners, which don't appear in the consolidated club results.

## Why Individual Scraping?

**Problem:** Runners only appear in consolidated club results starting from when they join Woodstock Runners. Their parkrun history from before joining is missing.

**Solution:** Scrape each athlete's individual parkrun results page to capture their complete history.

**Example:** If Pedro joined Woodstock Runners in 2025 but has been doing parkrun since 2022, consolidated club results only show 2025 onwards. Individual scraping gets the 2022-2024 results too.

## Architecture

```
1. Consolidated Club Scraping (existing)
   ↓ Captures current club members and their parkrun IDs

2. Individual Athlete Scraping (new)
   ↓ For each athlete with parkrun ID:
   - Navigate to https://www.parkrun.com.au/parkrunner/[ID]/all/
   - Extract all parkrun results from table
   - Mark as data_source='individual'
   - Skip duplicates (already have from club scraping)

3. Database
   ↓ Stores both club and individual results
   - data_source='club' → from consolidated club results
   - data_source='individual' → from individual athlete pages
```

## Files Created

### Database Migration
**File:** `database/migrations/0025_add_individual_athlete_scraping.sql`
- Adds `data_source` column to `parkrun_results` (club/individual)
- Creates `parkrun_athlete_scraping_log` table to track which athletes have been scraped

### Browser Scraper
**File:** `frontend/public/parkrun-individual-scraper.js`
- Runs in browser on athlete's /all/ page
- Extracts all results from table
- Auto-uploads to API

### Batch Automation Script
**File:** `scripts/parkrun-individual-batch.js`
- Playwright automation script
- Scrapes multiple athletes in sequence
- Modes: 'new' (only unscraped) or 'all' (full refresh)

### API Endpoints
**Files:**
- `workers/src/api/parkrun-import-individual.ts` - Import individual results
- `workers/src/api/parkrun-athletes-to-scrape.ts` - Get list of athletes to scrape

### Configuration
**File:** `scripts/parkrun-individual-config.template.json`
- Template for batch scraper configuration

---

## Usage

### Method 1: Manual Browser Scraping (Single Athlete)

**Use case:** Scrape one athlete's history manually

**Steps:**
1. Navigate to athlete's page: `https://www.parkrun.com.au/parkrunner/[ID]/all/`
2. Open browser console (F12)
3. Run:
   ```javascript
   fetch(window.location.origin + '/parkrun-individual-scraper.js').then(r=>r.text()).then(eval);
   ```
4. Wait for completion
5. Results auto-upload to database

**Parameters:**
- `apiEndpoint` - API URL (can add to URL params)
- `autoUpload` - true/false (default: true)

---

### Method 2: Batch Scraping (Multiple Athletes)

**Use case:** Scrape many athletes automatically

#### Setup

1. **Create config file:**
   ```bash
   cd scripts
   cp parkrun-individual-config.template.json parkrun-individual-config.json
   ```

2. **Edit config:**
   ```json
   {
     "apiEndpoint": "https://your-api.com/api/parkrun/import-individual",
     "dbPath": "./database/club.sqlite",
     "headless": true,
     "delayBetweenAthletes": 3000,
     "timeout": 300000
   }
   ```

#### Scrape New Athletes Only

Only scrapes athletes who haven't been scraped yet:

```bash
cd scripts
node parkrun-individual-batch.js parkrun-individual-config.json new
```

#### Full Refresh (All Athletes)

Re-scrapes everyone (updates existing data):

```bash
cd scripts
node parkrun-individual-batch.js parkrun-individual-config.json all
```

---

### Method 3: Home Assistant Automation

**Use case:** Automated weekly scraping on residential IP

See `PARKRUN_HOMEASSISTANT_IMPLEMENTATION.md` for full guide.

**Quick setup:**

1. Copy `parkrun-individual-batch.js` to HA device
2. Create automation to run weekly (after club scraping)
3. Use mode='new' to only scrape new members

**Example automation:**
```yaml
- id: parkrun_individual_weekly_scrape
  alias: "Parkrun - Weekly Individual Scrape"
  trigger:
    - platform: time
      at: "14:00:00"  # 2 hours after club scrape
  condition:
    - condition: time
      weekday:
        - sun
  action:
    - service: shell_command.parkrun_individual_scrape
```

**Shell command:**
```yaml
parkrun_individual_scrape: 'cd /config/scripts/parkrun && node parkrun-individual-batch.js parkrun-individual-config.json new 2>&1 | tee /config/logs/parkrun-individual.log'
```

---

## Data Source Tracking

### Database Column: `data_source`

Every parkrun result has a `data_source` column:

- **`club`** - From consolidated club results
  - Has gender position
  - Only includes results after joining Woodstock

- **`individual`** - From athlete's individual page
  - No gender position (individual pages don't show it)
  - Includes complete parkrun history

### Duplicate Handling

**Scenario:** Athlete has result in both club and individual scraping

**Behavior:**
- If `data_source='club'` exists, individual scraping **updates** it with additional fields
- Otherwise, inserts as `data_source='individual'`

**SQL logic:**
```sql
INSERT INTO parkrun_results (...)
VALUES (...)
ON CONFLICT(athlete_name, event_name, event_number, date) DO UPDATE SET
  parkrun_athlete_id = COALESCE(parkrun_athlete_id, excluded.parkrun_athlete_id),
  time_seconds = excluded.time_seconds,
  -- ... other fields ...
WHERE data_source = 'club'
```

This preserves club data (which has gender position) while adding missing historical results.

---

## Scraping Log

### Table: `parkrun_athlete_scraping_log`

Tracks which athletes have been scraped:

| Column | Type | Description |
|--------|------|-------------|
| `parkrun_athlete_id` | TEXT | Athlete's parkrun ID |
| `athlete_name` | TEXT | Athlete name |
| `last_scraped_at` | INTEGER | Unix timestamp of last scrape |
| `scrape_count` | INTEGER | How many times scraped |
| `total_results_found` | INTEGER | Results found in last scrape |
| `new_results_added` | INTEGER | New results added in last scrape |
| `status` | TEXT | success/failed/pending |
| `error_message` | TEXT | Error if failed |

### Checking Scrape Status

**Get athletes never scraped:**
```sql
SELECT DISTINCT pr.parkrun_athlete_id, pr.athlete_name
FROM parkrun_results pr
LEFT JOIN parkrun_athlete_scraping_log log
  ON pr.parkrun_athlete_id = log.parkrun_athlete_id
WHERE pr.parkrun_athlete_id IS NOT NULL
  AND log.parkrun_athlete_id IS NULL
```

**Get failed scrapes:**
```sql
SELECT * FROM parkrun_athlete_scraping_log
WHERE status = 'failed'
ORDER BY last_scraped_at DESC
```

**Get scrape statistics:**
```sql
SELECT
  COUNT(*) as total_scraped,
  SUM(total_results_found) as total_results,
  AVG(total_results_found) as avg_results_per_athlete,
  MAX(last_scraped_at) as most_recent_scrape
FROM parkrun_athlete_scraping_log
WHERE status = 'success'
```

---

## API Endpoints

### POST /api/parkrun/import-individual

Import individual athlete results from CSV.

**Parameters:**
- `file` (FormData) - CSV file with results
- `parkrun_athlete_id` (string) - Athlete's parkrun ID
- `athlete_name` (string) - Athlete's name

**CSV Format:**
```csv
Parkrun ID,parkrunner,Event,Date,Run Number,Pos,Time,Age Grade,PB,Data Source
7796495,Pedro QUEIROZ,GreenWay,2024-01-27,254,164,28:06,48.58%,,individual
```

**Response:**
```json
{
  "success": true,
  "parkrun_athlete_id": "7796495",
  "athlete_name": "Pedro QUEIROZ",
  "total_results": 24,
  "new_results_added": 18,
  "duplicates_skipped": 6,
  "errors": 0
}
```

---

### GET /api/parkrun/athletes-to-scrape

Get list of athletes that need scraping.

**Parameters:**
- `mode` (query) - 'new' or 'all'
  - `new` - Only athletes never scraped (or failed)
  - `all` - All athletes with parkrun IDs

**Response:**
```json
{
  "mode": "new",
  "count": 15,
  "athletes": [
    {
      "parkrun_athlete_id": "7796495",
      "athlete_name": "Pedro QUEIROZ"
    },
    ...
  ]
}
```

---

## Workflow

### Initial Setup

1. **Run consolidated club scraper** (captures current members + parkrun IDs)
2. **Run individual batch scraper** with mode='new' (gets historical data)
3. **Check results** - everyone should have complete history now

### Weekly Maintenance

1. **Sunday 12:00** - Consolidated club scraper runs (gets latest results)
2. **Sunday 14:00** - Individual batch scraper runs with mode='new' (scrapes new members only)

### Monthly/Quarterly Refresh

Optionally run full refresh to catch any corrections:

```bash
node parkrun-individual-batch.js parkrun-individual-config.json all
```

This re-scrapes everyone, updating times if parkrun made corrections.

---

## Troubleshooting

### No athletes to scrape

**Problem:** `getAthletesToScrape` returns empty list

**Causes:**
1. No parkrun IDs in database yet
   - Solution: Run consolidated club scraper first
2. All athletes already scraped
   - Solution: Use mode='all' to refresh

**Check:**
```sql
SELECT COUNT(DISTINCT parkrun_athlete_id)
FROM parkrun_results
WHERE parkrun_athlete_id IS NOT NULL
```

### 404 Not Found

**Problem:** Athlete page returns 404

**Causes:**
1. Wrong domain (.com.au vs .com vs .co.uk)
   - Solution: Update script to handle multiple domains
2. Athlete ID doesn't exist
   - Solution: Check parkrun_athlete_id is correct

**Check:** Manually visit `https://www.parkrun.com.au/parkrunner/[ID]/all/`

### Scraper times out

**Problem:** Scraper doesn't complete within timeout

**Causes:**
1. Athlete has many results (1000+)
2. Slow network
3. parkrun site slow

**Solution:** Increase timeout in config:
```json
{
  "timeout": 600000  // 10 minutes instead of 5
}
```

### Duplicates not merging

**Problem:** Results appear twice (club + individual)

**Causes:**
1. Athlete name mismatch (e.g., "SMITH John" vs "John SMITH")
2. Event name normalization issue

**Check:**
```sql
SELECT athlete_name, event_name, date, COUNT(*) as duplicates
FROM parkrun_results
GROUP BY athlete_name, event_name, event_number, date
HAVING COUNT(*) > 1
```

**Solution:** Normalize names before import, or update UNIQUE constraint logic

---

## Performance

### Single Athlete
- **Time:** ~5-10 seconds
- **Network:** ~100KB
- **CPU:** Low (browser rendering)

### Batch Scraping
For 50 athletes:
- **Time:** ~15 minutes (with 3s delays)
- **Memory:** ~500MB (Playwright + browser)
- **Network:** ~5MB total

**Bottlenecks:**
- Delays between athletes (respectful scraping)
- Page load time
- Parkrun site responsiveness

**Optimization:**
- Reduce `delayBetweenAthletes` if parkrun can handle it
- Run in parallel (multiple browser instances) - **not recommended** (could trigger rate limiting)

---

## Maintenance

### Database Migration

Run migration before first use:

```bash
# If using wrangler
wrangler d1 execute club --file=database/migrations/0025_add_individual_athlete_scraping.sql

# Or manually apply to your database
sqlite3 database/club.sqlite < database/migrations/0025_add_individual_athlete_scraping.sql
```

### Monitoring

**Check scrape status:**
```sql
SELECT
  status,
  COUNT(*) as count,
  SUM(new_results_added) as total_new_results
FROM parkrun_athlete_scraping_log
GROUP BY status
```

**Find athletes with most parkruns:**
```sql
SELECT
  athlete_name,
  COUNT(*) as total_parkruns,
  MIN(date) as first_parkrun,
  MAX(date) as latest_parkrun
FROM parkrun_results
WHERE parkrun_athlete_id IS NOT NULL
GROUP BY athlete_name
ORDER BY total_parkruns DESC
LIMIT 20
```

### Cleanup

**Remove old failed scrapes:**
```sql
DELETE FROM parkrun_athlete_scraping_log
WHERE status = 'failed'
  AND last_scraped_at < strftime('%s', 'now', '-30 days')
```

---

## Future Enhancements

### Potential Improvements

1. **Multi-domain support**
   - Detect athlete's home parkrun country
   - Use correct domain (.com.au, .com, .co.uk, etc.)

2. **Smart re-scraping**
   - Only re-scrape if new results likely (weekly on Saturday)
   - Skip if last scrape was recent

3. **Progress tracking**
   - Real-time progress updates during batch scraping
   - Web dashboard showing scrape status

4. **Error recovery**
   - Retry failed athletes automatically
   - Alert on repeated failures

5. **Incremental scraping**
   - Only fetch new results since last scrape
   - Faster for regular updates

---

## Summary

### Quick Start

**For new setup:**
```bash
# 1. Run club scraper to get athlete IDs
node parkrun-homeassistant.js

# 2. Scrape individual histories
node parkrun-individual-batch.js parkrun-individual-config.json new

# 3. Verify
# Check database for data_source='individual' results
```

**For weekly maintenance:**
```bash
# Automated via Home Assistant or cron
# Sunday 12:00 - Club scraper
# Sunday 14:00 - Individual scraper (new only)
```

### Key Points

- ✅ Captures complete parkrun history (before joining club)
- ✅ Tracks data source (club vs individual)
- ✅ Prevents duplicates
- ✅ Logs scraping status
- ✅ Supports batch and manual scraping
- ✅ Works with Home Assistant automation

---

**Questions?** Check the code comments or raise an issue on GitHub.
