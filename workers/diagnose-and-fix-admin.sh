#!/bin/bash
# Diagnostic and fix script for Tim Cox admin access

echo "=== Checking Tim Cox Admin Status ==="
echo ""

# Step 1: Check current status in PRODUCTION
echo "Step 1: Checking production database..."
npx wrangler d1 execute strava-club-db --remote --command="SELECT strava_id, firstname, lastname, is_admin FROM athletes WHERE strava_id = 18754232"

echo ""
echo "=== Analysis ==="
echo "If is_admin = 0: Tim Cox does NOT have admin access (migration not applied)"
echo "If is_admin = 1: Tim Cox DOES have admin access (migration applied)"
echo "If no results: Tim Cox hasn't connected their Strava account yet"
echo ""

read -p "Does is_admin = 0 or is the user missing? (y/n) " need_fix

if [ "$need_fix" = "y" ]; then
    echo ""
    echo "=== Applying Fix ==="
    echo "Running migration to grant admin access..."

    # Apply all pending migrations
    npx wrangler d1 migrations apply strava-club-db --remote

    echo ""
    echo "=== Verifying Fix ==="
    npx wrangler d1 execute strava-club-db --remote --command="SELECT strava_id, firstname, lastname, is_admin FROM athletes WHERE strava_id = 18754232"

    echo ""
    echo "✅ If is_admin = 1 now, the fix was successful!"
    echo "🔄 Ask Tim Cox to log out and log back in to refresh their session."
else
    echo ""
    echo "=== Checking All Admins ==="
    npx wrangler d1 execute strava-club-db --remote --command="SELECT strava_id, firstname, lastname, is_admin FROM athletes WHERE is_admin = 1"
    echo ""
    echo "Above are all current admins in the production database."
fi
