# Migration Fix Guide

## Problem

Your database has duplicate migration numbers and some migrations have already been applied manually, causing conflicts:
- ❌ `0002_add_manual_time.sql` - Failed (column already exists)
- Multiple migrations numbered `0002` (now fixed to `0001` and `0002`)

## What I've Fixed

1. **Renamed duplicate migration**: `0002_add_race_edits_table.sql` → `0001_add_race_edits_table.sql`
2. Now migrations are properly numbered 0001-0006

## Solution Options

### Option 1: Fresh Migration State (Recommended if this is development/staging)

If you're okay resetting the migration tracking (your data will be preserved):

```bash
# This will reset migration tracking and reapply all migrations
cd workers
npx wrangler d1 execute strava-club-db --command="DROP TABLE IF EXISTS d1_migrations"
npx wrangler d1 migrations apply strava-club-db
```

### Option 2: Skip Already-Applied Migrations (For Production)

If migrations were already applied manually, we need to mark them as complete without re-running them.

**Step 1: Check what's actually in your database**
```bash
cd workers
npx wrangler d1 execute strava-club-db --command="SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
```

**Step 2: Check for specific columns**
```bash
# Check if manual_time column exists
npx wrangler d1 execute strava-club-db --command="PRAGMA table_info(races)" | grep manual_time

# Check if race_edits table exists
npx wrangler d1 execute strava-club-db --command="SELECT name FROM sqlite_master WHERE type='table' AND name='race_edits'"
```

**Step 3: Manually mark migrations as applied**

Based on what exists, mark migrations as complete:

```bash
# If race_edits table exists, mark 0001 as applied:
npx wrangler d1 execute strava-club-db --command="INSERT INTO d1_migrations (id, name, applied_at) VALUES (1, '0001_add_race_edits_table.sql', datetime('now')) ON CONFLICT DO NOTHING"

# If manual_time column exists, mark 0002 as applied:
npx wrangler d1 execute strava-club-db --command="INSERT INTO d1_migrations (id, name, applied_at) VALUES (2, '0002_add_manual_time.sql', datetime('now')) ON CONFLICT DO NOTHING"

# If manual_distance column exists, mark 0003 as applied:
npx wrangler d1 execute strava-club-db --command="INSERT INTO d1_migrations (id, name, applied_at) VALUES (3, '0003_add_manual_distance.sql', datetime('now')) ON CONFLICT DO NOTHING"

# Mark any other already-applied migrations similarly
```

**Step 4: Apply remaining migrations**
```bash
npm run db:migrations:apply
```

### Option 3: Create New Consolidated Migration

Replace problem migrations with a single idempotent migration:

```bash
# Backup current migrations
mkdir database/migrations_backup
cp database/migrations/000* database/migrations_backup/

# I'll create a new consolidated migration for you
```

## Verify Success

After applying one of the solutions:

```bash
# Check migration status
npm run db:migrations:list

# Should show all migrations with ✅ status
```

## For the Parkrun Gender Position Specifically

Once migrations are fixed, the gender position will appear after:

1. Migrations applied successfully (creates `gender_position` column)
2. Parkrun sync runs (populates data)
3. Frontend reloaded (displays the column)

## Need Help?

If you're unsure which approach to use:
- **Development/Staging**: Use Option 1 (fresh migration state)
- **Production with data**: Use Option 2 (mark already-applied migrations)
- **Want clean slate**: Use Option 3 (consolidated migration)
