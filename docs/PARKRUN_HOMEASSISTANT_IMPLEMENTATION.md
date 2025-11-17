# Parkrun Automation via Home Assistant Green

## Overview

This guide implements automated parkrun data scraping using a Home Assistant Green device as the execution environment. By running the scraper from your home network with a residential IP address, we bypass AWS WAF blocking that affects GitHub Actions.

**Architecture:**
```
Home Assistant Green (residential IP)
    ↓ (runs weekly automation)
Node.js + Playwright Script
    ↓ (scrapes parkrun.com)
Parkrun Consolidated Club Results
    ↓ (generates CSV)
POST to /api/parkrun/import
    ↓
Strava Results Database Updated
```

**Benefits:**
- ✅ Fully automated (set and forget)
- ✅ Uses residential IP (bypasses AWS WAF)
- ✅ Free (no proxy costs)
- ✅ Runs on dedicated hardware
- ✅ Home Assistant notifications and monitoring
- ✅ Can trigger based on conditions (time, events, etc.)

---

## Prerequisites

- **Home Assistant Green** with SSH access enabled
- **SSH Add-on** installed and configured in Home Assistant
- **API endpoint** deployed and accessible from home network
- **This git repository** (strava_results) cloned and accessible

---

## Implementation Plan

### Phase 1: Strava Repository Setup
1. Create standalone scraper script (no browser needed)
2. Add configuration file template
3. Test script locally
4. Document script usage

### Phase 2: Home Assistant Setup
1. Install Node.js add-on
2. Copy scraper files to HA
3. Create shell command integration
4. Create automation for weekly runs
5. Add notifications

### Phase 3: Testing & Monitoring
1. Test manual run
2. Verify data upload
3. Test weekly automation
4. Set up monitoring dashboard

---

## Phase 1: Strava Repository Changes

### File 1: Create Standalone Scraper Script

**Location:** `scripts/parkrun-homeassistant.js`

This is a modified version of `parkrun-automated.js` optimized for Home Assistant:

