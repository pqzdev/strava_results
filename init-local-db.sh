#!/bin/bash

# Initialize Local Database Script
# This script sets up the local D1 database with the base schema and applies migrations

set -e

echo "======================================"
echo "Local Database Initialization"
echo "======================================"
echo ""

cd workers

echo "Step 1: Initializing database with base schema..."
echo "---------------------------------------"
echo "Loading schema.sql into local database..."

npx wrangler d1 execute strava-club-db --local --file=../database/schema.sql

echo "✅ Base schema loaded successfully"
echo ""

echo "Step 2: Applying migrations..."
echo "---------------------------------------"

# Now apply migrations
npx wrangler d1 migrations apply strava-club-db --local

echo ""
echo "======================================"
echo "✅ Local database initialized!"
echo "======================================"
echo ""
echo "Next steps:"
echo "1. Verify migrations: cd workers && npx wrangler d1 migrations list strava-club-db --local"
echo "2. Start development: npm run dev"
echo ""
