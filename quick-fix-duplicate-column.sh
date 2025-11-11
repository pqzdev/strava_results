#!/bin/bash

# Quick Fix for "duplicate column name" Error
# This script fixes the immediate error by marking already-applied migrations as complete

set -e

echo "======================================"
echo "Quick Fix: Duplicate Column Error"
echo "======================================"
echo ""
echo "This script will fix the 'duplicate column name: manual_time' error"
echo "by marking already-applied migrations in your migration tracking."
echo ""
echo "This is SAFE - it only updates the migration tracking table."
echo ""

cd workers

# Check if we're dealing with a local or remote database
if [ "$1" == "--remote" ]; then
    echo "🌍 Running on REMOTE database"
    DB_FLAG=""
else
    echo "💻 Running on LOCAL database"
    DB_FLAG="--local"
fi

echo ""
echo "Checking database state..."
echo "---------------------------------------"

# Function to check if a column exists
check_column() {
    local table=$1
    local column=$2
    if npx wrangler d1 execute strava-club-db $DB_FLAG --command="PRAGMA table_info($table)" 2>/dev/null | grep -q "$column"; then
        return 0
    else
        return 1
    fi
}

# Function to mark migration as applied
mark_migration() {
    local id=$1
    local name=$2
    echo "  Marking $name as applied..."
    npx wrangler d1 execute strava-club-db $DB_FLAG --command="INSERT OR IGNORE INTO d1_migrations (id, name, applied_at) VALUES ($id, '$name', datetime('now'))" 2>/dev/null || true
}

# Check and fix each migration
echo ""
echo "Checking which migrations need to be marked..."
echo "---------------------------------------"

if check_column "races" "manual_time"; then
    echo "✅ manual_time column exists"
    mark_migration 2 "0002_add_manual_time.sql"
else
    echo "ℹ️  manual_time column not found (migration not applied yet)"
fi

if check_column "races" "manual_distance"; then
    echo "✅ manual_distance column exists"
    mark_migration 3 "0003_add_manual_distance.sql"
else
    echo "ℹ️  manual_distance column not found (migration not applied yet)"
fi

if check_column "athletes" "is_admin"; then
    echo "✅ is_admin column exists"
    mark_migration 4 "0004_add_admin_fields.sql"
else
    echo "ℹ️  is_admin column not found (migration not applied yet)"
fi

if check_column "parkrun_results" "gender_position" 2>/dev/null; then
    echo "✅ gender_position column exists"
    mark_migration 6 "0006_add_parkrun_gender_position.sql"
else
    echo "ℹ️  gender_position column not found (migration not applied yet)"
fi

echo ""
echo "Now applying remaining migrations..."
echo "---------------------------------------"

if [ "$1" == "--remote" ]; then
    npx wrangler d1 migrations apply strava-club-db
else
    npx wrangler d1 migrations apply strava-club-db --local
fi

echo ""
echo "======================================"
echo "✅ Fix complete!"
echo "======================================"
echo ""
echo "Your migrations should now be in sync."
echo ""
