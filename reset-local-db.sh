#!/bin/bash

# Reset Local Database Script
# Completely resets the local D1 database and applies all migrations from scratch

set -e

echo "======================================"
echo "Local Database Reset"
echo "======================================"
echo ""
echo "⚠️  WARNING: This will DELETE your local database and recreate it from scratch."
echo "This only affects your local development database (.wrangler/state/)."
echo ""
echo "Your remote/production database will NOT be affected."
echo ""
read -p "Continue? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Cancelled."
    exit 1
fi

echo ""
echo "Step 1: Removing local database..."
echo "---------------------------------------"

# Remove the local database directory
if [ -d ".wrangler/state" ]; then
    rm -rf .wrangler/state
    echo "✅ Local database removed"
else
    echo "ℹ️  No existing local database found"
fi

echo ""
echo "Step 2: Initializing fresh database with base schema..."
echo "---------------------------------------"

cd workers
npx wrangler d1 execute strava-club-db --local --file=../database/schema.sql

echo "✅ Base schema loaded"

echo ""
echo "Step 3: Applying all migrations..."
echo "---------------------------------------"

npx wrangler d1 migrations apply strava-club-db --local

echo ""
echo "======================================"
echo "✅ Local database reset complete!"
echo "======================================"
echo ""
echo "Your local database is now in a clean state with all migrations applied."
echo ""
echo "Next steps:"
echo "1. Verify: cd workers && npx wrangler d1 migrations list strava-club-db --local"
echo "2. Start dev: npm run dev"
echo ""
