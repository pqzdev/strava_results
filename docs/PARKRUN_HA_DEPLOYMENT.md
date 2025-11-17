# Parkrun Home Assistant Deployment Guide

## Quick Deployment Steps

Now that the POC test passed, here's how to deploy the full automation.

---

## Step 1: Copy Files to Home Assistant

```bash
# SSH into Home Assistant
ssh pedro@homeassistant11.local

# Create config file from template
cd /config/scripts/parkrun
cat > parkrun-config.json <<'EOF'
{
  "apiEndpoint": "https://strava-club-workers.pedroqueiroz.workers.dev/api/parkrun/import",
  "clubNumber": "19959",
  "startDate": "",
  "endDate": "",
  "replaceMode": false,
  "headless": true,
  "timeout": 600000,
  "executablePath": "/usr/bin/chromium-browser"
}
EOF

# Copy the full scraper script
cat > parkrun-homeassistant.js <<'ENDOFFILE'
[COPY CONTENT FROM /Users/pqz/Code/strava_results/scripts/parkrun-homeassistant.js]
ENDOFFILE

# Make it executable
chmod +x parkrun-homeassistant.js

# Verify files
ls -la /config/scripts/parkrun/
```

**OR** use git to get the files:

```bash
# On HA, pull the strava_results repo
cd /config
git clone https://github.com/kalvinoz/strava_results.git submodules/strava_results

# Copy scripts
cp submodules/strava_results/scripts/parkrun-homeassistant.js scripts/parkrun/
cp submodules/strava_results/scripts/parkrun-config.template.json scripts/parkrun/parkrun-config.json

# Edit the config if needed
vi scripts/parkrun/parkrun-config.json
```

---

## Step 2: Copy the Smart Scraper JavaScript

The scraper needs access to `parkrun-smart-scraper.js`:

```bash
# On HA
cd /config/scripts/parkrun

# Clone or copy from strava_results
cp /config/submodules/strava_results/frontend/public/parkrun-smart-scraper.js .

# OR create a symlink
ln -s /config/submodules/strava_results/frontend/public/parkrun-smart-scraper.js parkrun-smart-scraper.js
```

---

## Step 3: Update Path in Script

Since we're running from `/config/scripts/parkrun` instead of the strava repo structure, update the script:

```bash
# Edit parkrun-homeassistant.js
vi parkrun-homeassistant.js

# Find this line (around line 159):
# const scraperScript = fs.readFileSync(
#   path.join(__dirname, '..', 'frontend', 'public', 'parkrun-smart-scraper.js'),
#   'utf8'
# );

# Change to:
# const scraperScript = fs.readFileSync(
#   path.join(__dirname, 'parkrun-smart-scraper.js'),
#   'utf8'
# );
```

---

## Step 4: Pull Latest HA Config from GitHub

```bash
# On HA
cd /config
git pull origin main

# OR from HA UI:
# Go to Settings → Automations & Scenes → Scripts
# Run: [Git] Force Sync from GitHub
```

---

## Step 5: Reload Home Assistant Configuration

From Home Assistant UI:
1. Go to **Settings → System**
2. Click **Restart**
3. Choose **Quick reload** (or full restart)

OR run the reload script:
- Go to **Settings → Automations & Scenes → Scripts**
- Run: **[Git] Force Sync from GitHub**

---

## Step 6: Test the Scraper

### Manual Test via SSH:

```bash
cd /config/scripts/parkrun
node parkrun-homeassistant.js

# Check the log
cat /config/logs/parkrun-scraper.log
```

### Test via HA UI:

1. Go to **Settings → Automations & Scenes → Scripts**
2. Find **[Parkrun] Remote Scrape**
3. Click **Run**
4. Wait for notifications
5. Check logs at `/config/logs/parkrun-scraper.log`

---

## Step 7: Test from Admin Dashboard

1. Rebuild and deploy your frontend:
   ```bash
   cd /Users/pqz/Code/strava_results/frontend
   npm run build
   npm run deploy
   ```

2. Open the admin dashboard:
   ```
   https://strava-club-results.pages.dev/admin
   ```

3. Go to **Parkrun** tab

4. You should see two buttons:
   - **🖥️ Manual Scraping** (purple) - Opens parkrun in browser for manual paste
   - **☁️ Remote Scrape** (green) - Opens HA and shows instructions

5. Click **☁️ Remote Scrape** to test

---

## Step 8: Enable Weekly Automation (Optional)

The automation is already created, just verify it's enabled:

1. Go to **Settings → Automations & Scenes → Automations**
2. Find **Parkrun - Weekly Data Sync**
3. Make sure it's **enabled** (toggle should be on)
4. It will run every **Sunday at 12:00 noon**

---

## Configuration Options

Edit `/config/scripts/parkrun/parkrun-config.json`:

```json
{
  "apiEndpoint": "https://strava-club-workers.pedroqueiroz.workers.dev/api/parkrun/import",
  "clubNumber": "19959",
  "startDate": "",          // Leave empty for "last 2 weeks"
  "endDate": "",            // Leave empty for "today"
  "replaceMode": false,     // Set true to delete all existing data
  "headless": true,         // Set false for debugging (shows browser)
  "timeout": 600000,        // 10 minutes (600000ms)
  "executablePath": "/usr/bin/chromium-browser"  // Required for Alpine
}
```

---

## Troubleshooting

### "parkrun-smart-scraper.js not found"

```bash
# Verify the file exists
ls -la /config/scripts/parkrun/parkrun-smart-scraper.js

# If missing, copy it:
cp /config/submodules/strava_results/frontend/public/parkrun-smart-scraper.js /config/scripts/parkrun/
```

### "chromium-browser not found"

```bash
# Verify chromium is installed
which chromium-browser

# Should show: /usr/bin/chromium-browser
```

### Script fails with errors

```bash
# Check the full log
cat /config/logs/parkrun-scraper.log

# Run manually to see live output
cd /config/scripts/parkrun
node parkrun-homeassistant.js
```

### Automation doesn't trigger

1. Check automation is enabled in HA UI
2. Check automation traces: Settings → Automations → Parkrun - Weekly Data Sync → Traces
3. Verify time zone is correct

---

## Monitoring

### View Logs:

```bash
ssh pedro@homeassistant11.local
cat /config/logs/parkrun-scraper.log
```

### Check Last Run:

In HA UI:
- Go to **Settings → Automations & Scenes → Automations**
- Click on **Parkrun - Weekly Data Sync**
- See **Last Triggered** timestamp

### Check Notifications:

- HA sends persistent notifications on start and completion
- View in HA UI notification panel (bell icon)

---

## What Was Implemented

✅ Full scraper script with Alpine Chromium support
✅ Config-based setup (JSON file)
✅ Shell command integration
✅ Manual trigger script with HA notifications
✅ Weekly automation (Sunday at noon)
✅ Admin dashboard buttons (Manual & Remote)
✅ POC test confirmed residential IP bypasses AWS WAF

---

## Summary

You now have:
1. **Manual trigger** from HA Scripts UI
2. **Weekly automation** every Sunday at noon
3. **Admin dashboard integration** with Remote Scrape button
4. **Full logging** to `/config/logs/parkrun-scraper.log`
5. **HA notifications** on start/completion

The residential IP from your Home Assistant successfully bypasses AWS WAF blocking!

---

**End of Deployment Guide**
