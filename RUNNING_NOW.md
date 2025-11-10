# 🎉 Application is Running!

## ✅ Status

Both servers are running and ready to test:

- **Frontend**: http://localhost:3001/
- **API (Workers)**: http://localhost:54004/
- **Database**: Connected ✓
- **Strava Credentials**: Configured ✓

## 🖥️ Running Servers

### Backend (Cloudflare Workers)
- Port: 54004
- Status: ✅ Running
- Health: http://localhost:54004/health

### Frontend (React + Vite)
- Port: 3001 (3000 was in use)
- Status: ✅ Running
- URL: http://localhost:3001/

## 🧪 Quick Tests

### 1. API Health Check
```bash
curl http://localhost:54004/health
# Response: {"status":"healthy"}
```

### 2. Database Stats
```bash
curl http://localhost:54004/api/stats
# Response: Stats showing 1 athlete currently
```

### 3. OAuth Authorization
The OAuth flow is working - it redirects to Strava successfully.

## 🎯 Next Steps to Test

### Test the Full Application

1. **Open the Frontend**:
   Visit http://localhost:3001/

2. **Click "Connect with Strava"**:
   - You'll be redirected to Strava
   - Log in with your Strava account
   - Authorize the application
   - You'll be redirected back with success message

3. **Mark an Activity as a Race in Strava**:
   - Go to any run activity on Strava
   - Edit the activity
   - Set "Workout Type" to "Race"
   - Save

4. **Trigger Manual Sync**:
   ```bash
   curl -X POST http://localhost:54004/api/sync
   ```

5. **View Results on Dashboard**:
   - Visit http://localhost:3001/dashboard
   - Your race should appear!

## 📊 Database Queries

Check data at any time:

```bash
cd /Users/pqz/Code/strava_results/workers

# See connected athletes
npx wrangler d1 execute strava-club-db --command "SELECT strava_id, firstname, lastname FROM athletes;"

# See all races
npx wrangler d1 execute strava-club-db --command "SELECT name, distance, date FROM races ORDER BY date DESC LIMIT 10;"

# Check sync logs
npx wrangler d1 execute strava-club-db --command "SELECT * FROM sync_logs ORDER BY sync_started_at DESC LIMIT 5;"
```

## 🛠️ Development Commands

### Stop Servers
Press `Ctrl+C` in each terminal window, or:
```bash
# Find and kill processes
lsof -ti:54004 | xargs kill -9  # Kill workers
lsof -ti:3001 | xargs kill -9   # Kill frontend
```

### Restart Servers
```bash
# Terminal 1 - Workers
cd /Users/pqz/Code/strava_results/workers
npm run dev

# Terminal 2 - Frontend
cd /Users/pqz/Code/strava_results/frontend
npm run dev
```

### View Worker Logs
```bash
cd /Users/pqz/Code/strava_results/workers
npx wrangler tail
```

## 🎨 Frontend Features

Visit http://localhost:3001/ to see:

- ✅ Landing page with club stats
- ✅ "Connect with Strava" OAuth button
- ✅ Dashboard with race filtering
- ✅ Search by athlete name
- ✅ Filter by date range
- ✅ Filter by distance
- ✅ Quick filters (parkrun, 10k, half, marathon)
- ✅ Mobile-responsive design

## 🔧 Configuration

### Current Settings

**Strava OAuth Callback**:
- Local: `http://localhost:8787/auth/callback` (configured in wrangler.toml)
- Note: The callback is proxied through the API on port 54004

**Database**:
- Name: strava-club-db
- ID: 4b79f9e5-f6bb-4cd9-852b-51e2c0a7c5d1
- Status: ✅ Tables created (athletes, races, sync_logs)

**Strava API**:
- Client ID: 23400
- Status: ✅ Configured in .dev.vars

## 🐛 Troubleshooting

### Frontend shows "Network Error"
- Check that both servers are running
- Verify proxy is pointing to correct port (54004)

### OAuth redirect doesn't work
- Make sure your Strava app callback domain is set to `localhost`
- Check that redirect URI in Strava matches: `http://localhost:8787/auth/callback`

### Database errors
- Verify migrations ran: `npx wrangler d1 execute strava-club-db --file=../database/schema.sql`
- Check wrangler.toml has correct database_id

### Can't connect to Strava
- Verify credentials in `workers/.dev.vars`
- Check Strava API app is created at https://www.strava.com/settings/api

## 📝 What's Next

After testing locally, you can:

1. **Deploy to Production**:
   ```bash
   cd workers && npm run deploy
   cd frontend && npm run deploy
   ```

2. **Set Production Secrets**:
   ```bash
   cd workers
   npx wrangler secret put STRAVA_CLIENT_ID
   npx wrangler secret put STRAVA_CLIENT_SECRET
   ```

3. **Update Strava App for Production**:
   - Update callback domain to your production domain
   - Update redirect URI in wrangler.toml

## 🎉 Success!

Your Strava Running Club Aggregator is now running locally and ready to test!

Visit **http://localhost:3001/** to get started.

---

**Servers Running**:
- Workers: http://localhost:54004/
- Frontend: http://localhost:3001/

**Documentation**:
- [README.md](README.md) - Full documentation
- [SETUP.md](SETUP.md) - Setup guide
- [ARCHITECTURE.md](ARCHITECTURE.md) - Technical details
- [CLOUDFLARE_SETUP_COMPLETE.md](CLOUDFLARE_SETUP_COMPLETE.md) - Cloudflare setup
