# Quick Setup Guide

Follow these steps to get your Strava Club Results aggregator running.

## 1. Initial Setup (5 minutes)

### Install Dependencies
```bash
# Install root workspace dependencies
npm install

# Install Workers dependencies
cd workers && npm install && cd ..

# Install Frontend dependencies
cd frontend && npm install && cd ..
```

### Register Strava API Application
1. Go to https://www.strava.com/settings/api
2. Click "Create Application"
3. Fill in:
   - **Application Name**: `[Your Club Name] Race Results`
   - **Category**: `Visualizer`
   - **Website**: `http://localhost:3000` (change later)
   - **Authorization Callback Domain**: `localhost`
4. Save your **Client ID** and **Client Secret**

## 2. Cloudflare Setup (10 minutes)

### Install and Login to Wrangler
```bash
npm install -g wrangler
wrangler login
```

### Create D1 Database
```bash
wrangler d1 create strava-club-db
```

**Important**: Copy the `database_id` from the output!

### Update Configuration
Edit `workers/wrangler.toml` and replace the database_id:
```toml
[[d1_databases]]
binding = "DB"
database_name = "strava-club-db"
database_id = "PASTE_YOUR_DATABASE_ID_HERE"
```

### Run Database Migration
```bash
wrangler d1 execute strava-club-db --file=database/schema.sql
```

### Set Secrets for Local Development
Create `workers/.dev.vars`:
```env
STRAVA_CLIENT_ID=your_client_id_from_strava
STRAVA_CLIENT_SECRET=your_client_secret_from_strava
```

## 3. Run Locally (2 minutes)

Open two terminal windows:

**Terminal 1 - Workers:**
```bash
cd workers
npm run dev
```

**Terminal 2 - Frontend:**
```bash
cd frontend
npm run dev
```

Visit: http://localhost:3000

## 4. Test the Application

1. Click "Connect with Strava"
2. Authorize the application
3. You should see your Strava profile connected
4. Mark an activity as "Race" in Strava
5. Trigger manual sync: `curl -X POST http://localhost:8787/api/sync`
6. View races on the dashboard

## 5. Deploy to Production

### Set Production Secrets
```bash
cd workers
wrangler secret put STRAVA_CLIENT_ID
# Enter your Strava Client ID

wrangler secret put STRAVA_CLIENT_SECRET
# Enter your Strava Client Secret
```

### Update Redirect URI
Edit `workers/wrangler.toml`:
```toml
[vars]
STRAVA_REDIRECT_URI = "https://your-production-domain.com/auth/callback"
```

Also update your Strava API application:
1. Go to https://www.strava.com/settings/api
2. Update **Authorization Callback Domain** to your production domain

### Deploy
```bash
# Deploy Workers
cd workers
npm run deploy

# Deploy Frontend
cd frontend
npm run build
wrangler pages deploy dist --project-name=woodstock-results
```

### Setup GitHub Actions (Optional)
Add these secrets to your GitHub repository:
- `CLOUDFLARE_API_TOKEN` - Create at https://dash.cloudflare.com/profile/api-tokens
  - Template: "Edit Cloudflare Workers"
  - Permissions: Account.Cloudflare Pages, Account.D1, Workers Scripts
- `CLOUDFLARE_ACCOUNT_ID` - Found in Cloudflare dashboard URL

Push to main branch to auto-deploy.

## Troubleshooting

### "Database binding not found"
- Make sure you updated `database_id` in `workers/wrangler.toml`
- Run migrations: `wrangler d1 execute strava-club-db --file=database/schema.sql`

### "OAuth callback error"
- Check redirect URI matches in both:
  - `workers/wrangler.toml`
  - Strava API application settings

### "Module not found" errors
- Run `npm install` in both `workers/` and `frontend/` directories

### Rate limit warnings
- Adjust `batchSize` in `workers/src/cron/sync.ts` (lower for more athletes)
- Increase `delayBetweenBatches` (e.g., 120000 for 2 minutes)

## Next Steps

1. **Customize Branding**: Edit colors in `frontend/src/index.css`
2. **Add Club Logo**: Replace in `frontend/src/components/Layout.tsx`
3. **Invite Members**: Share your deployment URL with club members
4. **Monitor Syncs**: Check `sync_logs` table in Cloudflare D1 dashboard

## Support

- Full docs: [README.md](README.md)
- Issues: Create a GitHub issue
- Strava API: https://developers.strava.com/docs/

---

Estimated total setup time: **15-20 minutes**
