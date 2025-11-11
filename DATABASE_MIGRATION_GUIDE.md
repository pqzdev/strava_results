# Database Migration Guide

This guide explains how to handle database migrations for the Strava Club Results application.

## Common Issues and Solutions

### Issue: "duplicate column name" Error

**Symptoms:**
```
Migration 0002_add_manual_time.sql failed with the following errors:
✘ [ERROR] duplicate column name: manual_time: SQLITE_ERROR
```

**Cause:** The column already exists in your database, but the migration tracking system doesn't know it was applied.

**Solutions:**

#### Option 1: Reset Local Database (Recommended for Development)
```bash
./reset-local-db.sh
```
This completely resets your local development database and applies all migrations from scratch.
- **Pros:** Clean slate, guaranteed to work
- **Cons:** Loses any test data in your local database
- **Safe for:** Local development only

#### Option 2: Fix Migration Tracking
```bash
./fix-migrations-local.sh
```
This checks which columns exist and marks those migrations as applied without modifying data.
- **Pros:** Preserves existing data
- **Cons:** More complex, requires existing base schema
- **Safe for:** Local development with data you want to keep

#### Option 3: Manual Fix
If the scripts don't work, you can manually mark migrations as applied:

```bash
cd workers

# Check which columns exist
npx wrangler d1 execute strava-club-db --local --command="PRAGMA table_info(races)"

# If manual_time exists, mark migration 0002 as applied
npx wrangler d1 execute strava-club-db --local --command="INSERT INTO d1_migrations (id, name, applied_at) VALUES (2, '0002_add_manual_time.sql', datetime('now'))"

# Then continue with remaining migrations
npx wrangler d1 migrations apply strava-club-db --local
```

## Scripts Reference

### `init-local-db.sh`
Initializes a new local database with base schema and applies all migrations.
```bash
./init-local-db.sh
```

### `reset-local-db.sh`
**WARNING: Destructive!** Deletes local database and recreates from scratch.
```bash
./reset-local-db.sh
```

### `fix-migrations-local.sh`
Intelligently fixes migration tracking for already-applied migrations (local).
```bash
./fix-migrations-local.sh
```

### `fix-migrations.sh`
Same as above but for **remote/production** database.
```bash
./fix-migrations.sh
```

## Normal Workflow

### First Time Setup (Local)
```bash
./init-local-db.sh
```

### Applying New Migrations (Local)
```bash
cd workers
npx wrangler d1 migrations apply strava-club-db --local
```

### Applying Migrations (Remote/Production)
```bash
cd workers
npx wrangler d1 migrations apply strava-club-db
```

### Checking Migration Status
```bash
# Local
cd workers
npx wrangler d1 migrations list strava-club-db --local

# Remote
cd workers
npx wrangler d1 migrations list strava-club-db
```

## Migration Files

Located in `database/migrations/`:

- `0001_add_race_edits_table.sql` - Adds race_edits table for manual corrections
- `0002_add_manual_time.sql` - Adds manual_time column to races
- `0003_add_manual_distance.sql` - Adds manual_distance column to races
- `0004_add_admin_fields.sql` - Adds admin-related columns to athletes
- `0005_add_parkrun_tables.sql` - Adds parkrun-related tables
- `0006_add_parkrun_gender_position.sql` - Adds gender_position to parkrun_results

## Troubleshooting

### "no such table: races"
Your database doesn't have the base schema. Run:
```bash
./init-local-db.sh
```

### "no such table: d1_migrations"
The migration tracking table doesn't exist. This happens on first run. Just continue with the migration.

### Migration hangs or times out
The wrangler CLI might be waiting for input. Make sure to use the `--yes` flag:
```bash
npx wrangler d1 migrations apply strava-club-db --local --yes
```

### Different behavior between local and remote
Local databases are stored in `.wrangler/state/` and are independent from remote databases. Always use `--local` flag for local development and omit it for remote operations.

## Best Practices

1. **Always test migrations locally first** before applying to remote
2. **Never edit applied migrations** - create a new migration instead
3. **Backup production data** before running migrations on remote database
4. **Keep migrations small** and focused on one change
5. **Use the fix scripts** if you encounter duplicate column errors
6. **Don't commit `.wrangler/`** directory - it's gitignored and local-only

## Need Help?

If you encounter issues not covered here:
1. Check the wrangler logs at `~/.config/.wrangler/logs/`
2. Verify your wrangler version: `npx wrangler --version`
3. Try the reset script for local development
4. For production issues, use the fix-migrations.sh script carefully
