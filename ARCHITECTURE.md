# System Architecture

## High-Level Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Running Club Members                      │
│                   (Mark races in Strava)                      │
└────────────┬────────────────────────────────────────────────┘
             │
             │ OAuth Authorization
             ▼
┌─────────────────────────────────────────────────────────────┐
│                       Strava API v3                           │
│              (OAuth + Activity Endpoints)                     │
└────────────┬────────────────────────────────────────────────┘
             │
             │ Rate Limited: 100/15min, 1000/day
             ▼
┌─────────────────────────────────────────────────────────────┐
│                  Cloudflare Workers                           │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  OAuth Handlers         API Endpoints                 │   │
│  │  • /auth/authorize      • /api/races                  │   │
│  │  • /auth/callback       • /api/stats                  │   │
│  │  • /auth/disconnect     • /api/athletes               │   │
│  │                         • /api/sync                   │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Scheduled Cron Job (Daily 2 AM UTC)                  │   │
│  │  • Batch fetch activities (20 athletes/batch)         │   │
│  │  • Filter for races (workout_type === 1)              │   │
│  │  • Auto-refresh expired tokens                        │   │
│  │  • Log sync stats & rate limits                       │   │
│  └──────────────────────────────────────────────────────┘   │
└────────────┬────────────────────────────────────────────────┘
             │
             │ D1 Binding
             ▼
┌─────────────────────────────────────────────────────────────┐
│                  Cloudflare D1 (SQLite)                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │   athletes   │  │    races     │  │  sync_logs   │       │
│  ├──────────────┤  ├──────────────┤  ├──────────────┤       │
│  │ strava_id    │  │ athlete_id   │  │ started_at   │       │
│  │ tokens       │  │ activity_id  │  │ completed_at │       │
│  │ name         │  │ distance     │  │ new_races    │       │
│  │ token_expiry │  │ time         │  │ rate_limits  │       │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
└────────────┬────────────────────────────────────────────────┘
             │
             │ REST API (JSON)
             ▼
┌─────────────────────────────────────────────────────────────┐
│               Cloudflare Pages (React SPA)                    │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Routes                                               │   │
│  │  • / (Home)           - Landing + Stats               │   │
│  │  • /dashboard         - Race Results Grid             │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Components                                           │   │
│  │  • Layout (Header/Footer)                             │   │
│  │  • RaceCard (Individual race display)                 │   │
│  │  • RaceFilters (Search/filter UI)                     │   │
│  └──────────────────────────────────────────────────────┘   │
└────────────┬────────────────────────────────────────────────┘
             │
             │ Browser
             ▼
┌─────────────────────────────────────────────────────────────┐
│                      Club Members                             │
│              (View races, connect accounts)                   │
└─────────────────────────────────────────────────────────────┘
```

## Data Flow

### 1. OAuth Connection Flow
```
User clicks "Connect"
    ↓
Frontend redirects to /auth/authorize
    ↓
Worker redirects to Strava OAuth
    ↓
User authorizes on Strava
    ↓
Strava redirects to /auth/callback?code=XXX
    ↓
Worker exchanges code for tokens
    ↓
Worker stores athlete + tokens in D1
    ↓
User sees success page
```

### 2. Daily Sync Flow
```
Cron triggers at 2 AM UTC
    ↓
Worker fetches all athletes from D1
    ↓
For each batch of 20 athletes:
    ├── Check if token expired → Refresh if needed
    ├── Fetch activities from Strava (after last_synced_at)
    ├── Filter for workout_type === 1 (races)
    ├── Check if race already in DB
    ├── Insert new races
    ├── Update last_synced_at
    ├── Log rate limit usage
    └── Delay 500ms before next athlete
    ↓
Wait 1 minute
    ↓
Process next batch
    ↓
Update sync_logs with completion stats
```

### 3. Dashboard View Flow
```
User navigates to /dashboard
    ↓
Frontend sends GET /api/races?filters
    ↓
Worker queries D1 with JOIN
    ↓
Returns races[] + pagination
    ↓
Frontend renders RaceCard components
    ↓
User applies filter
    ↓
Frontend refetches with new params
```

## Component Architecture

### Workers (Backend)

```
src/
├── index.ts              # Main entry point, request router
├── types.ts              # TypeScript interfaces
├── auth/
│   └── oauth.ts          # OAuth flow handlers
├── cron/
│   └── sync.ts           # Scheduled sync job
├── api/
│   └── races.ts          # API endpoints (races, stats, athletes)
└── utils/
    ├── strava.ts         # Strava API client functions
    └── db.ts             # D1 database helpers
```

### Frontend (React)

```
src/
├── main.tsx              # React entry point
├── App.tsx               # Route configuration
├── pages/
│   ├── Home.tsx          # Landing page
│   └── Dashboard.tsx     # Race results page
├── components/
│   ├── Layout.tsx        # Header + Footer wrapper
│   ├── RaceCard.tsx      # Individual race display
│   └── RaceFilters.tsx   # Filter UI
└── utils/
    └── (future)          # API client, helpers
