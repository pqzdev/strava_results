```markdown
# Strava Running Club Aggregator

## Project Overview
Build a lightweight web application that aggregates race results from club members' Strava accounts. Target: ~200 runners. Open source for other clubs to use.

## Tech Stack
- **Frontend**: React app hosted on Cloudflare Pages
- **Backend**: Cloudflare Workers (serverless functions)
- **Database**: Cloudflare D1 (SQLite-based)
- **API Integration**: Strava API v3
- **Deployment**: GitHub Actions for CI/CD

## Core Requirements

### Phase 1 - MVP
1. **Strava OAuth Flow**
   - Allow runners to connect their Strava accounts
   - Store OAuth tokens securely in D1
   - Handle token refresh automatically

2. **Activity Fetching**
   - Scheduled Worker runs daily to fetch new activities from connected athletes
   - Filter for activities marked as "Race" in Strava
   - Respect Strava API rate limits (100 req/15min, 1000 req/day)
   - Batch requests intelligently for 200 athletes

3. **Data Storage (D1 Schema)**
   - `athletes` table: id, strava_id, name, access_token, refresh_token, token_expiry
   - `races` table: id, athlete_id, strava_activity_id, name, distance, elapsed_time, moving_time, date, elevation_gain
   - `race_calendar` table (optional for Phase 2): id, name, date, distance, location

4. **Frontend Views**
   - Landing page with Strava OAuth connection button
   - Dashboard showing:
     - Recent races across all connected athletes
     - Filter by date range, distance, athlete name
     - Basic stats (total races, total distance, etc.)
   - Simple responsive design (mobile-friendly)

### Phase 2 - Enhancements (Future)
- Age-graded scoring
- Club championship tracking
- Race event matching (link individual results to known race events)
- Personal athlete profiles with historical stats
- Export functionality (CSV)

## Development Setup

### Prerequisites
- Node.js 18+ and npm
- Cloudflare account (free tier sufficient)
- Strava API credentials (register at developers.strava.com)
- Wrangler CLI (`npm install -g wrangler`)

### Environment Variables Needed
```
STRAVA_CLIENT_ID=your_client_id
STRAVA_CLIENT_SECRET=your_client_secret
STRAVA_REDIRECT_URI=https://your-domain/auth/callback
```

### Initial Steps
1. Set up Cloudflare Workers project structure
2. Initialize D1 database and create schema
3. Implement Strava OAuth flow (authorization + callback)
4. Create Worker for scheduled activity fetching
5. Build React frontend with basic routing
6. Deploy to Cloudflare Pages

## Key Technical Considerations

### Strava API Rate Limiting
- Implement exponential backoff for rate limit handling
- Queue athlete checks to spread load across 15-minute windows
- Log rate limit usage to monitor headroom

### Token Management
- Strava tokens expire after 6 hours
- Implement automatic refresh before expiry
- Handle revoked tokens gracefully (notify athlete to reconnect)

### Activity Filtering
- Strava activity type: `workout_type` field = 1 indicates "Race"
- Allow manual race flagging if athlete forgot to mark it
- Distance tolerance for matching to known races (e.g., parkrun = 4.9-5.1km)

### Data Privacy
- Store minimal athlete data (only what's needed)
- Provide athlete data deletion endpoint (GDPR compliance)
- Clear privacy policy on frontend

## Repository Structure
```
/
├── workers/
│   ├── auth/           # OAuth handlers
│   ├── cron/           # Scheduled activity fetching
│   └── api/            # API endpoints for frontend
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   └── utils/
│   └── public/
├── database/
│   └── schema.sql      # D1 schema definitions
├── .github/
│   └── workflows/      # CI/CD pipelines
└── README.md           # Setup instructions for other clubs
```

## Success Metrics for MVP
- 50+ athletes successfully connected (25% adoption)
- Daily activity sync running reliably
- Zero token expiry errors
- Mobile-responsive frontend
- Complete documentation for other clubs to fork

## Known Limitations
- Only captures activities marked as "Race" in Strava
- Garmin-only users need Strava account (or manual entry fallback)
- Historical data requires manual import or one-time backfill
- Rate limits constrain real-time updates (daily sync only)

## Next Steps
1. Register Strava API application
2. Set up Cloudflare account and create Workers project
3. Design D1 database schema
4. Implement OAuth flow first (critical path)
5. Build scheduled Worker for activity fetching
6. Create minimal frontend to display results
```