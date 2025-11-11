# Parkrun Automated Sync - Complete Solution

## Overview

This solution allows you to automatically scrape and import parkrun data directly from the Admin dashboard with configurable date ranges. The data is automatically uploaded to your database without manual CSV handling.

## Features

- ✅ **One-click sync** from Admin dashboard
- ✅ **Configurable date range** (start and end dates)
- ✅ **Automatic upload** to your API
- ✅ **Bypasses parkrun blocking** (runs in browser)
- ✅ **Includes special dates** (Dec 25, Jan 1)
- ✅ **Progress tracking** in console
- ✅ **Duplicate handling** (safe to run multiple times)

## How to Use

### Browser Console Method

1. Go to **Admin Dashboard**
2. Set your date range
3. Click **"🏃 Sync Parkrun Data"** button
4. In the parkrun tab that opens:
   - Press **F12** to open console
   - Copy and paste this code:
     ```javascript
     fetch(window.location.origin + '/parkrun-smart-scraper.js').then(r=>r.text()).then(eval);
     ```
   - Press **Enter**
5. Wait for completion
6. Results automatically uploaded!

## What Gets Synced

The scraper automatically fetches:

- **All Saturdays** in your selected date range
- **December 25** (Christmas parkrun)
- **January 1** (New Year parkrun)
- Only **Woodstock Runners** club members

## Configuration

### Date Range

Default settings in Admin dashboard:
- **Start Date:** `2024-01-01` (beginning of 2024)
- **End Date:** Today's date (auto-updates)

You can adjust these to:
- Sync historical data: Set start date earlier
- Sync specific period: Set custom date range
- Update recent data: Set start date to last sync date

### Performance

- **~100 dates** (Saturdays since 2024-01-01): ~3-4 minutes
- **~50 dates** (last 6 months): ~2 minutes
- **~10 dates** (last 2 months): ~30 seconds

The scraper adds 2-second delays between requests to be respectful to parkrun's servers.

## Technical Details

### Architecture

```
Admin Dashboard
    ↓ (sets date range)
Opens Parkrun Tab (with URL params)
    ↓ (user clicks bookmarklet)
Loads Scraper Script from /parkrun-smart-scraper.js
    ↓ (reads URL params)
Fetches Results from Parkrun
    ↓ (generates CSV)
POSTs to /api/parkrun/import
    ↓
Database Updated
```

### URL Parameters

When you click "Sync Parkrun Data", the parkrun page opens with these parameters:

```
?clubNum=19959
&startDate=2024-01-01
&endDate=2025-11-10
&apiEndpoint=https://your-site.com/api/parkrun/import
&autoUpload=true
```

The scraper reads these parameters and:
1. Fetches all Saturdays between start and end dates
2. Scrapes each date from parkrun
3. Generates CSV
4. Uploads to your API endpoint

### Files

| File | Purpose |
|------|---------|
| `/frontend/src/pages/Admin.tsx` | Admin UI with sync button and date pickers |
| `/frontend/public/parkrun-smart-scraper.js` | Main scraper script (served statically) |
| `/workers/src/api/parkrun-import.ts` | API endpoint that receives CSV uploads |

### Security

- ✅ Runs in your browser (not server-side)
- ✅ Uses your browser's cookies and session
- ✅ No API keys exposed
- ✅ CORS-compliant
- ✅ Same-origin for script loading

### Error Handling

The scraper handles:
- **Network failures**: Retries up to 2 times
- **Missing data**: Logs and skips
- **Upload failures**: Falls back to manual CSV download
- **Duplicate entries**: Database handles via `ON CONFLICT DO NOTHING`

## Troubleshooting

### "Please allow popups"
- Your browser is blocking the parkrun tab
- Allow popups for your site
- Try again

### "Failed to load scraper"
- Make sure `/parkrun-smart-scraper.js` is accessible
- Check browser console for CORS errors
- Verify the file is in `/frontend/public/`

### "Upload failed"
- Check network tab for API errors
- Verify `/api/parkrun/import` endpoint is working
- Check database connection

### No results found
- Verify date range includes Saturdays
- Check club number (19959 for Woodstock)
- Look at console logs for details

### Scraper doesn't run
- Make sure you're on the parkrun page
- Try manually running the fetch command in console
- Check for JavaScript errors

## Maintenance

### Updating the Scraper

1. Edit `/frontend/public/parkrun-smart-scraper.js`
2. Deploy frontend

### Monitoring

Check console logs for:
- Progress updates: `[1/102] 0% - 2024-01-06`
- Results found: `✓ Found 12 results`
- Upload success: `✅ UPLOAD SUCCESSFUL!`
- Errors: `❌ Failed: ...`

### Database

All results are stored in `parkrun_results` table:
- Duplicates are automatically skipped
- Safe to run sync multiple times
- Manual edits in database are preserved

## Future Enhancements

Potential improvements:
- 🔄 Background sync (service worker)
- 📊 Sync history dashboard
- 🔔 Notifications when sync completes
- 📅 Auto-sync on schedule
- 🎯 Individual athlete sync

## Support

For issues:
1. Check browser console for errors
2. Verify date range and club number
3. Test with smaller date range
4. Check `/api/parkrun/import` endpoint manually

## Credits

- Built for Woodstock Runners
- Uses parkrun's public consolidated club results
- Respects parkrun's servers with delays
- Open source scraping approach
