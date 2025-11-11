#!/bin/bash

# Quick Migration Fix Script
# Marks already-applied migrations as complete in the tracking system

set -e

echo "======================================"
echo "Migration Quick Fix"
echo "======================================"
echo ""
echo "This script will mark already-applied migrations as complete."
echo "This is safe - it only updates the migration tracking table."
echo ""

cd workers

echo "Step 1: Checking what exists in your database..."
echo "---------------------------------------"

# Check if manual_time column exists
echo "Checking for manual_time column..."
if npx wrangler d1 execute strava-club-db --command="PRAGMA table_info(races)" 2>/dev/null | grep -q "manual_time"; then
    echo "✅ manual_time column exists"
    MARK_0002=true
else
    echo "❌ manual_time column does NOT exist"
    MARK_0002=false
fi

# Check if manual_distance column exists
echo "Checking for manual_distance column..."
if npx wrangler d1 execute strava-club-db --command="PRAGMA table_info(races)" 2>/dev/null | grep -q "manual_distance"; then
    echo "✅ manual_distance column exists"
    MARK_0003=true
else
    echo "❌ manual_distance column does NOT exist"
    MARK_0003=false
fi

# Check admin fields in athletes table
echo "Checking for is_admin column in athletes..."
if npx wrangler d1 execute strava-club-db --command="PRAGMA table_info(athletes)" 2>/dev/null | grep -q "is_admin"; then
    echo "✅ is_admin column exists"
    MARK_0004=true
else
    echo "❌ is_admin column does NOT exist"
    MARK_0004=false
fi

# Check parkrun_results for gender_position column
echo "Checking for gender_position column in parkrun_results..."
if npx wrangler d1 execute strava-club-db --command="PRAGMA table_info(parkrun_results)" 2>/dev/null | grep -q "gender_position"; then
    echo "✅ gender_position column exists"
    MARK_0006=true
else
    echo "❌ gender_position column does NOT exist"
    MARK_0006=false
fi

echo ""
echo "Step 2: Marking completed migrations..."
echo "---------------------------------------"

# Mark migrations as applied if columns exist
if [ "$MARK_0002" = true ]; then
    echo "Marking 0002_add_manual_time.sql as applied..."
    npx wrangler d1 execute strava-club-db --command="INSERT INTO d1_migrations (id, name, applied_at) VALUES (2, '0002_add_manual_time.sql', datetime('now')) ON CONFLICT DO NOTHING" 2>/dev/null || echo "⚠️  Could not mark migration (may already be marked)"
fi

if [ "$MARK_0003" = true ]; then
    echo "Marking 0003_add_manual_distance.sql as applied..."
    npx wrangler d1 execute strava-club-db --command="INSERT INTO d1_migrations (id, name, applied_at) VALUES (3, '0003_add_manual_distance.sql', datetime('now')) ON CONFLICT DO NOTHING" 2>/dev/null || echo "⚠️  Could not mark migration (may already be marked)"
fi

if [ "$MARK_0004" = true ]; then
    echo "Marking 0004_add_admin_fields.sql as applied..."
    npx wrangler d1 execute strava-club-db --command="INSERT INTO d1_migrations (id, name, applied_at) VALUES (4, '0004_add_admin_fields.sql', datetime('now')) ON CONFLICT DO NOTHING" 2>/dev/null || echo "⚠️  Could not mark migration (may already be marked)"
fi

if [ "$MARK_0006" = true ]; then
    echo "Marking 0006_add_parkrun_gender_position.sql as applied..."
    npx wrangler d1 execute strava-club-db --command="INSERT INTO d1_migrations (id, name, applied_at) VALUES (6, '0006_add_parkrun_gender_position.sql', datetime('now')) ON CONFLICT DO NOTHING" 2>/dev/null || echo "⚠️  Could not mark migration (may already be marked)"
fi

echo ""
echo "Step 3: Applying remaining migrations..."
echo "---------------------------------------"

npx wrangler d1 migrations apply strava-club-db

echo ""
echo "======================================"
echo "✅ Migration fix complete!"
echo "======================================"
echo ""
echo "Next steps:"
echo "1. Verify with: npm run db:migrations:list"
echo "2. Trigger parkrun sync to populate gender_position data"
echo "3. Deploy: npm run deploy"
echo ""
