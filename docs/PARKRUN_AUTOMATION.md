# Parkrun Automated Scraper

This document explains how to set up automated parkrun data collection using GitHub Actions and Playwright with IP rotation to avoid 403 blocks.

## Overview

You now have **two ways** to collect parkrun data:

1. **Manual Browser Scraper** (existing) - Copy-paste script into browser console
2. **Automated GitHub Actions** (new) - Runs weekly automatically with IP rotation

## Manual Scraper (Existing)

**How to use:**
1. Go to admin panel → Parkrun tab
2. Click "Start Parkrun Sync"
3. Follow the instructions (paste script into browser console)
4. Wait for auto-upload to complete

**Advantages:**
- ✅ Always works (uses your real browser)
- ✅ Never gets blocked
- ✅ No setup required

**Disadvantages:**
- ⚠️ Requires manual action
- ⚠️ Browser must stay open

---

## Automated Scraper (New)

**How it works:**
- GitHub Actions runs every Sunday at 12:00 UTC
- Launches headless Chromium browser with Playwright
- Navigates to parkrun consolidated club page
- Injects the scraper script
- Waits for completion
- Auto-uploads results to your API

**Advantages:**
- ✅ Fully automated
- ✅ Can use proxy/IP rotation to avoid blocks
- ✅ Runs on schedule or manually
- ✅ Logs everything for debugging

**Disadvantages:**
- ⚠️ May get blocked by parkrun (datacenter IPs)
- ⚠️ Requires GitHub secrets setup
- ⚠️ Proxies cost money (optional but recommended)

---

## Setup Instructions

### Step 1: Install Dependencies

Add Playwright to your `package.json`:

```bash
npm install --save-dev playwright
```

### Step 2: Configure GitHub Secrets

Go to your GitHub repo → Settings → Secrets and variables → Actions → New repository secret

Add these secrets:

#### Required:
- **PARKRUN_API_ENDPOINT**
  - Value: `https://strava-club-workers.pedroqueiroz.workers.dev/api/parkrun/import`
  - Description: API endpoint to upload results

#### Optional (for IP rotation):
- **PROXY_URL**
  - Value: See "Proxy Options" section below
  - Description: Proxy server URL for IP rotation

### Step 3: Enable GitHub Actions

The workflow file is already created at `.github/workflows/parkrun-scraper.yml`

**Automatic runs:**
- Runs every Sunday at 12:00 UTC
- Scrapes last 2 weeks of data by default

**Manual runs:**
1. Go to GitHub repo → Actions tab
2. Click "Parkrun Automated Scraper"
3. Click "Run workflow"
4. Optionally specify:
   - Start date (YYYY-MM-DD)
   - End date (YYYY-MM-DD)
   - Replace mode (delete existing data)

---

## IP Rotation / Proxy Options

To avoid 403 blocks, use a proxy service to rotate your IP address.

### Option 1: No Proxy (Free, might get blocked)

Just don't set `PROXY_URL` secret. The scraper will use GitHub's datacenter IPs.

**Success rate:** ~30-50% (parkrun may block datacenter IPs)

### Option 2: Bright Data Residential Proxies (Best)

