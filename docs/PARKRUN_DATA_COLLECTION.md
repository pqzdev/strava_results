# Parkrun Data Collection Guide

Parkrun blocks automated scraping from servers (403/450 errors), but you can collect data using these methods:

## Method 1: Smart Browser Scraper (Recommended - Multi-Date)

**Best for:** Collecting data from multiple dates automatically (e.g., all Saturdays since 2024)

### Quick Start:

1. **Open parkrun page:**
   ```
   https://www.parkrun.com/results/consolidatedclub/?clubNum=19959
   ```

2. **Open Browser Console:**
   - Chrome/Edge: `F12` or `Ctrl+Shift+J` (Windows) / `Cmd+Option+J` (Mac)
   - Firefox: `F12` or `Ctrl+Shift+K`
   - Safari: Enable Developer menu, then `Cmd+Option+C`

3. **Get the scraper:**
   - Go to `https://strava-club-results.pages.dev/parkrun-smart-scraper.js`
   - Copy the entire script
   - Paste into the browser console

4. **Press Enter** - The script will automatically:
   - Fetch data from every Saturday since January 1, 2024
   - Include special dates (Dec 25, Jan 1)
   - Add delays to be respectful to parkrun's servers
   - Show progress in console (~3-4 minutes for 100+ dates)
   - Copy CSV to clipboard when complete

5. **Save and upload:**
   - CSV is automatically copied to clipboard
   - Save as `parkrun-results.csv`
   - Upload to your parkrun dashboard

See [PARKRUN_SCRAPER_GUIDE.md](./PARKRUN_SCRAPER_GUIDE.md) for detailed instructions.

---

## Method 2: Manual CSV Export (If parkrun provides it)

Some parkrun pages offer a "Download CSV" or "Export" button. If available:

1. Click the export button
2. Save the CSV file
3. Upload directly to your parkrun page

## Method 3: Python Script (Alternative - May Be Blocked)

If you need to collect data for many dates, create a local Python script:

```python
#!/usr/bin/env python3
"""
Parkrun bulk collector - Run locally to avoid server blocking
"""

import requests
from bs4 import BeautifulSoup
import csv
from datetime import datetime, timedelta
import time

CLUB_NUM = 19959
BASE_URL = "https://www.parkrun.com/results/consolidatedclub/"

def get_saturdays(start_date, num_weeks):
    """Generate list of Saturday dates"""
    saturdays = []
    current = datetime.strptime(start_date, "%Y-%m-%d")

    # Find next Saturday
    days_until_saturday = (5 - current.weekday()) % 7
    if days_until_saturday == 0 and current.weekday() != 5:
        days_until_saturday = 7
    current = current + timedelta(days=days_until_saturday)

    for i in range(num_weeks):
        saturdays.append(current.strftime("%Y-%m-%d"))
        current += timedelta(days=7)

    return saturdays

def fetch_results(date):
    """Fetch results for a specific date"""
    url = f"{BASE_URL}?clubNum={CLUB_NUM}&eventdate={date}"

    headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
                      'AppleWebKit/537.36 (KHTML, like Gecko) '
                      'Chrome/120.0.0.0 Safari/537.36'
    }

    print(f"Fetching {date}...")
    response = requests.get(url, headers=headers)

    if response.status_code != 200:
        print(f"  ❌ Failed: {response.status_code}")
        return []

    soup = BeautifulSoup(response.content, 'html.parser')

    # Find results table
    table = soup.find('table')
    if not table:
        print(f"  ⚠️  No table found")
        return []

    results = []
    rows = table.find_all('tr')[1:]  # Skip header

    for row in rows:
        cells = row.find_all('td')
        if len(cells) < 5:
            continue

        # Adjust indices based on actual table structure
        # Typical: Date, Event, Pos, Runner, Time, Age Grade, Age Cat, Club
        try:
            result = {
                'Date': cells[0].text.strip(),
                'Event': cells[1].text.strip(),
                'Pos': cells[2].text.strip(),
                'parkrunner': cells[3].text.strip(),
                'Time': cells[4].text.strip(),
                'Age Grade': cells[5].text.strip() if len(cells) > 5 else '',
                'Age Cat': cells[6].text.strip() if len(cells) > 6 else '',
            }

            # Filter for Woodstock only
            club_cell = cells[7].text.strip() if len(cells) > 7 else ''
            if 'Woodstock' in club_cell or 'woodstock' in club_cell:
                results.append(result)

        except Exception as e:
            print(f"  ⚠️  Error parsing row: {e}")
            continue

    print(f"  ✓ Found {len(results)} Woodstock results")
    return results

def main():
    # Get last 12 weeks of Saturdays
    start_date = "2024-08-01"  # Start date
    num_weeks = 12

    saturdays = get_saturdays(start_date, num_weeks)

    all_results = []

    for date in saturdays:
        results = fetch_results(date)
        all_results.extend(results)

        # Be nice to parkrun's servers
        time.sleep(2)

    # Save to CSV
    if all_results:
        filename = f"parkrun-{CLUB_NUM}-bulk.csv"
        with open(filename, 'w', newline='') as f:
            writer = csv.DictWriter(f, fieldnames=[
                'Date', 'Event', 'Pos', 'parkrunner', 'Time',
                'Age Grade', 'Age Cat'
            ])
            writer.writeheader()
            writer.writerows(all_results)

        print(f"\n✓ Saved {len(all_results)} results to {filename}")
        print(f"Upload this file to your parkrun page")
    else:
        print("\n❌ No results found")

if __name__ == "__main__":
    main()
```

Save as `parkrun_collector.py` and run:
```bash
pip install requests beautifulsoup4
python parkrun_collector.py
```

---

## Expected CSV Format

Your CSV should have these columns (in any order):

```csv
Date,Event,Pos,parkrunner,Time,Age Grade,Age Cat
10/25/2025,Bushy Park #1234,15,John Doe,21:30,75.5%,SM35-39
10/25/2025,Hackney Marshes #567,23,Jane Smith,23:45,82.1%,SW30-34
```

The import system is flexible and will find columns by name (case-insensitive).

---

## Troubleshooting

### "No results found"
- Check that the date is a Saturday
- Verify the club number (19959 for Woodstock)
- Try a different date when you know people ran

### "Failed: 403/450"
- Parkrun is blocking automated requests
- Use the browser console method instead
- Try adding delays between requests (Python script)

### "Wrong data imported"
- Check CSV format matches expected columns
- Ensure club filtering is working
- Verify date format is correct

---

## Tips

1. **Start with recent dates** - More likely to have data
2. **Check one date first** - Verify the format works before bulk import
3. **Use browser method for small batches** - Faster for 1-5 dates
4. **Use Python for bulk** - Better for 10+ dates
5. **Upload incrementally** - The system handles duplicates, so you can upload multiple times

---

## Support

If you encounter issues:
1. Check the browser console for errors
2. Verify the table structure hasn't changed
3. Adjust column indices in the scripts as needed
