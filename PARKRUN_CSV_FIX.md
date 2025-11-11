# Parkrun CSV Import Fix - Event Names with Commas

## Problem

Event names containing commas (e.g., "Albert parkrun, Melbourne" and "Cowpasture Reserve parkrun, Camden") were being scraped correctly but failing to import into the database. The scraper would report 66 results found, but only 64 would be imported with 2 errors.

## Root Cause

The CSV parser in `/workers/src/api/parkrun-import.ts` was using a naive `split(',')` approach that didn't handle quoted CSV fields properly.

### Before (Broken Code):
```typescript
function parseCSV(csvText: string): CSVRow[] {
  const lines = csvText.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.trim());

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim());  // ❌ BROKEN
    // ...
  }
}
```

When parsing this CSV line:
```csv
2025-04-26,"Albert, Melbourne",174,Pedro QUEIROZ,00:23:40,150
```

The naive split would produce:
1. `2025-04-26`
2. `"Albert` ❌ (with quote!)
3. `Melbourne"` ❌ (with quote!)
4. `174`
5. `Pedro QUEIROZ`
6. `00:23:40`
7. `150`

This caused the event name to be malformed and the import to fail.

## Solution

Implemented a proper CSV parser that respects quoted fields and handles:
- Commas inside quotes: `"Albert, Melbourne"` → `Albert, Melbourne`
- Escaped quotes: `"She said ""Hello"""` → `She said "Hello"`
- Mixed quoted/unquoted fields

### After (Fixed Code):
```typescript
function parseCSVLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;
  let i = 0;

  while (i < line.length) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        // Escaped quote ("")
        current += '"';
        i += 2;
        continue;
      } else {
        // Toggle quote mode
        inQuotes = !inQuotes;
        i++;
        continue;
      }
    }

    if (char === ',' && !inQuotes) {
      // End of field
      values.push(current.trim());
      current = '';
      i++;
      continue;
    }

    // Regular character
    current += char;
    i++;
  }

  values.push(current.trim());
  return values;
}
```

Now the same CSV line is correctly parsed as:
1. `2025-04-26`
2. `Albert, Melbourne` ✓
3. `174`
4. `Pedro QUEIROZ`
5. `00:23:40`
6. `150`

## Testing

Created comprehensive tests to verify the fix works for:
- ✅ Simple events without commas: `St Peters`
- ✅ Events with commas: `Albert, Melbourne`
- ✅ Events with commas: `Cowpasture Reserve, Camden`
- ✅ Runner names with commas: `RYAN, Jarvis`
- ✅ Escaped quotes: `"Quote test: ""Hello"""`

All tests pass!

## Verification

Uploaded test data for April 26, 2025:
- **Before fix**: 64 imported, 2 errors (missing Albert and Cowpasture)
- **After fix**: 66 imported, 0 errors ✅

Database query confirms both events are now present:
```
- Albert, Melbourne: Pedro QUEIROZ (00:23:40)
- Cowpasture Reserve, Camden: Paul RAINBOW (00:45:40)
```

## Files Changed

- `/workers/src/api/parkrun-import.ts`: Added proper CSV parser
- Deployed to production: ✅

## Impact

This fix ensures that all parkrun events are imported correctly, regardless of whether they have commas in their names. Australian parkrun events commonly include location names (e.g., "Albert parkrun, Melbourne"), so this was affecting multiple events.
