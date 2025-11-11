# Database Migration Instructions

## Apply the Gender Position Migration

The parkrun dashboard now supports showing both overall position and gender position. To enable this feature, you need to apply the database migration.

### Step 1: Check Current Migrations

```bash
npm run db:migrations:list
```

This will show you which migrations have been applied and which are pending.

### Step 2: Apply Pending Migrations

```bash
npm run db:migrations:apply
```

This will apply migration `0006_add_parkrun_gender_position.sql` which adds the `gender_position` column to the `parkrun_results` table.

### Step 3: Re-sync Parkrun Data

After applying the migration, you'll need to trigger a parkrun sync to populate the gender position data:

**Option A: Trigger via API (if you've set up the endpoint)**
```bash
curl -X POST https://your-worker-url.workers.dev/api/parkrun/sync
```

**Option B: Wait for the scheduled cron job**
The parkrun sync runs automatically according to your cron schedule (check `workers/wrangler.toml` for the schedule).

**Option C: Deploy the workers (will run migrations automatically)**
```bash
npm run deploy
```

### Step 4: Verify the Changes

1. Open your parkrun dashboard
2. You should now see two position columns:
   - **Overall Pos** - The athlete's overall finishing position
   - **Gender Pos** - The athlete's position within their gender category

### Note on Existing Data

- Existing parkrun results in your database will have `NULL` for `gender_position` (displayed as "-")
- Only newly synced results will have gender position populated
- The HTML parser detects whether the parkrun page includes gender position data

### Troubleshooting

**If gender positions still show as "-" after syncing:**
1. Verify the migration was applied: `npm run db:migrations:list`
2. Check the sync logs for any errors
3. The parkrun website may not provide gender position data for all events/dates

**If you get a "column already exists" error:**
The migration may have already been applied. Check with `npm run db:migrations:list`.