```

## Key Design Decisions

### 1. Serverless Architecture
**Why**: No server maintenance, auto-scaling, pay-per-use pricing (free tier sufficient)

### 2. Cloudflare D1 (SQLite)
**Why**: Built-in Workers integration, SQL familiarity, relational data model fits perfectly

### 3. Daily Sync (not real-time)
**Why**: Strava rate limits prevent real-time for 200 users, daily is sufficient for race results

### 4. Batch Processing with Delays
**Why**: Respects rate limits while maximizing throughput, prevents quota exhaustion

### 5. Token Refresh on Demand
**Why**: Reduces unnecessary API calls, only refresh when needed

### 6. React SPA (no SSR)
**Why**: Simple deployment to Pages, no backend rendering needed, client-side filtering is fast

## Database Schema

### athletes
Primary table for connected users and OAuth tokens
```sql
athletes (
  id INTEGER PRIMARY KEY,
  strava_id INTEGER UNIQUE,
  firstname, lastname, profile_photo,
  access_token, refresh_token, token_expiry,
  created_at, updated_at, last_synced_at
)
```

### races
Race activities with all metrics
```sql
races (
  id INTEGER PRIMARY KEY,
  athlete_id → athletes(id) CASCADE,
  strava_activity_id INTEGER UNIQUE,
  name, distance, elapsed_time, moving_time,
  date, elevation_gain,
  average_heartrate, max_heartrate,
  created_at
)
```

### sync_logs
Audit trail for monitoring
```sql
sync_logs (
  id INTEGER PRIMARY KEY,
  sync_started_at, sync_completed_at,
  athletes_processed, activities_fetched,
  new_races_added, errors_encountered,
  rate_limit_remaining, status, error_message
)
```

## Security Considerations

### Token Storage
- OAuth tokens stored in D1 (encrypted at rest by Cloudflare)
- No tokens exposed to frontend
- Automatic token rotation

### CORS
- API endpoints allow cross-origin requests for frontend
- Preflight OPTIONS handling

### Secrets Management
- Strava credentials in Wrangler secrets (not in code)
- Separate dev/prod environments

### GDPR Compliance
- DELETE endpoint for athlete data removal
- Minimal data retention policy
- Clear privacy documentation

## Performance Optimizations

### Database
- Indexes on frequently queried columns (athlete_id, date, distance)
- JOIN optimization for race listing
- Pagination support (limit/offset)

### API
- Filtered queries at DB level (not in-memory)
- Efficient SQL with WHERE clauses
- COUNT query separate from data fetch

### Frontend
- Vite for fast builds and HMR
- Code splitting by route
- Lazy loading of components (future)

## Monitoring & Observability

### Metrics to Track
1. **Sync Success Rate**: `sync_logs.status = 'completed'` %
2. **Rate Limit Usage**: `sync_logs.rate_limit_remaining`
3. **Token Refresh Failures**: Worker logs
4. **API Response Times**: Cloudflare Analytics
5. **New Races Per Day**: `sync_logs.new_races_added`

### Logs Available
- Cloudflare Workers logs (via dashboard or `wrangler tail`)
- GitHub Actions workflow logs
- Browser console (frontend errors)

### Alerts to Set Up
- Sync failures > 3 consecutive days
- Rate limit usage > 950/1000
- Token refresh failures > 10% of athletes
- Zero new races for > 7 days (if athletes active)

## Scaling Considerations

### Current Capacity
- **Athletes**: 200 (can scale to 1000 with adjustments)
- **API Requests**: 100,000/day (free tier)
- **Database**: 5M rows (free tier) = ~5000 races/athlete
- **Bandwidth**: 100 GB/month (free tier)

### To Scale Beyond 200 Athletes
1. Increase batch delays (e.g., 2 min between batches)
2. Run sync twice daily instead of once
3. Implement priority queuing (most active athletes first)
4. Cache frequently accessed data

### To Add Real-Time Features
- Use Webhooks (Strava subscription events)
- Requires paid tier for webhook handling
- Would reduce API calls dramatically

## Deployment Pipeline

```
Developer pushes to GitHub
    ↓
GitHub Actions triggered
    ↓
┌─────────────────────┐     ┌─────────────────────┐
│  Deploy Workers     │     │  Deploy Frontend    │
│  1. npm install     │     │  1. npm install     │
│  2. wrangler deploy │     │  2. npm run build   │
└─────────────────────┘     │  3. wrangler pages  │
                            └─────────────────────┘
    ↓                            ↓
Workers live at              Pages live at
workers.[domain]             [domain].pages.dev
    ↓                            ↓
Custom domain routing (optional)
```

## Future Architecture Enhancements

### Phase 2 Ideas
- **Cache Layer**: Redis/KV for frequently accessed data
- **Background Jobs**: Queue system for long-running tasks
- **Webhooks**: Real-time sync via Strava events
- **Analytics**: Custom dashboard for club admins
- **Multi-tenant**: Support multiple clubs in one deployment

---

**Architecture Status**: ✅ Production Ready
**Last Updated**: 2024-11-10