[Bright Data](https://brightdata.com/) offers residential IP rotation.

**Pricing:** ~$500/month for unlimited

**Setup:**
1. Sign up at brightdata.com
2. Create residential proxy zone
3. Get credentials
4. Set GitHub secret:
```
PROXY_URL=http://brd-customer-USERNAME-zone-ZONE:PASSWORD@brd.superproxy.io:22225
```

**Success rate:** ~95% (residential IPs look like real users)

### Option 3: ScraperAPI (Good)

[ScraperAPI](https://www.scraperapi.com/) handles proxies and retries.

**Pricing:** $49/month for 100k requests

**Setup:**
1. Sign up at scraperapi.com
2. Get API key
3. Set GitHub secret:
```
PROXY_URL=http://scraperapi:YOUR_API_KEY@proxy-server.scraperapi.com:8001
```

**Success rate:** ~85% (smart proxy rotation)

### Option 4: WebShare Free Proxies (Budget)

[WebShare](https://www.webshare.io/) offers 10 free proxies.

**Pricing:** Free (10 proxies), $2.99/month for 100 proxies

**Setup:**
1. Sign up at webshare.io
2. Get proxy list
3. Pick one proxy and set GitHub secret:
```
PROXY_URL=http://USERNAME:PASSWORD@proxy.webshare.io:80
```

**Success rate:** ~60% (datacenter IPs, but might work)

### Option 5: Tor (Experimental)

Use Tor network for IP rotation (slow but free).

**Not recommended** - Too slow and unreliable for 100+ requests.

---

## Testing the Automation

### Test without proxy (first):
1. Go to GitHub Actions
2. Run workflow manually
3. Set start/end date to just 1 week
4. Watch logs to see if it gets blocked

### If blocked, test with proxy:
1. Set up a proxy service (recommend WebShare free trial)
2. Add `PROXY_URL` secret
3. Run workflow again
4. Check logs for success

---

## Monitoring

### View logs:
1. Go to GitHub repo → Actions tab
2. Click on latest workflow run
3. Click "scrape-parkrun" job
4. Expand steps to see logs

### Download detailed logs:
- Logs are saved as artifacts
- Download `parkrun-scraper-logs` from workflow run
- Contains full console output from scraper

### What to look for:
- ✅ `Page loaded successfully (Status: 200)` - Good!
- ❌ `Failed to load parkrun page: 403` - Blocked, need proxy
- ✅ `Scraper completed successfully!` - Working!
- ✅ `All data uploaded successfully` - Perfect!

---

## Troubleshooting

### Problem: Workflow fails with 403 error

**Solution:** parkrun is blocking GitHub's datacenter IPs. Options:
1. Add a proxy (see "Proxy Options" above)
2. Use manual browser scraper instead
3. Try running at different times (less likely to be blocked during off-peak)

### Problem: Playwright times out

**Possible causes:**
- parkrun website is slow
- Too many dates to scrape
- Network issues

**Solution:**
- Reduce date range (scrape smaller chunks)
- Increase timeout in `parkrun-automated.js` (line 162)
- Check parkrun.com is accessible

### Problem: No results uploaded

**Check:**
- API endpoint secret is correct
- Date range includes Saturdays
- Club members have registered with parkrun
- Check workflow logs for upload errors

### Problem: Proxy not working

**Check:**
- Proxy URL format is correct: `http://user:pass@host:port`
- Proxy credentials are valid
- Proxy service has remaining quota/credits

---

## Cost Comparison

| Method | Cost | Setup Time | Reliability | Automation |
|--------|------|------------|-------------|------------|
| Manual browser | Free | 0 min | 100% | No |
| GitHub Actions (no proxy) | Free | 10 min | 30-50% | Yes |
| GitHub + WebShare | $3/month | 20 min | ~60% | Yes |
| GitHub + ScraperAPI | $49/month | 20 min | ~85% | Yes |
| GitHub + Bright Data | $500/month | 20 min | ~95% | Yes |

## Recommendation

**For most users:** Start with **manual browser scraper**. It's free, reliable, and only takes 5 minutes once a week.

**For automation enthusiasts:** Try **GitHub Actions without proxy** first. If it works, great! If blocked, add **WebShare free proxies** ($3/month).

**For production/critical use:** Use **ScraperAPI** ($49/month) for reliable automated collection.

---

## Files

- `.github/workflows/parkrun-scraper.yml` - GitHub Actions workflow
- `scripts/parkrun-automated.js` - Playwright automation script
- `frontend/public/parkrun-smart-scraper.js` - Browser scraper (unchanged, but now signals completion)

---

## Next Steps

1. Test manual scraper first (make sure it still works)
2. Try GitHub Actions without proxy (might work!)
3. If blocked, add a proxy service
4. Monitor weekly to ensure it keeps working
5. Adjust schedule/date range as needed

---

## Support

If you encounter issues:
1. Check workflow logs in GitHub Actions
2. Download artifact logs for details
3. Try manual scraper as fallback
4. Consider reducing date range or adding proxy
