# Strava Running Club Aggregator

A full-featured web application that automatically aggregates race results from Strava and parkrun for running clubs. Built for clubs with 200+ members, fully open source and deployable in under 20 minutes.

## ✨ Features

### Strava Integration
- **OAuth Authentication** - Secure one-click connection for club members
- **Automatic Race Syncing** - Weekly sync of activities marked as "Race" in Strava
- **Manual Sync Control** - Admin panel for triggering individual or batch syncs
- **Real-time Sync Monitoring** - Live view of sync progress with detailed logs
- **Event Classification** - AI-powered event name detection and classification

### parkrun Integration
- **Manual Data Collection** - Admins process parkrun results using a browser-based tool
- **CSV Import** - Upload processed results via admin panel
- **Athlete Matching** - Smart matching of parkrun athletes to Strava profiles
- **Historical Data** - Track parkrun history alongside Strava races
- **Date-based Filtering** - View specific parkrun events by date

### Dashboard & Analytics
- **Unified Race View** - Combined Strava and parkrun results in one place
- **Advanced Filtering** - Filter by athlete, date, distance, and event
- **Statistics** - Aggregate stats: total races, distance, participants
- **Mobile Responsive** - Works seamlessly on all devices

### Admin Panel
- **User Management** - View all connected athletes, their sync status, and race counts
- **Sync Control** - Start/stop syncs, reset stuck syncs, view sync logs
- **Event Management** - Review and approve AI-suggested event names
- **parkrun Management** - Control athlete visibility and data
- **GDPR Compliance** - Full data deletion support for athletes

## 🛠 Tech Stack

- **Frontend**: React 18 + TypeScript + Vite
- **Backend**: Cloudflare Workers (serverless)
- **Database**: Cloudflare D1 (SQLite)
- **AI**: Cloudflare Workers AI (event classification)
- **API**: Strava API v3
- **Hosting**: Cloudflare Pages + Workers
- **CI/CD**: GitHub Actions

## 📋 Prerequisites

