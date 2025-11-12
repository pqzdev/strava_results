# Deployment Guide

This guide covers deploying your Strava Club Results application to production using Cloudflare Pages and Workers.

## Architecture Overview

```
GitHub Repository
├── /workers (Backend API)
│   └── GitHub Actions → Cloudflare Workers
└── /frontend (React App)
    └── Cloudflare Pages → Static Hosting
```

## Prerequisites

- Cloudflare account (free tier is sufficient)
- GitHub repository with your code
- Strava API credentials configured

## GitHub Actions Deployment (Recommended)

### 1. Create Cloudflare API Token

1. Go to https://dash.cloudflare.com/profile/api-tokens
2. Click "Create Token"
3. Use template: **"Edit Cloudflare Workers"**
4. Add these permissions:
   - **Account** → **D1** → Edit
   - **Account** → **Cloudflare Pages** → Edit
   - **Account** → **Workers Scripts** → Edit
5. Set Account Resources: Include → Your account
6. Continue and create token
7. **Copy the token** - you'll only see it once!

### 2. Get Your Cloudflare Account ID

1. Go to https://dash.cloudflare.com/
2. Click on "Workers & Pages"
3. Copy the Account ID from the right sidebar (or from the URL)

### 3. Set GitHub Secrets

1. Go to your GitHub repository
2. Navigate to **Settings** → **Secrets and variables** → **Actions**
3. Click **"New repository secret"** and add:
   - Name: `CLOUDFLARE_API_TOKEN`
   - Value: The token from step 1
4. Add another secret:
   - Name: `CLOUDFLARE_ACCOUNT_ID`
   - Value: Your account ID from step 2

### 4. Configure Workers Settings

Update `workers/wrangler.workers.toml`:

```toml
[vars]
STRAVA_REDIRECT_URI = "https://your-production-domain.pages.dev/auth/callback"
```

### 5. Set Production Secrets

These secrets are separate from your local `.dev.vars` file:

```bash
cd workers

# Set Strava credentials
wrangler secret put STRAVA_CLIENT_ID
# Enter your Strava Client ID when prompted

wrangler secret put STRAVA_CLIENT_SECRET
# Enter your Strava Client Secret when prompted
```

### 6. Update Strava Application Settings

1. Go to https://www.strava.com/settings/api
2. Update your application:
   - **Website**: `https://your-production-domain.pages.dev`
   - **Authorization Callback Domain**: `your-production-domain.pages.dev`

   **Important**: No `http://`, `https://`, or trailing slash!

### 7. Set Up Cloudflare Pages

1. Go to https://dash.cloudflare.com/
2. Navigate to **Workers & Pages** → **Create application** → **Pages**
3. Click **"Connect to Git"**
4. Select your repository
5. Configure build settings:
   - **Build command**: `npm run build:frontend`
   - **Build output directory**: `frontend/dist`
   - **Deploy command**: *(LEAVE EMPTY)*
6. Click **"Save and Deploy"**

### 8. Deploy!

```bash
git add .
git commit -m "Configure production deployment"
git push origin main
```

GitHub Actions will automatically:
1. Run database migrations
2. Deploy Workers (backend API)
3. Cloudflare Pages will build and deploy Frontend

### 9. Monitor Deployment

1. Go to your repository on GitHub
2. Click the **"Actions"** tab
3. Watch your deployment workflow run
4. Check Cloudflare Pages for frontend deployment
5. Once complete, your site will be live!

### 10. Create Admin User

After first deployment:

1. Visit your production site
2. Click "Connect with Strava" and authorize
3. Go to Cloudflare Dashboard → **Storage & Databases** → **D1**
4. Select your `strava-club-db` database
5. Run this query (replace with your Strava ID):
   ```sql
   UPDATE athletes SET is_admin = 1 WHERE strava_id = YOUR_STRAVA_ID;
   ```
6. You can now access `/admin` on your site

## Manual Deployment (Alternative)

If you prefer not to use GitHub Actions:

### Deploy Workers

```bash
cd workers

# Run migrations (first time only)
npm run migrate

# Deploy
npm run deploy
```

### Deploy Frontend

```bash
cd frontend

# Build
npm run build

# Deploy to Cloudflare Pages
npx wrangler pages deploy dist --project-name=your-project-name
```

## Verifying Deployment

### Check Workers

```bash
# Test the API
curl https://your-worker.workers.dev/api/stats

# View logs
cd workers
wrangler tail
```

### Check Pages

1. Visit your Pages URL
2. Click "Connect with Strava"
3. After authorizing, you should see your profile
4. Visit `/admin` to access the admin panel

### Check Database

```bash
# List tables
wrangler d1 execute strava-club-db --command="SELECT name FROM sqlite_master WHERE type='table'"

# Check athletes
wrangler d1 execute strava-club-db --command="SELECT COUNT(*) as count FROM athletes"
```

## Updating Deployment

### GitHub Actions (Automatic)

Simply push to main:

```bash
git add .
git commit -m "Your changes"
git push origin main
```

### Manual Updates

