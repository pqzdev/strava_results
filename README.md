# Strava Running Club Results Aggregator

A complete web application that automatically aggregates race results from Strava and parkrun for running clubs. Built for clubs with 200+ members, fully open source, and deployable in under an hour.

**This guide is specifically written to help clubs replicate this system for their own use.**

---

## Table of Contents

1. [Is This Right For Your Club?](#is-this-right-for-your-club)
2. [Quick Replication Checklist](#quick-replication-checklist)
3. [What You'll Get](#what-youll-get)
4. [Costs](#costs)
5. [Prerequisites](#prerequisites)
6. [Complete Setup Guide](#complete-setup-guide)
7. [Customizing For Your Club](#customizing-for-your-club)
8. [Running Your Club System](#running-your-club-system)
9. [parkrun Integration](#parkrun-integration)
10. [Troubleshooting](#troubleshooting)
11. [Technical Reference](#technical-reference)
12. [Contributing](#contributing)

---

## Is This Right For Your Club?

### This system is ideal if your club:
- Has members who use Strava to track their runs
- Wants to automatically collect race results from members
- Would like to track parkrun participation
- Has at least one person comfortable with following technical setup instructions
- Wants a free, self-hosted solution (no monthly fees)

### What it does:
- Members connect via Strava OAuth (one-click authorization)
- Automatically syncs all activities marked as "Race" in Strava
- Weekly automated sync keeps results up to date
- Optional parkrun result tracking (admin-managed)
- Public dashboard shows all club race results
- Admin panel for managing users and data

### What it requires:
- One person to do initial setup (1-2 hours)
- One admin to occasionally manage users and trigger syncs
- Members must mark races as "Race" workout type in Strava

---

## Quick Replication Checklist

Here's everything you need to set up this system for your club:

### Accounts Needed (all free)
- [ ] GitHub account (to fork and deploy the code)
- [ ] Cloudflare account (to host the application)
- [ ] Strava API application (to access member data)
- [ ] Google Cloud project (optional, for admin authentication)

### Information You'll Need
- [ ] Your club's Strava Club ID (found in club URL)
- [ ] Your club name and branding colors
- [ ] Your parkrun club number (if using parkrun integration)
- [ ] Email for the first admin user

### Time Estimates
| Task | Time |
|------|------|
| Creating accounts and API apps | 15-20 minutes |
| Forking and configuring code | 15-20 minutes |
| Deploying to Cloudflare | 10-15 minutes |
| Testing and first sync | 10-15 minutes |
| **Total** | **~1 hour** |

---

## What You'll Get

### For Club Members

**Automatic Race Tracking**
- Connect with Strava once, then forget about it
- All races automatically appear in the club dashboard
- View personal stats alongside clubmates
- Filter by date, distance, event, or athlete

**parkrun Results** (if enabled)
- Separate parkrun dashboard
- Historical parkrun data
- Weekly summaries

### For Administrators

**Admin Dashboard**
- View all connected members
- See sync status and race counts
- Trigger manual syncs when needed
- Manage user visibility and permissions

**Data Management**
- Edit race names and distances
- Classify events with AI assistance
- Import parkrun results
- GDPR-compliant data deletion

### Screenshots

The application includes:
- **Home page** - Landing page explaining the service
- **Race Dashboard** - Sortable, filterable table of all club races
- **parkrun Dashboard** - Dedicated parkrun results view
- **Admin Panel** - Multi-tab interface for management
- **Sync Monitor** - Real-time view of sync progress

---

## Costs

### Cloudflare Free Tier (covers most clubs)

| Resource | Free Tier Limit | Typical Club Usage |
|----------|-----------------|-------------------|
| Worker Requests | 100,000/day | ~1,000/day |
| D1 Database Reads | 5M/day | ~10,000/day |
| D1 Database Writes | 100,000/day | ~1,000/day |
| D1 Storage | 5GB | ~100MB |
| Pages Bandwidth | Unlimited | ~1GB/month |

**Bottom line**: A club with 200+ members fits comfortably in the free tier.

### When You Might Need Paid Plans

- **Very large clubs (500+)** during initial sync of historical data
- **Very frequent manual syncs** (more than several times daily)
- **Custom domain** with Cloudflare (optional, ~$10/year for domain)

### Other Potential Costs

- **Domain name** (optional): ~$10-15/year
- **GitHub** (always free for public repos)
- **Strava API** (free)

---

## Prerequisites

Before starting, ensure you have:

### 1. Technical Requirements
- **Node.js 18+** installed ([Download](https://nodejs.org/))
- **Git** installed ([Download](https://git-scm.com/))
- Basic comfort with command line/terminal
- A code editor (VS Code recommended)

### 2. Accounts to Create

#### Cloudflare Account
1. Go to [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up)
2. Sign up with email
3. Verify your email

#### Strava API Application
1. Go to [strava.com/settings/api](https://www.strava.com/settings/api)
2. Click "Create Application" (you may need to agree to terms)
3. Fill in the form:
   - **Application Name**: `[Your Club] Race Results`
   - **Category**: `Visualizer`
   - **Website**: `http://localhost:3000` (will update later)
   - **Application Description**: `Aggregates race results for [Club Name]`
   - **Authorization Callback Domain**: `localhost`
4. Save your **Client ID** and **Client Secret** somewhere safe

#### Google Cloud Project (Optional - for admin auth)
If you want admins to log in with Google instead of Strava:
1. Go to [console.cloud.google.com](https://console.cloud.google.com/)
2. Create a new project
3. Go to "APIs & Services" > "Credentials"
4. Create OAuth 2.0 Client ID
5. Set authorized redirect URI to your production URL + `/auth/google/callback`

---

## Complete Setup Guide

### Step 1: Fork and Clone the Repository

```bash
# Fork on GitHub first, then clone your fork
git clone https://github.com/YOUR_USERNAME/strava-club-results.git
cd strava-club-results

# Install all dependencies
npm install
```

### Step 2: Install Wrangler CLI

```bash
npm install -g wrangler

# Log in to Cloudflare
wrangler login
```

This opens a browser window - authorize the CLI to access your Cloudflare account.

### Step 3: Create Your Database

```bash
# Create a new D1 database
wrangler d1 create strava-club-db
```

**Important**: Copy the `database_id` from the output. It looks like: `4b79f9e5-f6bb-4cd9-852b-51e2c0a7c5d1`

### Step 4: Configure Your Application

#### 4a. Update database configuration

Edit `workers/wrangler.workers.toml`:

```toml
name = "your-club-workers"  # Change to your club name

[[d1_databases]]
binding = "DB"
database_name = "strava-club-db"
database_id = "YOUR_DATABASE_ID_HERE"  # Paste your ID here
```

#### 4b. Update environment variables

In the same file, update the `[vars]` section:

```toml
[vars]
STRAVA_REDIRECT_URI = "http://localhost:3000/auth/callback"  # For local dev
STRAVA_CLUB_ID = "YOUR_CLUB_ID"  # Find this in your club's Strava URL
```

#### 4c. Create local development secrets

Create `workers/.dev.vars`:

```env
STRAVA_CLIENT_ID=your_strava_client_id
STRAVA_CLIENT_SECRET=your_strava_client_secret
# Add these if using Google OAuth
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
```

### Step 5: Initialize the Database

```bash
cd workers
npm run migrate
cd ..
```

This creates all the necessary tables and indexes.

### Step 6: Test Locally

Open two terminal windows:

**Terminal 1 - Start the backend:**
```bash
cd workers
npm run dev
```

**Terminal 2 - Start the frontend:**
```bash
cd frontend
npm run dev
```

Visit `http://localhost:3000` and test:
1. Click "Connect with Strava"
2. Authorize the application
3. You should be redirected back and see your profile

### Step 7: Deploy to Production

#### 7a. Set production secrets

```bash
cd workers

# Set each secret (you'll be prompted to enter values)
wrangler secret put STRAVA_CLIENT_ID
wrangler secret put STRAVA_CLIENT_SECRET

# If using Google OAuth
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET

# For parkrun import API
wrangler secret put PARKRUN_API_KEY
# Generate a random string for this, e.g.: openssl rand -hex 32
```

#### 7b. Update production configuration

Edit `workers/wrangler.workers.toml`:

```toml
[vars]
STRAVA_REDIRECT_URI = "https://your-club.pages.dev/auth/callback"
# Or with custom domain:
# STRAVA_REDIRECT_URI = "https://results.yourclub.com/auth/callback"
```

#### 7c. Set up GitHub Actions for automatic deployment

Add these secrets to your GitHub repository (Settings > Secrets and variables > Actions):

- `CLOUDFLARE_API_TOKEN`: Create at [Cloudflare API Tokens](https://dash.cloudflare.com/profile/api-tokens)
  - Use template "Edit Cloudflare Workers"
  - Add permissions: Account.D1 (Edit), Account.Cloudflare Pages (Edit)
- `CLOUDFLARE_ACCOUNT_ID`: Found in Cloudflare dashboard sidebar

#### 7d. Deploy

Push to your main branch:

```bash
git add .
git commit -m "Configure for [Your Club Name]"
git push origin main
```

GitHub Actions will automatically:
1. Run database migrations
2. Deploy Workers to Cloudflare
3. Build and deploy frontend to Cloudflare Pages

### Step 8: Update Strava Application Settings

Go back to [strava.com/settings/api](https://www.strava.com/settings/api) and update:

- **Website**: Your production URL
- **Authorization Callback Domain**: Your production domain (without https://)
  - Example: `your-club.pages.dev` or `results.yourclub.com`

### Step 9: Create Your Admin Account

1. Visit your production site
2. Click "Connect with Strava" and authorize
3. Access your D1 database in Cloudflare dashboard:
   - Go to Workers & Pages > D1
   - Click your database
   - Go to "Console" tab
4. Run this SQL (replace with your Strava ID):

```sql
UPDATE athletes SET is_admin = 1 WHERE strava_id = YOUR_STRAVA_ID;
```

To find your Strava ID: it's in the URL when you view your Strava profile.

### Step 10: Test Everything

1. Visit `/admin` - you should see the admin panel
2. Go to "Sync Queue" tab and trigger a sync for yourself
3. Watch the sync progress in "Sync Logs" tab
4. Check the main dashboard - your races should appear!

---

## Customizing For Your Club

### Essential Customizations

#### Club Name and Branding

Edit `frontend/src/components/Layout.tsx`:

```tsx
// Find and update:
<h1>Your Club Name Results</h1>
```

Edit `frontend/src/pages/Home.tsx` to update the welcome text.

#### Brand Colors

Edit `frontend/src/index.css`:

```css
:root {
  --primary-color: #667eea;      /* Your primary brand color */
  --secondary-color: #764ba2;    /* Your accent color */
  --background-color: #f5f5f5;
  --text-color: #333;
}
```

#### Page Title and Meta

Edit `frontend/index.html`:

```html
<title>Your Club Name - Race Results</title>
<meta name="description" content="Race results for Your Club Name">
```

### Optional Customizations

#### Sync Schedule

Edit `workers/wrangler.workers.toml`:

```toml
[triggers]
crons = ["0 2 * * 1"]  # Default: Monday 2 AM UTC
```

Common schedules:
- `"0 2 * * 1"` - Weekly on Monday at 2 AM
- `"0 2 * * *"` - Daily at 2 AM
- `"0 2 * * 1,4"` - Monday and Thursday at 2 AM

#### Home Page Content

Edit `frontend/src/pages/Home.tsx` to:
- Add your club logo
- Update welcome message
- Add links to your club website
- Customize the "how to connect" instructions

#### Distance Filters

The default distance filters in the dashboard can be customized in `frontend/src/components/RaceFilters.tsx`.

---

## Running Your Club System

### Weekly Admin Tasks

1. **Check sync status** (Monday morning)
   - Visit `/admin` > "Sync Queue" tab
   - Ensure the automatic sync ran successfully
   - Check for any athletes stuck in "syncing" status

2. **Review event suggestions** (as needed)
   - Visit `/admin` > "Events" tab
   - Approve or reject AI-suggested event names
   - This helps with filtering and statistics

### Handling New Members

When club members want to join:
1. Direct them to your results site
2. They click "Connect with Strava"
3. They authorize the application
4. Their data syncs automatically with the next scheduled sync
5. Or trigger a manual sync for them via admin panel

### Handling Member Departures

When a member wants their data removed:
1. They can delete their own data by visiting `/auth/disconnect`
2. Or an admin can delete them from the admin panel
3. This removes all their data (GDPR compliant)

### Monitoring Sync Health

Signs of problems:
- Multiple athletes stuck in "syncing" for more than 1 hour
- Errors in sync logs
- No new activities appearing

Solutions:
- Use "Reset Stuck Syncs" button in admin panel
- Check Cloudflare dashboard for Worker errors
- Review rate limit status (Strava allows 100 req/15min)

---

## parkrun Integration

### Overview

parkrun doesn't have a public API, so results are collected using a browser-based tool and imported by an admin.

### Setting Up parkrun Collection

#### 1. Find Your parkrun Club Number

- Go to parkrun.com
- Navigate to your club's results page
- The club number is in the URL: `clubNum=XXXX`

#### 2. Configure the Scraper

Edit `scripts/parkrun-automated.js`:

```javascript
const CLUB_NUMBER = 'YOUR_CLUB_NUMBER';
const API_ENDPOINT = 'https://your-workers-url/api/parkrun/import';
```

#### 3. Set Up Automated Collection (Optional)

The repository includes a GitHub Actions workflow for automated weekly collection.

Edit `.github/workflows/parkrun-scraper.yml`:

```yaml
env:
  PARKRUN_API_ENDPOINT: https://your-workers-url/api/parkrun/import
  PARKRUN_API_KEY: ${{ secrets.PARKRUN_API_KEY }}
```

Add `PARKRUN_API_KEY` to your GitHub repository secrets.

### Manual Collection Process

1. Go to `https://www.parkrun.com/results/consolidatedclub/?clubNum=YOUR_CLUB_NUMBER`
2. Open browser console (F12 or Cmd+Option+J)
3. Paste the contents of `scripts/parkrun-smart-scraper.js`
4. Press Enter and wait for collection to complete
5. Results are automatically imported to your database

### Weekly parkrun Routine

**If using automation**: Results are collected every Sunday at 12:00 UTC.

**If collecting manually**:
1. Run the scraper on Sunday afternoon (after parkrun results are published)
2. Check the parkrun dashboard to verify import
3. Hide any athletes who shouldn't appear (privacy)

---

## Troubleshooting

### Common Setup Issues

#### "Cannot find module 'wrangler'"
```bash
npm install -g wrangler
```

#### "Database binding not found"
- Check that `database_id` in `wrangler.workers.toml` matches your D1 database
- Run migrations: `cd workers && npm run migrate`

#### OAuth "redirect_uri_mismatch"
- Verify redirect URI in `wrangler.workers.toml` matches exactly what's in Strava API settings
- Don't include trailing slash
- Ensure protocol matches (http for localhost, https for production)

#### "This app is not verified" (Google OAuth)
- This appears during development
- Click "Advanced" then "Go to [app name] (unsafe)"
- For production, submit your app for Google verification

### Operational Issues

#### Activities Not Appearing

Check that in Strava:
1. Activity type is "Run" (not Walk, Ride, etc.)
2. Workout type is "Race" (edit activity > change workout type)
3. Activity was created after the athlete connected

#### Sync Stuck in Progress

1. Wait 10 minutes (large backlogs take time)
2. Check sync logs for errors
3. Use "Reset Stuck Syncs" in admin panel
4. If persistent, manually update database:
   ```sql
   UPDATE athletes SET sync_status = 'idle' WHERE sync_status = 'syncing';
   ```

#### Rate Limit Errors

Strava limits: 100 requests/15 minutes, 1000/day

Solutions:
- Reduce batch size in `workers/src/cron/sync.ts`
- Increase delay between batches
- Spread manual syncs throughout the day

#### Frontend Build Errors

```bash
cd frontend
npm install
npm run build
```

If TypeScript errors appear, they must be fixed before deployment.

### Getting Help

1. Check the [GitHub Issues](https://github.com/yourusername/strava-club-results/issues)
2. Review Cloudflare Worker logs in dashboard
3. Check browser console for frontend errors
4. Review sync logs in admin panel

---

## Technical Reference

### Architecture Overview

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────┐
│   Frontend  │────▶│ Cloudflare Pages │────▶│   Browser   │
│   (React)   │     │   (Static CDN)   │     │             │
└─────────────┘     └──────────────────┘     └─────────────┘
                              │
                              ▼
┌─────────────┐     ┌──────────────────┐     ┌─────────────┐
│   Workers   │────▶│    Cloudflare    │────▶│  Strava API │
│  (Backend)  │     │     Workers      │     │             │
└─────────────┘     └──────────────────┘     └─────────────┘
                              │
                              ▼
                    ┌──────────────────┐
                    │   Cloudflare D1  │
                    │    (SQLite DB)   │
                    └──────────────────┘
```

### Tech Stack

| Component | Technology |
|-----------|------------|
| Frontend | React 18, TypeScript, Vite |
| Backend | Cloudflare Workers, TypeScript |
| Database | Cloudflare D1 (SQLite) |
| Hosting | Cloudflare Pages + Workers |
| CI/CD | GitHub Actions |
| APIs | Strava API v3, Google OAuth 2.0 |

### Project Structure

```
strava-club-results/
├── workers/                    # Backend (Cloudflare Workers)
│   ├── src/
│   │   ├── api/               # API route handlers
│   │   │   ├── admin.ts       # Admin endpoints
│   │   │   ├── races.ts       # Race data endpoints
│   │   │   ├── parkrun.ts     # parkrun endpoints
│   │   │   └── events.ts      # Event classification
│   │   ├── auth/              # OAuth handlers
│   │   ├── cron/              # Scheduled sync jobs
│   │   ├── queue/             # Sync queue processing
│   │   ├── middleware/        # Auth middleware
│   │   ├── utils/             # Database, Strava client
│   │   └── index.ts           # Main router
│   ├── wrangler.workers.toml  # Cloudflare configuration
│   └── package.json
├── frontend/                   # Frontend (React)
│   ├── src/
│   │   ├── components/        # Reusable UI components
│   │   ├── pages/             # Page components
│   │   │   ├── Dashboard.tsx  # Race results view
│   │   │   ├── Admin.tsx      # Admin panel
│   │   │   ├── Parkrun.tsx    # parkrun results
│   │   │   └── SyncMonitor.tsx
│   │   ├── utils/             # API client
│   │   └── index.css          # Global styles
│   └── package.json
├── database/
│   ├── schema.sql             # Database schema
│   └── migrations/            # Migration files
├── scripts/                   # Utility scripts
│   └── parkrun-automated.js   # parkrun scraper
├── docs/                      # Additional documentation
├── .github/workflows/         # CI/CD configuration
│   ├── deploy.yml             # Main deployment
│   └── parkrun-scraper.yml    # parkrun automation
└── README.md
```

### Database Schema

#### Core Tables

**athletes** - Connected Strava users
```sql
strava_id, firstname, lastname, profile_photo
access_token, refresh_token, token_expiry
is_admin, is_hidden, is_blocked
sync_status, last_synced_at
```

**races** - Synced race activities
```sql
athlete_id, strava_activity_id
name, distance, elapsed_time, moving_time
date, elevation_gain
average_heartrate, max_heartrate
event_name, is_hidden
```

**parkrun_results** - Imported parkrun data
```sql
athlete_name, parkrun_athlete_id
event_name, event_number, date
position, time_seconds, age_grade
```

**sync_logs** - Sync operation logs
```sql
athlete_id, sync_session_id
log_level, message, metadata
created_at
```

See `database/schema.sql` for complete schema with all tables and indexes.

### API Endpoints

#### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/auth/authorize` | Start Strava OAuth |
| GET | `/auth/callback` | OAuth callback |
| GET | `/auth/me` | Get current user |
| DELETE | `/auth/disconnect` | Delete all user data |

#### Public API
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/races` | Get races with filters |
| GET | `/api/stats` | Aggregate statistics |
| GET | `/api/athletes` | List athletes |

#### Admin API
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/athletes` | All athletes with details |
| POST | `/api/admin/athletes/:id/sync` | Trigger sync |
| POST | `/api/admin/reset-stuck-syncs` | Reset stuck syncs |
| PATCH | `/api/admin/athletes/:id` | Update athlete |
| DELETE | `/api/admin/athletes/:id` | Delete athlete |

#### parkrun API
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/parkrun/results` | Get results |
| GET | `/api/parkrun/stats` | Statistics |
| POST | `/api/parkrun/import` | Import CSV |

### Environment Variables

#### Development (`workers/.dev.vars`)
```env
STRAVA_CLIENT_ID=xxx
STRAVA_CLIENT_SECRET=xxx
GOOGLE_CLIENT_ID=xxx
GOOGLE_CLIENT_SECRET=xxx
```

#### Production (set via `wrangler secret put`)
```
STRAVA_CLIENT_ID
STRAVA_CLIENT_SECRET
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
PARKRUN_API_KEY
```

#### Configuration (`wrangler.workers.toml`)
```toml
[vars]
STRAVA_REDIRECT_URI = "https://..."
STRAVA_CLUB_ID = "1234"
```

### Deployment

#### Automatic (Recommended)

Push to main branch triggers GitHub Actions:
1. Runs database migrations
2. Deploys Workers
3. Builds and deploys frontend

#### Manual

```bash
# Deploy Workers
cd workers
npm run migrate:remote
npm run deploy

# Deploy Frontend
cd frontend
npm run build
npx wrangler pages deploy dist --project-name=your-project
```

### Sync System Details

The sync system uses a queue-based approach to handle Strava's rate limits:

1. **Cron Trigger** (Monday 2 AM): Adds all athletes to sync queue
2. **Queue Processor** (every 2 minutes): Processes queued syncs
3. **Batch Processing**: Large activity lists split into batches
4. **Rate Limiting**: Respects 100 req/15min, 1000 req/day

Configuration in `workers/src/cron/sync.ts`:
```typescript
const batchSize = 20;              // Athletes per batch
const delayBetweenBatches = 60000; // 1 minute between batches
```

---

## Contributing

Contributions are welcome! If you've improved this system for your club, please consider contributing back.

### How to Contribute

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Make your changes
4. Test locally
5. Commit: `git commit -m "Add your feature"`
6. Push: `git push origin feature/your-feature`
7. Open a Pull Request

### Areas for Contribution

- Documentation improvements
- Bug fixes
- Performance optimizations
- New features (discuss in Issues first)
- Translations

---

## License

MIT License - see LICENSE file for details.

---

## Support

- **Documentation**: This README and files in `docs/`
- **Issues**: [GitHub Issues](https://github.com/yourusername/strava-club-results/issues)
- **Strava API**: [developers.strava.com/docs](https://developers.strava.com/docs/)
- **Cloudflare Workers**: [developers.cloudflare.com](https://developers.cloudflare.com/workers/)

---

## Credits

Built with:
- [Strava API](https://developers.strava.com/)
- [Cloudflare Workers](https://workers.cloudflare.com/)
- [React](https://react.dev/)
- [Vite](https://vitejs.dev/)

---

**Estimated setup time**: ~1 hour for complete deployment

*Built by runners, for running clubs.*
