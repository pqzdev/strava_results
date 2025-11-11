#!/bin/bash

# Check Migration State Helper Script
# This script helps diagnose migration issues

set -e

echo "======================================"
echo "Migration State Checker"
echo "======================================"
echo ""

cd workers

echo "1. Checking migration tracking table..."
echo "---------------------------------------"
npx wrangler d1 execute strava-club-db --command="SELECT * FROM d1_migrations ORDER BY id" 2>/dev/null || echo "⚠️  Migration tracking table doesn't exist or is empty"
echo ""

echo "2. Checking if race_edits table exists..."
echo "---------------------------------------"
if npx wrangler d1 execute strava-club-db --command="SELECT name FROM sqlite_master WHERE type='table' AND name='race_edits'" 2>/dev/null | grep -q "race_edits"; then
    echo "✅ race_edits table exists (0001 migration was applied)"
else
    echo "❌ race_edits table does NOT exist (0001 migration needs to run)"
fi
echo ""

echo "3. Checking races table for manual columns..."
echo "---------------------------------------"
RACES_SCHEMA=$(npx wrangler d1 execute strava-club-db --command="PRAGMA table_info(races)" 2>/dev/null || echo "")

if echo "$RACES_SCHEMA" | grep -q "manual_time"; then
    echo "✅ manual_time column exists (0002 migration was applied)"
else
    echo "❌ manual_time column does NOT exist (0002 migration needs to run)"
fi

if echo "$RACES_SCHEMA" | grep -q "manual_distance"; then
    echo "✅ manual_distance column exists (0003 migration was applied)"
else
    echo "❌ manual_distance column does NOT exist (0003 migration needs to run)"
fi
echo ""

echo "4. Checking parkrun_results table..."
echo "---------------------------------------"
if npx wrangler d1 execute strava-club-db --command="SELECT name FROM sqlite_master WHERE type='table' AND name='parkrun_results'" 2>/dev/null | grep -q "parkrun_results"; then
    echo "✅ parkrun_results table exists (0005 migration was applied)"

    PARKRUN_SCHEMA=$(npx wrangler d1 execute strava-club-db --command="PRAGMA table_info(parkrun_results)" 2>/dev/null || echo "")

    if echo "$PARKRUN_SCHEMA" | grep -q "gender_position"; then
        echo "✅ gender_position column exists (0006 migration was applied)"
    else
        echo "❌ gender_position column does NOT exist (0006 migration needs to run)"
    fi
else
    echo "❌ parkrun_results table does NOT exist (0005 migration needs to run)"
fi
echo ""

echo "======================================"
echo "Recommendation:"
echo "======================================"
echo ""
echo "Based on the checks above:"
echo "1. If tables/columns already exist but migrations show as failed:"
echo "   → Use Option 2 from MIGRATION_FIX_GUIDE.md (mark as applied)"
echo ""
echo "2. If nothing exists:"
echo "   → Use Option 1 from MIGRATION_FIX_GUIDE.md (fresh migration)"
echo ""
echo "3. For detailed instructions, see: MIGRATION_FIX_GUIDE.md"
echo ""