```javascript
#!/usr/bin/env node

/**
 * Parkrun Scraper for Home Assistant
 *
 * Runs Playwright automation to scrape parkrun consolidated club results
 * and upload to the Strava Results API.
 *
 * Usage:
 *   node parkrun-homeassistant.js [config-file]
 *
 * Config file: JSON file with configuration (defaults to ./parkrun-config.json)
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// Load configuration
const configPath = process.argv[2] || path.join(__dirname, 'parkrun-config.json');
let config;

try {
  config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  console.log(`✓ Loaded configuration from ${configPath}`);
} catch (error) {
  console.error(`❌ Failed to load configuration from ${configPath}`);
  console.error(`Error: ${error.message}`);
  console.error('\nPlease create parkrun-config.json with the following structure:');
  console.error(JSON.stringify({
    apiEndpoint: 'https://your-api.com/api/parkrun/import',
    clubNumber: '19959',
    startDate: '2024-01-01',
    endDate: '2025-11-17',
    replaceMode: false,
    headless: true,
    timeout: 600000
  }, null, 2));
  process.exit(1);
}

// Validate required config
const required = ['apiEndpoint', 'clubNumber'];
for (const key of required) {
  if (!config[key]) {
    console.error(`❌ Missing required configuration: ${key}`);
    process.exit(1);
  }
}

// Set defaults
config.headless = config.headless !== false; // default true
config.timeout = config.timeout || 600000; // 10 minutes
config.replaceMode = config.replaceMode || false;

// Calculate date range if not specified
if (!config.startDate) {
  // Default: last 2 weeks
  const twoWeeksAgo = new Date();
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
  config.startDate = twoWeeksAgo.toISOString().split('T')[0];
}

if (!config.endDate) {
  // Default: today
  config.endDate = new Date().toISOString().split('T')[0];
}

console.log('\n📋 Configuration:');
console.log(`   API Endpoint: ${config.apiEndpoint}`);
console.log(`   Club Number: ${config.clubNumber}`);
console.log(`   Date Range: ${config.startDate} to ${config.endDate}`);
console.log(`   Replace Mode: ${config.replaceMode}`);
console.log(`   Headless: ${config.headless}`);
console.log(`   Timeout: ${config.timeout}ms\n`);

async function main() {
  const startTime = Date.now();
  let browser;

  try {
    console.log('🚀 Starting Parkrun scraper...\n');

    // Launch browser
    console.log('📦 Launching Chromium browser...');
    browser = await chromium.launch({
      headless: config.headless,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });

    const page = await context.newPage();

    // Set up console logging
    const consoleMessages = [];
    page.on('console', msg => {
      const text = msg.text();
      console.log(`[SCRAPER] ${text}`);
      consoleMessages.push(text);
    });

    // Build parkrun URL with parameters
    const url = new URL(`https://www.parkrun.com/results/consolidatedclub/`);
    url.searchParams.set('clubNum', config.clubNumber);
    url.searchParams.set('startDate', config.startDate);
    url.searchParams.set('endDate', config.endDate);
    url.searchParams.set('apiEndpoint', config.apiEndpoint);
    url.searchParams.set('autoUpload', 'true');
    if (config.replaceMode) {
      url.searchParams.set('replaceMode', 'true');
    }

    console.log(`📡 Navigating to: ${url.toString()}\n`);

    // Navigate to parkrun
    const response = await page.goto(url.toString(), {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    console.log(`✓ Page loaded (Status: ${response.status()})\n`);

    if (response.status() !== 200 && response.status() !== 202) {
      throw new Error(`Failed to load parkrun page: ${response.status()}`);
    }

    // Load the scraper script
    console.log('📜 Loading scraper script...');
    const scraperScript = fs.readFileSync(
      path.join(__dirname, '..', 'frontend', 'public', 'parkrun-smart-scraper.js'),
      'utf8'
    );

    // Inject and execute scraper
    console.log('💉 Injecting scraper into page...\n');
    await page.evaluate(scraperScript);

    console.log('⏳ Waiting for scraper to complete (timeout: ' + (config.timeout / 1000) + 's)...\n');

    // Wait for completion signal
    const completed = await page.waitForFunction(
      () => window.scraperCompleted === true || window.scraperFailed === true,
      { timeout: config.timeout }
    );

    // Check if scraper failed
    const failed = await page.evaluate(() => window.scraperFailed);
    if (failed) {
      const errorMsg = await page.evaluate(() => window.scraperError || 'Unknown error');
      throw new Error(`Scraper failed: ${errorMsg}`);
    }

    console.log('\n✅ Scraper completed successfully!\n');

    // Get results summary
    const summary = await page.evaluate(() => ({
      totalResults: window.scraperResults?.length || 0,
      uploaded: window.scraperUploaded || false
    }));

    console.log('📊 Results Summary:');
    console.log(`   Total Results: ${summary.totalResults}`);
    console.log(`   Uploaded: ${summary.uploaded ? 'Yes' : 'No'}`);

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n⏱️  Total duration: ${duration}s`);

    if (!summary.uploaded) {
      console.warn('\n⚠️  Warning: Data was not uploaded. Check scraper logs above.');
      process.exit(1);
    }

    console.log('\n🎉 All done!\n');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

main();
```

### File 2: Configuration Template

**Location:** `scripts/parkrun-config.template.json`

```json
{
  "apiEndpoint": "https://strava-club-workers.pedroqueiroz.workers.dev/api/parkrun/import",
  "clubNumber": "19959",
  "startDate": "YYYY-MM-DD",
  "endDate": "YYYY-MM-DD",
  "replaceMode": false,
  "headless": true,
  "timeout": 600000
}
```

### File 3: Update Documentation

**Location:** `docs/PARKRUN_AUTOMATION_STATUS.md`

Add a new section at the end:

```markdown
## UPDATE: Home Assistant Solution (2025-11-17)

### ✅ Working Solution Implemented

**What:** Run scraper directly on Home Assistant Green device

**Why it works:**
- Uses residential IP (bypasses AWS WAF)
- No proxy costs
- Fully automated via HA automations
- Native integration with home network

**Implementation:** See `docs/PARKRUN_HOMEASSISTANT_IMPLEMENTATION.md`

**Files:**
- `scripts/parkrun-homeassistant.js` - Standalone scraper for HA
- `scripts/parkrun-config.template.json` - Configuration template

**Status:** Ready for deployment
```

---

## Phase 2: Home Assistant Configuration

### Step 1: Enable SSH Access

**In Home Assistant:**
1. Go to Settings → Add-ons → Terminal & SSH
2. Install "Advanced SSH & Web Terminal" add-on
3. Configure:
   ```yaml
   ssh:
     username: homeassistant
     password: [your-password]
     authorized_keys: [your-ssh-key]
     allow_agent_forwarding: false
     allow_remote_port_forwarding: false
     allow_tcp_forwarding: false
   ```
4. Start the add-on

### Step 2: Install Node.js Add-on

**Option A: Use Node-RED Add-on** (includes Node.js)
1. Go to Settings → Add-ons → Add-on Store
2. Install "Node-RED"
3. This includes Node.js runtime

**Option B: SSH and Install Manually**
```bash
# SSH into Home Assistant
ssh homeassistant@homeassistant.local

# Switch to root
su

# Install Node.js (for Home Assistant OS)
# Note: HA OS uses Alpine Linux
apk add --no-cache nodejs npm
```

### Step 3: Create Directory Structure

**In your Home Assistant configuration repository**, create:

```
config/
  scripts/
    parkrun/
      parkrun-homeassistant.js          # Copy from strava repo
      parkrun-config.json                # Created from template
      package.json                       # Node.js dependencies
      install-dependencies.sh            # Setup script
```

### File: `config/scripts/parkrun/package.json`

```json
{
  "name": "parkrun-scraper-ha",
  "version": "1.0.0",
  "description": "Parkrun scraper for Home Assistant",
  "main": "parkrun-homeassistant.js",
  "scripts": {
    "scrape": "node parkrun-homeassistant.js"
  },
  "dependencies": {
    "playwright": "^1.40.0"
  }
}
```

### File: `config/scripts/parkrun/parkrun-config.json`

```json
{
  "apiEndpoint": "https://strava-club-workers.pedroqueiroz.workers.dev/api/parkrun/import",
  "clubNumber": "19959",
  "startDate": "",
  "endDate": "",
  "replaceMode": false,
  "headless": true,
  "timeout": 600000
}
```

**Note:** Leave `startDate` and `endDate` empty - script will default to last 2 weeks.

### File: `config/scripts/parkrun/install-dependencies.sh`

```bash
#!/bin/bash
# Run this once to set up the scraper on Home Assistant

set -e

echo "🚀 Installing Parkrun Scraper Dependencies..."

cd "$(dirname "$0")"

# Install Node.js dependencies
echo "📦 Installing npm packages..."
npm install

# Install Playwright browsers
echo "🌐 Installing Playwright browsers (this may take a few minutes)..."
npx playwright install chromium
npx playwright install-deps chromium

echo "✅ Installation complete!"
echo ""
echo "To test the scraper, run:"
echo "  node parkrun-homeassistant.js"
```

### Step 4: Create Home Assistant Shell Command

**In your HA configuration repository:**

**File: `config/shell_commands.yaml`** (create if doesn't exist)

```yaml
# Parkrun data scraping
parkrun_scrape: 'cd /config/scripts/parkrun && node parkrun-homeassistant.js 2>&1 | tee /config/logs/parkrun-scraper.log'
```

**File: `config/configuration.yaml`** (add this line if not already included)

```yaml
# Include shell commands
shell_command: !include shell_commands.yaml
```

### Step 5: Create Automation

**File: `config/automations/parkrun_weekly_sync.yaml`** (or add to existing automations.yaml)

```yaml
- id: parkrun_weekly_sync
  alias: "Parkrun - Weekly Data Sync"
  description: "Automatically scrape parkrun data every Sunday at noon"

  trigger:
    - platform: time
      at: "12:00:00"

  condition:
    - condition: time
      weekday:
        - sun

  action:
    # Send notification that scraping is starting
    - service: notify.persistent_notification
      data:
        title: "🏃 Parkrun Scraper"
        message: "Starting weekly parkrun data sync..."

    # Run the scraper
    - service: shell_command.parkrun_scrape

    # Wait a bit for completion (adjust based on your needs)
    - delay: "00:05:00"

    # Send completion notification
    - service: notify.persistent_notification
      data:
        title: "🏃 Parkrun Scraper"
        message: "Weekly parkrun sync completed. Check logs for details."

  mode: single
```

### Step 6: Create Manual Trigger Button

**File: `config/scripts.yaml`** (or add to existing)

```yaml
parkrun_manual_sync:
  alias: "Parkrun - Manual Sync"
  description: "Manually trigger parkrun data scraping"
  sequence:
    - service: notify.persistent_notification
      data:
        title: "🏃 Parkrun Scraper"
        message: "Manual sync started..."

    - service: shell_command.parkrun_scrape

    - delay: "00:01:00"

    - service: notify.persistent_notification
      data:
        title: "🏃 Parkrun Scraper"
        message: "Check /config/logs/parkrun-scraper.log for details"
  mode: single
```

### Step 7: Create Dashboard Card (Optional)

**Add to your dashboard YAML:**

```yaml
type: entities
title: Parkrun Automation
entities:
  - type: button
    name: Run Parkrun Sync Now
    tap_action:
      action: call-service
      service: script.parkrun_manual_sync
    icon: mdi:run-fast

  - type: attribute
    entity: automation.parkrun_weekly_sync
    attribute: last_triggered
    name: Last Auto Sync

  - type: button
    name: View Scraper Logs
    tap_action:
      action: url
      url_path: /config/logs/parkrun-scraper.log
    icon: mdi:file-document
```

### Step 8: Create Logs Directory

**File: `config/scripts/parkrun/create-logs.sh`**

```bash
#!/bin/bash
mkdir -p /config/logs
touch /config/logs/parkrun-scraper.log
chmod 644 /config/logs/parkrun-scraper.log
```

---

## Phase 3: Deployment Instructions

### Step-by-Step Deployment

**1. Prepare files in Strava repository:**

```bash
# In strava_results repository
cd scripts

# Create the Home Assistant version of the scraper
# (create parkrun-homeassistant.js with content from above)

# Create config template
# (create parkrun-config.template.json)

# Test locally first
npm install playwright
node parkrun-homeassistant.js
```

**2. Prepare files in Home Assistant repository:**

```bash
# In your HA config repository
mkdir -p config/scripts/parkrun
cd config/scripts/parkrun

# Copy files from strava repo
cp /path/to/strava_results/scripts/parkrun-homeassistant.js .
cp /path/to/strava_results/scripts/parkrun-config.template.json parkrun-config.json

# Edit parkrun-config.json with your settings
# (update apiEndpoint if needed)

# Create package.json
# (content from above)

# Create install script
# (content from above)
chmod +x install-dependencies.sh

# Add to git
git add .
git commit -m "Add parkrun automation for Home Assistant"
```

**3. Add HA configuration files:**

```bash
# In your HA config repository

# Create/update shell_commands.yaml
# (content from above)

# Update configuration.yaml to include shell commands
# (add line from above if needed)

# Create automation
# (add to automations.yaml or create new file)

# Create script for manual trigger
# (add to scripts.yaml)

# Commit changes
git add .
git commit -m "Add parkrun automation configuration"
git push
```

**4. Deploy to Home Assistant:**

```bash
# SSH into Home Assistant
ssh homeassistant@homeassistant.local

# Switch to root if needed
# (depends on your SSH setup)

# Pull latest HA config
cd /config
git pull

# Install scraper dependencies
cd /config/scripts/parkrun
chmod +x install-dependencies.sh
./install-dependencies.sh

# Create logs directory
mkdir -p /config/logs
touch /config/logs/parkrun-scraper.log

# Test the scraper manually
node parkrun-homeassistant.js

# If successful, reload Home Assistant
# Go to HA UI: Settings → System → Restart → Quick Reload
```

**5. Configure and test:**

```
1. In Home Assistant UI:
   - Go to Settings → Automations & Scenes
   - Verify "Parkrun - Weekly Data Sync" appears
   - Enable the automation

2. Test manual trigger:
   - Go to Settings → Automations & Scenes → Scripts
   - Find "Parkrun - Manual Sync"
   - Click "Run"
   - Check notifications
   - Verify data in your database

3. Check logs:
   - SSH into HA
   - cat /config/logs/parkrun-scraper.log
   - Verify successful completion
```

---

## Testing Checklist

- [ ] Node.js installed on HA Green
- [ ] Playwright installed and browsers downloaded
- [ ] Scraper script runs manually via SSH
- [ ] Shell command works from HA UI
- [ ] Manual script trigger works
- [ ] Notifications appear
- [ ] Data appears in database
- [ ] Log file is created and populated
- [ ] Weekly automation is scheduled
- [ ] Dashboard card displays (if added)

---

## Monitoring & Maintenance

### Check Scraper Status

**Via SSH:**
```bash
ssh homeassistant@homeassistant.local
tail -f /config/logs/parkrun-scraper.log
```

**Via Home Assistant:**
- Check persistent notifications
- View automation history
- Check logbook for script runs

### Troubleshooting

**Scraper fails with "playwright not found":**
```bash
cd /config/scripts/parkrun
npm install
npx playwright install chromium
```

**Permission errors:**
```bash
chmod +x /config/scripts/parkrun/*.sh
chmod 644 /config/scripts/parkrun/*.js
chmod 644 /config/scripts/parkrun/*.json
```

**No data uploaded:**
- Check API endpoint is accessible from HA network
- Verify parkrun-config.json has correct apiEndpoint
- Check logs for upload errors
- Test API endpoint manually with curl

**Automation doesn't trigger:**
- Verify automation is enabled
- Check automation conditions (Sunday, 12:00)
- Look at automation traces in HA UI

### Update Scraper

**When changes are made to parkrun-homeassistant.js:**

```bash
# In strava_results repo
cd scripts
# Make changes to parkrun-homeassistant.js
git commit -am "Update parkrun scraper"

# In HA config repo
cp /path/to/strava_results/scripts/parkrun-homeassistant.js config/scripts/parkrun/
git commit -am "Update parkrun scraper"
git push

# On HA Green
ssh homeassistant@homeassistant.local
cd /config
git pull
# Restart HA if needed
```

---

## Architecture Notes

### Why This Works

1. **Residential IP**: Home Assistant Green uses your home internet connection, which has a residential IP that AWS WAF trusts
2. **Persistent Environment**: Unlike GitHub Actions, the HA device has a consistent environment
3. **Local Network**: No firewall/NAT issues accessing your API
4. **Dedicated Hardware**: HA Green has enough resources to run Playwright
5. **Home Assistant Integration**: Native notifications, logging, and automation

### Security Considerations

1. **API Endpoint**: Ensure your API endpoint is accessible but secured (HTTPS)
2. **SSH Access**: Use SSH keys, not passwords
3. **Logs**: May contain sensitive data - review log rotation
4. **Config File**: Contains API endpoint - keep secure
5. **Updates**: Keep Playwright and Node.js updated

### Performance

**Home Assistant Green specs:**
- CPU: 1.8 GHz quad-core Cortex-A55
- RAM: 4 GB
- Storage: 32 GB eMMC

**Expected performance:**
- Scraping 100 Saturdays: ~3-5 minutes
- Peak memory: ~500 MB
- CPU: Moderate during scraping
- Network: ~10 MB total transfer

### Backup Strategy

**What to backup:**
- `/config/scripts/parkrun/` directory
- `/config/logs/parkrun-scraper.log` (optional)
- Automation and script configuration

**Already backed up if using git:**
- All configuration files are version controlled
- Script files are in both strava and HA repos

---

## Alternative: Docker Container on HA

If you prefer containerization:

**File: `config/docker-compose/parkrun-scraper/docker-compose.yml`**

```yaml
version: '3.8'

services:
  parkrun-scraper:
    image: mcr.microsoft.com/playwright:v1.40.0
    volumes:
      - /config/scripts/parkrun:/app
      - /config/logs:/logs
    working_dir: /app
    command: node parkrun-homeassistant.js
    network_mode: host
```

This provides isolation but adds complexity. Only use if you're already using Docker on HA.

---

## Summary

This implementation:
1. ✅ Solves the AWS WAF blocking issue (residential IP)
2. ✅ Fully automated (weekly runs)
3. ✅ Free (no proxy costs)
4. ✅ Monitored via Home Assistant
5. ✅ Easy to maintain and update
6. ✅ Works on Home Assistant Green

The scraper runs on your HA device every Sunday at noon, scrapes the last 2 weeks of parkrun data, and uploads it to your API - all completely automatically with notifications.

---

## Questions for Implementation

When feeding this to Claude Code, provide answers to:

1. **API Endpoint URL**: What is your full API endpoint URL?
2. **HA SSH Details**: How do you currently access your HA Green (IP, username)?
3. **Notification Preference**: How do you want to be notified (persistent notification, mobile app, email)?
4. **Date Range**: What date range should weekly syncs cover (default: last 2 weeks)?
5. **Git Setup**: Do you already have your HA config in git?
6. **Dashboard**: Do you want the dashboard card added?
7. **Timezone**: What timezone is your HA configured for (affects 12:00 run time)?

---

**End of Implementation Guide**
