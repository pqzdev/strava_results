# Strava Running Club Aggregator

A lightweight web application that automatically aggregates race results from club members' Strava accounts. Built for running clubs with ~200 members, fully open source for other clubs to fork and deploy.

## Features

- **Strava OAuth Integration** - Secure one-click connection for club members
- **Automatic Race Syncing** - Daily sync of activities marked as "Race" in Strava
- **Filterable Dashboard** - View and filter races by athlete, date, distance
- **Rate Limit Handling** - Intelligent batching to respect Strava API limits
- **Mobile Responsive** - Works seamlessly on all devices
- **Privacy Focused** - Minimal data storage with GDPR compliance

## Tech Stack

- **Frontend**: React + TypeScript + Vite
- **Backend**: Cloudflare Workers (serverless)
- **Database**: Cloudflare D1 (SQLite)
- **API**: Strava API v3
- **Hosting**: Cloudflare Pages + Workers
- **CI/CD**: GitHub Actions

## Prerequisites

Before getting started, you'll need:

1. **Node.js 18+** and npm
2. **Cloudflare Account** ([Sign up free](https://dash.cloudflare.com/sign-up))
3. **Strava API Application** ([Register here](https://www.strava.com/settings/api))
4. **Wrangler CLI**: `npm install -g wrangler`

## Quick Start

### 1. Clone the Repository

```bash
git clone https://github.com/yourusername/strava-club-results.git
cd strava-club-results
npm install
```

### 2. Set Up Cloudflare

```bash
# Log in to Cloudflare
wrangler login

# Create D1 database
wrangler d1 create strava-club-db

# Note the database_id from the output and update workers/wrangler.toml
```

Update `workers/wrangler.toml` with your database ID:
```toml
[[d1_databases]]
binding = "DB"
database_name = "strava-club-db"
database_id = "YOUR_DATABASE_ID_HERE"
```

### 3. Run Database Migrations

```bash
wrangler d1 execute strava-club-db --file=database/schema.sql
```

### 4. Configure Strava API

Create a Strava API application at https://www.strava.com/settings/api:

- **Application Name**: Your Club Name Race Results
- **Category**: Visualizer
- **Website**: Your deployment URL (or localhost for testing)
- **Authorization Callback Domain**: Your domain or `localhost`

Note your **Client ID** and **Client Secret**.

### 5. Set Environment Variables

For local development, create `workers/.dev.vars`:
```env
STRAVA_CLIENT_ID=your_client_id
STRAVA_CLIENT_SECRET=your_client_secret
```

For production, set secrets via Wrangler:
```bash
cd workers
wrangler secret put STRAVA_CLIENT_ID
wrangler secret put STRAVA_CLIENT_SECRET
```

Update `workers/wrangler.toml` with your redirect URI:
```toml
[vars]
STRAVA_REDIRECT_URI = "https://your-domain.com/auth/callback"
```

### 6. Local Development

Terminal 1 - Start Workers:
```bash
cd workers
npm install
npm run dev
```

Terminal 2 - Start Frontend:
```bash
cd frontend
npm install
npm run dev
```

Visit http://localhost:3000

### 7. Deploy to Production

#### Option A: GitHub Actions (Recommended)

1. Add secrets to your GitHub repository:
   - `CLOUDFLARE_API_TOKEN` - Create at https://dash.cloudflare.com/profile/api-tokens
   - `CLOUDFLARE_ACCOUNT_ID` - Found in Cloudflare dashboard URL

2. Push to main branch:
```bash
git push origin main
```

GitHub Actions will automatically deploy both Workers and Frontend.

#### Option B: Manual Deploy

```bash
# Deploy Workers
cd workers
npm run deploy

# Deploy Frontend
cd frontend
npm run deploy
```

## Configuration

### Customizing the Sync Schedule

Edit `workers/wrangler.toml` to change the cron schedule:

```toml
[triggers]
crons = ["0 2 * * *"]  # Daily at 2 AM UTC
```

Examples:
- Every 6 hours: `"0 */6 * * *"`
- Every night at midnight: `"0 0 * * *"`
- Twice daily (6 AM and 6 PM): `"0 6,18 * * *"`

### Rate Limit Adjustments

If you have more than 200 athletes, adjust batch sizes in `workers/src/cron/sync.ts`:

```typescript
const batchSize = 20; // Lower this for more athletes
const delayBetweenBatches = 60000; // Increase delay if needed
```

### Styling and Branding

Colors are defined in `frontend/src/index.css`:

```css
:root {
  --primary-color: #667eea;    /* Main brand color */
  --secondary-color: #764ba2;   /* Accent color */
  --strava-orange: #FC4C02;    /* Strava brand */
}
```

## Usage

### For Club Members

1. Visit your club's deployed site
2. Click "Connect with Strava"
3. Authorize the application
4. Mark races as "Race" workout type in Strava
5. Results sync automatically daily

### For Administrators

- **Manual Sync**: `POST /api/sync` (requires authentication in production)
- **View Sync Logs**: Query `sync_logs` table in D1 dashboard
- **Monitor Rate Limits**: Check CloudFlare logs for rate limit warnings

## Database Schema

The application uses three main tables:

### `athletes`
Stores connected Strava users and OAuth tokens

### `races`
Stores race activities with metrics (distance, time, pace, etc.)

### `sync_logs`
Tracks sync operations and rate limit usage

See [database/schema.sql](database/schema.sql) for full schema.

## API Endpoints

- `GET /auth/authorize` - Initiate OAuth flow
- `GET /auth/callback` - OAuth callback handler
- `DELETE /auth/disconnect` - Remove athlete data (GDPR)
- `GET /api/races` - Fetch races with filters
- `GET /api/stats` - Get aggregate statistics
- `GET /api/athletes` - List connected athletes
- `POST /api/sync` - Manual sync trigger

### Example API Request

```bash
# Get races from last 30 days, 10km distance
curl "https://your-domain.com/api/races?date_from=2024-10-01&min_distance=9900&max_distance=10100"
```

## Troubleshooting

### Token Refresh Errors

If athletes see "token expired" errors:
1. They should reconnect their Strava account
2. Check token expiry handling in `workers/src/utils/strava.ts`

### Rate Limit Issues

If hitting rate limits (100 req/15min, 1000 req/day):
1. Reduce `batchSize` in sync script
2. Increase `delayBetweenBatches`
3. Check `sync_logs` table for usage patterns

### Activities Not Syncing

Ensure activities in Strava:
1. Are marked as "Race" workout type
2. Are type "Run" (not Walk, Hike, etc.)
3. Were created after athlete connected

## Privacy & GDPR

- **Minimal Data**: Only stores necessary race metrics
- **Deletion Endpoint**: Athletes can request data deletion
- **Secure Tokens**: OAuth tokens encrypted in D1
- **No Tracking**: No analytics or third-party tracking

Athletes can disconnect by calling:
```bash
DELETE /auth/disconnect
Content-Type: application/json

{
  "strava_id": 12345
}
```

## Contributing

Contributions welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## Common Customizations

### Add Age-Graded Scoring

See Phase 2 in [plan.md](plan.md) - requires:
1. Athlete age/gender fields
2. Age-grading calculation library
3. Additional database columns

### Club Championships

Track points across multiple races:
1. Create `championships` table
2. Define scoring rules
3. Add leaderboard view

### Export to CSV

Add endpoint in `workers/src/api/races.ts`:
```typescript
export async function exportRacesCSV(env: Env): Promise<Response> {
  // Fetch races and format as CSV
}
```

## License

MIT License - see [LICENSE](LICENSE) for details

## Support

- **Issues**: [GitHub Issues](https://github.com/yourusername/strava-club-results/issues)
- **Discussions**: [GitHub Discussions](https://github.com/yourusername/strava-club-results/discussions)

## Credits

Built with:
- [Strava API](https://developers.strava.com/)
- [Cloudflare Workers](https://workers.cloudflare.com/)
- [React](https://react.dev/)

---

Made with ❤️ for running clubs everywhere
