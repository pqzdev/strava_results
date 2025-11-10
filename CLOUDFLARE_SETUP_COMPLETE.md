# Cloudflare Setup Complete ✅

## What Was Set Up

### 1. ✅ Cloudflare Authentication
- Successfully logged in to Cloudflare via OAuth
- Wrangler CLI configured and ready to use

### 2. ✅ D1 Database Created
- **Database Name**: strava-club-db
- **Database ID**: 4b79f9e5-f6bb-4cd9-852b-51e2c0a7c5d1
- **Region**: OC (Oceania)
- **Status**: Active (both local and remote)

### 3. ✅ Database Schema Deployed
Successfully created 3 tables:
- `athletes` - Stores connected Strava users and OAuth tokens
- `races` - Stores race activities with metrics
- `sync_logs` - Tracks sync operations and rate limits

### 4. ✅ Configuration Updated
- Updated `workers/wrangler.toml` with database ID
- Created `workers/.dev.vars` for local development secrets

### 5. ✅ Dependencies Installed
- Workers dependencies installed (including Wrangler 3.114.15)
- Frontend dependencies installed

## Current Configuration

### Database Connection
```toml
[[d1_databases]]
binding = "DB"
database_name = "strava-club-db"
database_id = "4b79f9e5-f6bb-4cd9-852b-51e2c0a7c5d1"
```

### Local Development
File: `workers/.dev.vars`
```env
STRAVA_CLIENT_ID=your_client_id_here
STRAVA_CLIENT_SECRET=your_client_secret_here
```

## Next Steps - Register Strava API Application

### Step 1: Create Strava API Application
1. Go to https://www.strava.com/settings/api
2. Click "Create an Application" or "My API Application"
3. Fill in the form:
   - **Application Name**: `Your Club Name Race Results`
   - **Category**: `Visualizer`
   - **Website**: `http://localhost:3000`
   - **Authorization Callback Domain**: `localhost`
   - **Description**: `Aggregate race results from club members' Strava accounts`

### Step 2: Get Your Credentials
After creating the app, you'll see:
- **Client ID**: (a number like 123456)
- **Client Secret**: (a long string)

### Step 3: Update Local Environment
Edit `workers/.dev.vars` and replace:
```env
STRAVA_CLIENT_ID=123456
STRAVA_CLIENT_SECRET=abc123def456...
```

### Step 4: Test Locally
Open two terminal windows:

**Terminal 1 - Start Workers:**
```bash
cd /Users/pqz/Code/strava_results/workers
npm run dev
```

**Terminal 2 - Start Frontend:**
```bash
cd /Users/pqz/Code/strava_results/frontend
npm run dev
```

Then visit: http://localhost:3000

### Step 5: Test OAuth Flow
1. Click "Connect with Strava" button
2. You'll be redirected to Strava to authorize
3. After authorizing, you'll be redirected back
4. Check the database to see your athlete record

### Step 6: Test Sync (Optional)
Mark an activity as "Race" in Strava, then trigger a manual sync:
```bash
curl -X POST http://localhost:8787/api/sync
```

## Database Verification

You can query the database at any time:

```bash
cd /Users/pqz/Code/strava_results/workers

# List all athletes
npx wrangler d1 execute strava-club-db --command "SELECT * FROM athletes;"

# List all races
npx wrangler d1 execute strava-club-db --command "SELECT * FROM races;"

# Check sync logs
npx wrangler d1 execute strava-club-db --command "SELECT * FROM sync_logs ORDER BY sync_started_at DESC LIMIT 5;"

# Add --remote flag to query production database
npx wrangler d1 execute strava-club-db --command "SELECT * FROM athletes;" --remote
```

## Useful Commands

### Development
```bash
# Start Workers dev server
cd workers && npm run dev

# Start Frontend dev server
cd frontend && npm run dev

# Watch Worker logs
cd workers && npx wrangler tail
```

### Database
```bash
# Execute SQL file
npx wrangler d1 execute strava-club-db --file=path/to/file.sql

# Execute SQL command
npx wrangler d1 execute strava-club-db --command "SELECT * FROM table;"

# Add --remote for production database
npx wrangler d1 execute strava-club-db --command "SELECT * FROM table;" --remote
```

### Deployment
```bash
# Deploy Workers
cd workers && npm run deploy

# Deploy Frontend
cd frontend && npm run deploy
```

## Cloudflare Dashboard Links

- **D1 Database**: https://dash.cloudflare.com/?to=/:account/workers/d1
- **Workers**: https://dash.cloudflare.com/?to=/:account/workers
- **Pages**: https://dash.cloudflare.com/?to=/:account/pages

## Troubleshooting

### "Database binding not found"
Make sure you're running commands from the `workers/` directory where `wrangler.toml` is located.

### "Authentication required"
Run `npx wrangler login` to re-authenticate.

### "Permission denied" on npm
Use `--cache /tmp/.npm-cache` flag:
```bash
npm install --cache /tmp/.npm-cache
```

## Security Notes

- ✅ `.dev.vars` is in `.gitignore` (secrets won't be committed)
- ✅ Database tokens are encrypted at rest by Cloudflare
- ✅ OAuth tokens auto-refresh before expiry
- ⚠️ Don't commit Strava credentials to version control

## Summary

**Status**: ✅ Cloudflare Setup Complete

You're now ready to:
1. Register a Strava API application
2. Add your credentials to `.dev.vars`
3. Start the development servers
4. Test the OAuth flow

Once working locally, you can deploy to production with:
```bash
cd workers && npm run deploy
cd frontend && npm run deploy
```

---

**Setup completed**: 2024-11-10
**Database ID**: 4b79f9e5-f6bb-4cd9-852b-51e2c0a7c5d1
**Next**: Register Strava API app at https://www.strava.com/settings/api