1. **Node.js 18+** and npm
2. **Cloudflare Account** ([Sign up free](https://dash.cloudflare.com/sign-up))
3. **Strava API Application** ([Register here](https://www.strava.com/settings/api))
4. **Wrangler CLI**: `npm install -g wrangler`

## 🚀 Quick Start

### 1. Clone and Install

```bash
git clone https://github.com/yourusername/strava-club-results.git
cd strava-club-results
npm install
```

### 2. Register Strava API Application

1. Visit https://www.strava.com/settings/api
2. Click "Create Application"
3. Fill in:
   - **Application Name**: `[Your Club Name] Race Results`
   - **Category**: `Visualizer`
   - **Website**: `http://localhost:3000` (update later for production)
   - **Authorization Callback Domain**: `localhost`
4. Save your **Client ID** and **Client Secret**

### 3. Set Up Cloudflare

```bash
# Log in to Cloudflare
wrangler login

# Create D1 database
wrangler d1 create strava-club-db
```

**Copy the `database_id` from the output!**

Update `workers/wrangler.workers.toml` with your database ID:

```toml
[[d1_databases]]
binding = "DB"
database_name = "strava-club-db"
database_id = "YOUR_DATABASE_ID_HERE"
```

### 4. Initialize Database

```bash
# Run all migrations
cd workers
npm run migrate

# Or manually:
wrangler d1 execute strava-club-db --file=../database/schema.sql
```

### 5. Configure Secrets

For **local development**, create `workers/.dev.vars`:

```env
STRAVA_CLIENT_ID=your_client_id
STRAVA_CLIENT_SECRET=your_client_secret
```

For **production**, set secrets via Wrangler:

```bash
cd workers
wrangler secret put STRAVA_CLIENT_ID
# Enter your Strava Client ID

wrangler secret put STRAVA_CLIENT_SECRET
# Enter your Strava Client Secret
```

### 6. Update Configuration

Edit `workers/wrangler.workers.toml`:

```toml
[vars]
STRAVA_REDIRECT_URI = "http://localhost:3000/auth/callback"  # For local dev
# STRAVA_REDIRECT_URI = "https://your-domain.com/auth/callback"  # For production
```

### 7. Run Locally

Open two terminal windows:

**Terminal 1 - Backend (Workers):**
```bash
cd workers
npm run dev
# Runs on http://localhost:8787
```

**Terminal 2 - Frontend:**
```bash
cd frontend
npm run dev
# Runs on http://localhost:3000
```

Visit http://localhost:3000 and click "Connect with Strava" to test!

## 🌐 Deploy to Production

### Option A: Automatic Deployment with GitHub Actions (Recommended)

1. **Set GitHub Secrets** in your repository settings:
   - `CLOUDFLARE_API_TOKEN` - Create at https://dash.cloudflare.com/profile/api-tokens
     - Use template: "Edit Cloudflare Workers"
     - Permissions: Account.D1, Account.Workers Scripts, Account.Cloudflare Pages
   - `CLOUDFLARE_ACCOUNT_ID` - Found in Cloudflare dashboard URL

2. **Update Strava Redirect URI**:
   - Edit `workers/wrangler.workers.toml` and set production redirect URI
   - Update your Strava API app at https://www.strava.com/settings/api

3. **Push to main branch**:
```bash
git add .
git commit -m "Deploy to production"
git push origin main
```

GitHub Actions will automatically:
- Deploy Workers with migrations
- Build and deploy Frontend to Cloudflare Pages
- Configure automatic deployments for future pushes

### Option B: Manual Deployment

```bash
# Deploy Workers
cd workers
npm run deploy

# Deploy Frontend
cd frontend
npm run build
npx wrangler pages deploy dist --project-name=your-project-name
```

### Post-Deployment Setup

1. **Update Strava Application**:
   - Go to https://www.strava.com/settings/api
   - Update **Authorization Callback Domain** to your production domain
   - Update **Website** URL

2. **Create First Admin User**:
   - Connect with Strava on your production site
   - Access your D1 database in Cloudflare dashboard
   - Run: `UPDATE athletes SET is_admin = 1 WHERE strava_id = YOUR_STRAVA_ID`

3. **Test the Setup**:
   - Visit `/admin` on your site
   - Trigger a manual sync
   - Check the sync monitor

## 📖 Usage Guide

### For Club Members

1. Visit your club's site
2. Click "Connect with Strava"
3. Authorize the application
4. Mark races as "Race" workout type in Strava
5. Results sync automatically every Monday at 2 AM UTC
6. View all your races and compare with clubmates!

### For Administrators

Access the admin panel at `/admin`:

#### User Management
- View all connected athletes
- See sync status, race counts, and last sync time
- Mark users as admin, hide from dashboard, or block
- Delete athlete data (GDPR compliance)

#### Sync Management
- **Start Sync** - Trigger manual sync for individual athletes
- **Stop Sync** - Cancel in-progress syncs
- **Sync Monitor** - View real-time sync progress with detailed logs
- **Reset Stuck Syncs** - Reset any syncs stuck in "in_progress"

#### Event Classification
- Review AI-suggested event names (e.g., "parkrun", "City Marathon")
- Approve or reject suggestions
- Trigger bulk event analysis

#### parkrun Management
- Process parkrun results using browser-based data collection tool
- Import CSV results via admin panel
- Match parkrun athletes to Strava profiles
- Control visibility of parkrun athletes
- View parkrun-specific statistics

## 🏃 parkrun Integration

### Why Manual Collection?

parkrun doesn't currently provide a public API for accessing club results. Until an official API becomes available, club results need to be processed manually by an administrator.

### Collecting parkrun Results

1. **Access the Collection Tool**
   - Visit your deployed site at `https://your-domain.pages.dev/parkrun-smart-scraper.js`
   - Or find it in `frontend/public/parkrun-smart-scraper.js`

2. **Run the Browser Tool**
   - Go to https://www.parkrun.com/results/consolidatedclub/?clubNum=YOUR_CLUB_NUMBER
   - Open browser console (F12 or Cmd+Option+J on Mac)
   - Copy and paste the tool code from the file
   - Press Enter and wait for it to process all dates

3. **Import the Results**
   - The tool generates a CSV with all results
   - Go to your **Admin** panel
   - Navigate to the parkrun section
   - Upload the generated CSV file
   - Results are automatically matched to Strava athletes where possible

### Smart Athlete Matching

The system uses fuzzy matching to link parkrun and Strava profiles:
- Matches by first name + last name
- Case-insensitive, handles variations
- Manual review available in admin panel

### Future: API Integration

Once parkrun releases a public API, the collection tool can be replaced with automated sync similar to Strava integration.

## ⚙️ Configuration

### Sync Schedule

Edit `workers/wrangler.workers.toml` to change the cron schedule:

```toml
[triggers]
crons = ["0 2 * * 1"]  # Weekly Monday at 2 AM UTC
```

Examples:
- Daily at midnight: `"0 0 * * *"`
- Every 6 hours: `"0 */6 * * *"`
- Twice daily: `"0 6,18 * * *"`

### Rate Limit Adjustments

Strava API limits:
- 100 requests per 15 minutes
- 1,000 requests per day

Current defaults handle 200+ athletes comfortably. If needed, adjust in `workers/src/cron/sync.ts`:

```typescript
const batchSize = 20;              // Athletes per batch
const delayBetweenBatches = 60000; // 1 minute delay
```

### Styling and Branding

Edit `frontend/src/index.css`:

```css
:root {
  --primary-color: #667eea;      /* Main brand color */
  --secondary-color: #764ba2;    /* Accent color */
  --strava-orange: #FC4C02;      /* Strava brand */
}
```

Update club name in `frontend/src/components/Layout.tsx`

## 📊 Database Schema

### Main Tables

**athletes** - Strava users and OAuth tokens
```sql
- id, strava_id, access_token, refresh_token
- firstname, lastname, profile_photo
- sync_status, last_synced_at, total_activities_count
- is_admin, is_hidden, is_blocked
```

**races** - Strava race activities
```sql
- id, athlete_id, strava_activity_id
- name, distance, elapsed_time, moving_time
- date, elevation_gain
- average_heartrate, max_heartrate
- event_name (user/AI classified)
```

**parkrun_results** - parkrun race data
```sql
- id, athlete_name, athlete_id (FK to athletes)
- event_name, event_number, date
- position, time_seconds
```

**sync_logs** - Sync operation tracking
```sql
- athlete_id, sync_session_id
- log_level, message, metadata
- created_at
```

**sync_runs** - Sync session metadata
```sql
- athlete_id, session_id, status
- started_at, completed_at
- activities_synced, error_message
```

**event_suggestions** - AI event classifications
```sql
- race_id, suggested_event_name
- confidence, status
- admin_notes
```

See [database/schema.sql](database/schema.sql) for complete schema with indexes.

## 🔌 API Endpoints

### Authentication
- `GET /auth/authorize` - Initiate OAuth flow
- `GET /auth/callback` - OAuth callback handler
- `DELETE /auth/disconnect` - Delete athlete data (GDPR)

### Public API
- `GET /api/races` - Fetch races with filters
- `GET /api/stats` - Aggregate statistics
- `GET /api/athletes` - List connected athletes

### Admin API (requires admin auth)
- `GET /api/admin/athletes` - List all athletes with details
- `POST /api/admin/athletes/:id/sync` - Trigger sync
- `POST /api/admin/athletes/:id/sync/stop` - Stop sync
- `PATCH /api/admin/athletes/:id` - Update athlete fields
- `DELETE /api/admin/athletes/:id` - Delete athlete
- `GET /api/admin/sync-logs` - Get sync logs by session
- `POST /api/admin/reset-stuck-syncs` - Reset stuck syncs

### parkrun API
- `GET /api/parkrun/results` - Get parkrun results
- `GET /api/parkrun/stats` - parkrun statistics
- `GET /api/parkrun/athletes` - List parkrun athletes
- `POST /api/parkrun/import` - Import CSV data
- `PATCH /api/parkrun/athletes/:name` - Update athlete visibility

### Event Classification
- `GET /api/event-suggestions` - Get AI suggestions
- `POST /api/event-suggestions/analyze` - Trigger AI analysis
- `PATCH /api/event-suggestions/:id` - Approve/reject suggestion

## 🔒 Security & Privacy

### GDPR Compliance
- Minimal data storage (only necessary race metrics)
- Athletes can delete all their data via `/auth/disconnect`
- Admin panel supports full data deletion
- No third-party tracking or analytics

### OAuth Security
- Secure token storage in Cloudflare D1
- Automatic token refresh before expiry
- Tokens never exposed to frontend

### Admin Controls
- Admin-only endpoints require authentication
- Admin status set via database (not self-service)
- Audit logging for all admin actions

## 🐛 Troubleshooting

### "Database binding not found"
- Verify `database_id` in `workers/wrangler.workers.toml` matches your D1 database
- Run migrations: `npm run migrate` from workers directory

### OAuth Callback Errors
- Check redirect URI matches in:
  - `workers/wrangler.workers.toml` (`STRAVA_REDIRECT_URI`)
  - Strava API application settings
- Verify callback domain doesn't include `http://` or trailing slash

### Activities Not Syncing
Ensure activities in Strava:
1. Are marked as "Race" workout type (not just any run)
2. Are type "Run" (not Walk, Hike, etc.)
3. Were created after athlete connected

### Rate Limit Warnings
- Reduce `batchSize` in `workers/src/cron/sync.ts`
- Increase `delayBetweenBatches` to 2+ minutes
- Spread out manual syncs

### Sync Stuck "in_progress"
- Use admin panel to stop the sync
- Or reset all stuck syncs via `/api/admin/reset-stuck-syncs`
- Check sync logs for errors

## 📁 Project Structure

```
strava_results/
├── workers/                    # Cloudflare Workers backend
│   ├── src/
│   │   ├── api/               # API route handlers
│   │   │   ├── admin.ts       # Admin endpoints
│   │   │   ├── races.ts       # Race data endpoints
│   │   │   ├── parkrun.ts     # parkrun endpoints
│   │   │   └── events.ts      # Event classification
│   │   ├── auth/              # OAuth handlers
│   │   ├── cron/              # Scheduled jobs
│   │   ├── queue/             # Sync queue logic
│   │   ├── utils/             # Database, Strava API, logging
│   │   └── index.ts           # Main router
│   ├── wrangler.workers.toml  # Cloudflare config
│   └── package.json
├── frontend/                   # React frontend
│   ├── src/
│   │   ├── components/        # React components
│   │   ├── pages/             # Page components
│   │   │   ├── Dashboard.tsx  # Main race view
│   │   │   ├── Admin.tsx      # Admin panel
│   │   │   ├── Parkrun.tsx    # parkrun view
│   │   │   └── SyncMonitor.tsx # Sync logs
│   │   └── index.css          # Global styles
│   └── package.json
├── database/
│   ├── schema.sql             # Complete database schema
│   └── migrations/            # Migration files
├── docs/                      # Additional documentation
│   ├── PARKRUN_SCRAPER_GUIDE.md
│   └── PARKRUN_AUTOMATED_SYNC.md
├── .github/
│   └── workflows/
│       └── deploy.yml         # GitHub Actions CI/CD
└── README.md                  # This file
```

## 🤝 Contributing

Contributions welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run tests and ensure everything works locally
5. Commit your changes (`git commit -m 'Add amazing feature'`)
6. Push to the branch (`git push origin feature/amazing-feature`)
7. Open a Pull Request

## 💡 Future Enhancements

- [ ] Age-graded performance calculations
- [ ] Club championship tracking and scoring
- [ ] CSV/Excel export functionality
- [ ] Email notifications for new PRs
- [ ] Strava webhook support (real-time updates)
- [ ] Multi-club support
- [ ] Mobile app

## 📄 License

MIT License - see LICENSE file for details

## 🙏 Credits

Built with:
- [Strava API](https://developers.strava.com/)
- [Cloudflare Workers](https://workers.cloudflare.com/)
- [React](https://react.dev/)
- [Vite](https://vitejs.dev/)

## 📞 Support

- **Documentation**: You're reading it! See also `docs/` folder
- **Issues**: [GitHub Issues](https://github.com/yourusername/strava-club-results/issues)
- **Discussions**: [GitHub Discussions](https://github.com/yourusername/strava-club-results/discussions)
- **Strava API Docs**: https://developers.strava.com/docs/

---

**Built with ❤️ for running clubs everywhere**

*Estimated setup time: 15-20 minutes*
