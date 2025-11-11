# Fix "Duplicate Column Name" Migration Error

## Quick Start - Choose Your Solution

### 🚀 **Fastest Fix (Recommended)**
If you don't need to preserve local test data:
```bash
./reset-local-db.sh
```

### 🔧 **Smart Fix**
If you want to keep your local data:
```bash
./quick-fix-duplicate-column.sh
```

### 📚 **Need More Info?**
See [DATABASE_MIGRATION_GUIDE.md](./DATABASE_MIGRATION_GUIDE.md) for detailed explanations.

---

## What Happened?

Your local database has columns that migrations are trying to add again. This happens when:
- Migrations were partially applied before
- The database was manually modified
- The migration tracking got out of sync

## The Error You're Seeing

```
Migration 0002_add_manual_time.sql failed with the following errors:
✘ [ERROR] duplicate column name: manual_time: SQLITE_ERROR
```

## How to Fix It

### Method 1: Reset (Easiest)
Completely reset your local database:
```bash
./reset-local-db.sh
```
⚠️ This deletes all local test data but gives you a clean start.

### Method 2: Smart Fix (Preserves Data)
Fix migration tracking while keeping data:
```bash
./quick-fix-duplicate-column.sh
```
This checks what exists and marks migrations accordingly.

### Method 3: Manual (If scripts fail)
```bash
cd workers
# Mark the problematic migration as complete
npx wrangler d1 execute strava-club-db --local \
  --command="INSERT OR IGNORE INTO d1_migrations (id, name, applied_at) VALUES (2, '0002_add_manual_time.sql', datetime('now'))"

# Then apply remaining migrations
npx wrangler d1 migrations apply strava-club-db --local --yes
```

## After Fixing

Verify everything is working:
```bash
cd workers
npx wrangler d1 migrations list strava-club-db --local
```

You should see all migrations marked with ✅.

## Still Having Issues?

1. Check the logs: `~/.config/.wrangler/logs/`
2. See [DATABASE_MIGRATION_GUIDE.md](./DATABASE_MIGRATION_GUIDE.md)
3. Try the reset method if smart fix doesn't work

---

## Available Scripts

| Script | Purpose | Data Loss? |
|--------|---------|------------|
| `reset-local-db.sh` | Complete reset | ⚠️ Yes (local only) |
| `quick-fix-duplicate-column.sh` | Smart fix | ❌ No |
| `init-local-db.sh` | First-time init | N/A |
| `fix-migrations-local.sh` | Alternative smart fix | ❌ No |
| `fix-migrations.sh` | For remote DB | ❌ No |

**Note:** All "data loss" only applies to local development database. Remote/production is never affected.
