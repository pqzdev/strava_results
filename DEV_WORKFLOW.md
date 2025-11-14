# Development Workflow

## Branch Strategy

- `main` - Production branch (deploys to production)
- `dev` - Development branch (deploys to staging)

## Development Process

1. **Always work on the `dev` branch for new features and fixes**
   ```bash
   git checkout dev
   ```

2. **Make your changes and commit to dev**
   ```bash
   git add .
   git commit -m "Your commit message"
   git push origin dev
   ```

3. **Deploy to staging environment for testing**
   ```bash
   # Deploy workers to staging
   cd workers
   npm run deploy:dev

   # Deploy frontend to staging
   cd ../frontend
   npm run deploy:dev
   ```

4. **Test thoroughly on staging**
   - Workers staging: `https://strava-club-workers-dev.pedroqueiroz.workers.dev`
   - Frontend staging: `https://dev.woodstock-results.pages.dev`

5. **Once verified, merge to main and deploy to production**
   ```bash
   git checkout main
   git merge dev
   git push origin main

   # Deploy to production
   cd workers
   npm run deploy

   cd ../frontend
   npm run deploy
   ```

## Environment Configuration

### Workers
- **Production**: `wrangler.workers.toml`
  - Worker name: `strava-club-workers`
  - URL: `https://strava-club-workers.pedroqueiroz.workers.dev`
  - Includes cron triggers

- **Staging**: `wrangler.workers.dev.toml`
  - Worker name: `strava-club-workers-dev`
  - URL: `https://strava-club-workers-dev.pedroqueiroz.workers.dev`
  - No cron triggers to avoid conflicts

### Frontend
- **Production**: Uses `public/_redirects`
  - Project: `woodstock-results`
  - Points to production workers

- **Staging**: Uses `public/_redirects.dev`
  - Project: `woodstock-results-dev`
  - Points to staging workers

## Secrets Management

Secrets need to be set separately for production and dev environments:

```bash
# Production secrets
wrangler secret put STRAVA_CLIENT_ID --config wrangler.workers.toml
wrangler secret put STRAVA_CLIENT_SECRET --config wrangler.workers.toml

# Dev secrets (same values, but separate environment)
wrangler secret put STRAVA_CLIENT_ID --config wrangler.workers.dev.toml
wrangler secret put STRAVA_CLIENT_SECRET --config wrangler.workers.dev.toml
```

## Database

Currently both environments share the same D1 database. Consider creating a separate dev database for full isolation.

## Important Rules

- **NEVER deploy directly to production from uncommitted changes**
- **ALWAYS test on staging first**
- **NEVER skip the dev branch** - all changes go through dev → main
- Production deployments should only happen after staging verification
