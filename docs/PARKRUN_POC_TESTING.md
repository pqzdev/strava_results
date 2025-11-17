# Parkrun POC Testing Guide

## Overview

This guide walks through testing whether running the parkrun scraper from your Home Assistant Green can bypass the AWS WAF blocking that affects GitHub Actions.

**Goal:** Verify that using a residential IP (via Home Assistant) allows successful access to parkrun.com.

---

## Prerequisites

Before running the POC test, ensure:

1. **Home Assistant SSH access** is enabled
2. **Node.js and npm** are installed on HA
3. **Git repository** is set up and synced
4. **Scripts directory** exists at `/config/scripts/parkrun`

---

## POC Test Setup

### Step 1: Prepare the Test Files

**In your local strava_results repository:**

```bash
cd /Users/pqz/Code/strava_results
git add scripts/parkrun-poc-test.js
git commit -m "Add parkrun POC test script"
git push
```

**In your local homeassistant repository:**

```bash
cd /Users/pqz/Code/homeassistant
git add configuration/shell_command.yaml scripts/yaml/scripts.yaml
git commit -m "Add parkrun POC test configuration"
git push
```

### Step 2: Deploy to Home Assistant

**Option A: Use git sync script from HA UI**

1. Open Home Assistant at http://homeassistant11.local:8123
2. Go to Settings → Automations & Scenes → Scripts
3. Find and run: `[Git] Force Sync from GitHub`
4. Wait for notification that sync is complete

**Option B: SSH into HA manually**

```bash
ssh homeassistant@homeassistant11.local

# Pull latest configuration
cd /config
git pull origin main

# Reload configuration
# (You'll need to reload automations and scripts from the UI)
```

### Step 3: Create parkrun Directory and Copy Files

**SSH into Home Assistant:**

```bash
ssh homeassistant@homeassistant11.local

# Create parkrun scripts directory
mkdir -p /config/scripts/parkrun

# Create logs directory if it doesn't exist
mkdir -p /config/logs

# Copy test script from strava_results (you'll need to transfer this)
# For now, we'll create it directly
```

**Copy the test script to HA:**

Since the test script is in `strava_results` (not the HA repo), you have two options:

**Option 1: Add strava_results as a submodule to HA repo** (Recommended)

```bash
cd /Users/pqz/Code/homeassistant
git submodule add https://github.com/kalvinoz/strava_results.git submodules/strava_results
git commit -m "Add strava_results as submodule for parkrun scripts"
git push

# Then on HA:
cd /config
git pull
git submodule update --init --recursive

# Create symlink to the script
ln -s /config/submodules/strava_results/scripts/parkrun-poc-test.js /config/scripts/parkrun/parkrun-poc-test.js
```

**Option 2: Copy the file directly via SSH**

From your local machine:

```bash
scp /Users/pqz/Code/strava_results/scripts/parkrun-poc-test.js homeassistant@homeassistant11.local:/config/scripts/parkrun/
```

### Step 4: Install Dependencies on HA

**SSH into Home Assistant:**

```bash
ssh homeassistant@homeassistant11.local

cd /config/scripts/parkrun

# Create package.json
cat > package.json <<'EOF'
{
  "name": "parkrun-scraper-poc",
  "version": "1.0.0",
  "description": "Parkrun POC test for Home Assistant",
  "dependencies": {
    "playwright": "^1.40.0"
  }
}
EOF

# Install dependencies (this may take a few minutes)
npm install

# Install Playwright browsers
npx playwright install chromium
npx playwright install-deps chromium

# Make script executable
chmod +x parkrun-poc-test.js
```

---

## Running the POC Test

### Method 1: From Home Assistant UI (Recommended)

1. Open Home Assistant at http://homeassistant11.local:8123
2. Go to **Settings → Automations & Scenes → Scripts**
3. Find **[Parkrun] POC Test**
4. Click **Run**
5. You'll see a notification that the test is starting
6. Wait 30 seconds for the test to complete
7. Check the completion notification

**View Results:**

- **Log file:** SSH into HA and run: `cat /config/logs/parkrun-poc-test.log`
- **Screenshot:** Visit http://homeassistant11.local:8123/local/parkrun-poc-test.png

### Method 2: Via SSH (For debugging)

```bash
ssh homeassistant@homeassistant11.local

cd /config/scripts/parkrun
node parkrun-poc-test.js

# View the log
cat /config/logs/parkrun-poc-test.log
```

---

## Understanding the Test Results

### ✅ Success Indicators

If the test succeeds, you should see:

```
✅ Test 1: PASSED - Homepage loaded (Status: 200)
✅ Test 2: PASSED - Results page loaded (Status: 200)
✅ Test 3: PASSED - Found table element on page
✅ Screenshot saved to: /config/www/parkrun-poc-test.png
🎉 POC TEST COMPLETE - All tests passed!
✅ CONCLUSION: Home Assistant CAN access parkrun.com
✅ This residential IP successfully bypasses AWS WAF!
✅ You can proceed with full implementation
```

**This means:** Your residential IP bypasses the AWS WAF! You can proceed with the full implementation.

### ❌ Failure Indicators

If you see these messages, the test failed:

```
❌ Test 2: FAILED - 403 Forbidden (AWS WAF blocked us)
❌ POC TEST FAILED
⚠️  CONCLUSION: Could not access parkrun from this network
```

**This means:** Even from your home network, parkrun is blocking access. This could mean:
- Parkrun has tightened their WAF rules
- Your ISP's IP range is blocked
- There's a different issue (network, DNS, etc.)

### Screenshot Verification

Open the screenshot at: http://homeassistant11.local:8123/local/parkrun-poc-test.png

**What to look for:**
- ✅ You should see the parkrun consolidated club results page
- ✅ Should see a table or "no results found" message
- ❌ If you see "403 Forbidden" or AWS WAF message, the test failed

---

## Troubleshooting

### "playwright: command not found"

```bash
cd /config/scripts/parkrun
npm install
npx playwright install chromium
```

### "Permission denied" errors

```bash
chmod +x /config/scripts/parkrun/parkrun-poc-test.js
chmod 755 /config/scripts/parkrun
chmod 755 /config/logs
```

### "No such file or directory: /config/scripts/parkrun"

```bash
mkdir -p /config/scripts/parkrun
# Copy the script again
```

### Script runs but no screenshot appears

Check if the www directory exists:

```bash
ls -la /config/www
# If it doesn't exist:
mkdir -p /config/www
chmod 755 /config/www
```

### Script times out

The test script has a 30-second timeout. If it's timing out:

```bash
# Run directly via SSH to see detailed output
cd /config/scripts/parkrun
node parkrun-poc-test.js
```

---

## Next Steps

### If POC Test Passes ✅

**Congratulations!** You can proceed with the full implementation:

1. Follow the guide in [PARKRUN_HOMEASSISTANT_IMPLEMENTATION.md](./PARKRUN_HOMEASSISTANT_IMPLEMENTATION.md)
2. Create the full scraper script (parkrun-homeassistant.js)
3. Set up weekly automation
4. Configure data upload to your API

### If POC Test Fails ❌

Consider these alternatives:

1. **Retry at different times** - AWS WAF rules might change
2. **Try from a different network** - Mobile hotspot, VPN, etc.
3. **Check parkrun status** - Visit parkrun.com manually to ensure it's accessible
4. **Review logs** - Check `/config/logs/parkrun-poc-test.log` for specific errors
5. **Use the individual scraper approach** - See [PARKRUN_INDIVIDUAL_SCRAPING.md](./PARKRUN_INDIVIDUAL_SCRAPING.md)

---

## Clean Up (Optional)

If you want to remove the POC test after completing it:

```bash
# Remove from HA
ssh homeassistant@homeassistant11.local
rm /config/scripts/parkrun/parkrun-poc-test.js
rm /config/logs/parkrun-poc-test.log
rm /config/www/parkrun-poc-test.png

# Remove from git repos (locally)
# In homeassistant repo:
cd /Users/pqz/Code/homeassistant
# Edit configuration/shell_command.yaml - remove parkrun_poc_test line
# Edit scripts/yaml/scripts.yaml - remove parkrun_poc_test section
git commit -am "Remove parkrun POC test"
git push

# In strava_results repo:
cd /Users/pqz/Code/strava_results
rm scripts/parkrun-poc-test.js
git commit -am "Remove parkrun POC test"
git push
```

---

## Quick Reference

**Test script location:** `/config/scripts/parkrun/parkrun-poc-test.js`
**Log location:** `/config/logs/parkrun-poc-test.log`
**Screenshot location:** `/config/www/parkrun-poc-test.png`
**Screenshot URL:** http://homeassistant11.local:8123/local/parkrun-poc-test.png

**Run test from UI:** Settings → Automations & Scenes → Scripts → [Parkrun] POC Test
**Run test from SSH:** `cd /config/scripts/parkrun && node parkrun-poc-test.js`
**View logs:** `cat /config/logs/parkrun-poc-test.log`

---

**End of POC Testing Guide**