```bash
# Update Workers
cd workers
npm run deploy

# Update Frontend
cd frontend
npm run build
npx wrangler pages deploy dist --project-name=your-project-name
```

## Database Migrations

Migrations run automatically via GitHub Actions. To run manually:

```bash
cd workers

# Remote (production)
npm run migrate

# Or run a specific migration
wrangler d1 execute strava-club-db --file=../database/migrations/0010_your_migration.sql
```

## Custom Domain Setup

### Add Custom Domain to Pages

1. Go to Cloudflare Dashboard → **Workers & Pages**
2. Select your Pages project
3. Go to **Custom domains** tab
4. Click **"Set up a custom domain"**
5. Enter your domain (e.g., `races.yourclub.com`)
6. Cloudflare will automatically configure DNS

### Update Configuration

Edit `workers/wrangler.workers.toml`:

```toml
[vars]
STRAVA_REDIRECT_URI = "https://races.yourclub.com/auth/callback"
```

Deploy:

```bash
cd workers
npm run deploy
```

### Update Strava Settings

Don't forget to update your Strava application with the new domain!

## Environment-Specific Configuration

### Development
- Uses `workers/.dev.vars` for secrets
- Frontend: `http://localhost:3000`
- Workers: `http://localhost:8787`
- Redirect URI: `http://localhost:3000/auth/callback`

### Production
- Uses `wrangler secret` for secrets
- Frontend: `https://your-domain.pages.dev`
- Workers: Bound to Pages project automatically
- Redirect URI: `https://your-domain.pages.dev/auth/callback`

## Troubleshooting

### "Build failed" in GitHub Actions

Check the Actions logs for specific errors. Common issues:
- Missing secrets (`CLOUDFLARE_API_TOKEN` or `CLOUDFLARE_ACCOUNT_ID`)
- Incorrect `database_id` in `wrangler.workers.toml`
- npm install failures (check package-lock.json is committed)

### OAuth Redirect Error

Ensure all three places have matching redirect URIs:
1. `workers/wrangler.workers.toml` - `STRAVA_REDIRECT_URI` variable
2. Strava API application settings - Authorization Callback Domain
3. They must match exactly (domain only, no protocol or path)

### Database Not Found

```bash
# List your databases
wrangler d1 list

# Verify binding in wrangler.workers.toml
[[d1_databases]]
binding = "DB"
database_name = "strava-club-db"
database_id = "YOUR_ACTUAL_DATABASE_ID"
```

### Workers Not Updating

```bash
# Force redeploy
cd workers
npm run deploy

# Check current deployment
wrangler deployments list

# View logs
wrangler tail
```

### Pages Build Issues

Common issue: "Missing entry-point to Worker script"

**Solution:** Ensure Pages deploy command is EMPTY. Pages should only build the frontend, not deploy Workers.

## Monitoring

### View Logs

```bash
# Real-time Workers logs
cd workers
wrangler tail

# Filter by status code
wrangler tail --status error
```

### Database Queries

```bash
# View recent syncs
wrangler d1 execute strava-club-db --command="
  SELECT
    a.firstname || ' ' || a.lastname as name,
    a.sync_status,
    datetime(a.last_synced_at, 'unixepoch') as last_sync,
    a.total_activities_count as activities
  FROM athletes a
  ORDER BY a.last_synced_at DESC
  LIMIT 10
"
```

### Check Sync Logs

```bash
wrangler d1 execute strava-club-db --command="
  SELECT
    message,
    metadata,
    datetime(created_at / 1000, 'unixepoch') as time
  FROM sync_logs
  WHERE log_level = 'warning'
  ORDER BY created_at DESC
  LIMIT 10
"
```

## Security Checklist

- [ ] Secrets set via `wrangler secret` (not in code)
- [ ] `.dev.vars` added to `.gitignore`
- [ ] Strava redirect URI matches exactly
- [ ] Admin users set via database (not API)
- [ ] GitHub Actions secrets configured
- [ ] Custom domain uses HTTPS (automatic with Cloudflare)

## Cost Estimate

Cloudflare Free Tier includes:
- **Workers**: 100,000 requests/day
- **Pages**: Unlimited requests, 500 builds/month
- **D1**: 5GB storage, 5M reads/day, 100K writes/day

For a 200-member club:
- Weekly syncs: ~200 Workers requests/week
- Dashboard views: Depends on usage
- **Estimated cost**: $0/month on free tier

Paid plans start at $5/month for Workers if you exceed free limits.

## Build Commands Reference

```bash
# Development
npm run dev              # Start both frontend and workers

# Building
npm run build            # Build everything
npm run build:workers    # Build workers only (type check)
npm run build:frontend   # Build frontend only

# Deployment
npm run deploy           # Deploy workers
npm run deploy:frontend  # Deploy frontend (manual)

# Database
npm run db:migrate       # Run migrations
```

## Support

- **Cloudflare Docs**: https://developers.cloudflare.com/
- **Wrangler CLI**: https://developers.cloudflare.com/workers/wrangler/
- **GitHub Actions**: https://docs.github.com/en/actions
- **Issues**: Open a GitHub issue in your repository

---

**Happy deploying! 🚀**
