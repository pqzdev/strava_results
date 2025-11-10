# Deployment Configuration Guide

This project uses two separate Cloudflare services:
- **Cloudflare Workers** for the backend API (`/workers`)
- **Cloudflare Pages** for the frontend static site (`/frontend`)

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     GitHub Repository                        │
│  ┌──────────────────────┐    ┌──────────────────────────┐  │
│  │  /workers            │    │  /frontend               │  │
│  │  (API Backend)       │    │  (React Frontend)        │  │
│  └──────────────────────┘    └──────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
           │                              │
           │ GitHub Actions               │ Cloudflare Pages
           │ (on merge to main)           │ (automatic)
           ▼                              ▼
┌─────────────────────┐        ┌──────────────────────────┐
│ Cloudflare Workers  │        │  Cloudflare Pages        │
│ strava-club-workers │        │  strava-club-results     │
│                     │        │                          │
│ API + Cron Jobs     │        │  Static Site Hosting     │
│ + D1 Database       │        │                          │
└─────────────────────┘        └──────────────────────────┘
```

## 1. Workers Deployment (Backend API)

### Deployment Method: GitHub Actions

The Workers are deployed automatically via GitHub Actions when you merge to `main`.

**Configuration:** `.github/workflows/deploy.yml`

**Workflow:**
1. Push/merge to `main` branch
2. GitHub Action triggers
3. Runs `npm ci` in `/workers`
4. Runs database migrations (if any)
5. Deploys with `wrangler deploy`

**Manual Deployment:**
```bash
cd workers
npm run deploy
# or from root:
npm run deploy
```

### Build Configuration

**File:** `workers/wrangler.toml`

```toml
[build]
command = "npm run build"
watch_dirs = ["src"]
```

This runs TypeScript type checking before deployment. Wrangler automatically handles TypeScript compilation for the actual Worker bundle.

### Environment Variables (Secrets)

Set these via Wrangler CLI:
```bash
wrangler secret put STRAVA_CLIENT_ID
wrangler secret put STRAVA_CLIENT_SECRET
```

Or via Cloudflare Dashboard:
Workers > strava-club-workers > Settings > Variables > Add variable (encrypt)

## 2. Pages Deployment (Frontend)

### Deployment Method: Automatic via Cloudflare Pages

The frontend is deployed automatically by Cloudflare Pages on every push.

### Required Settings in Cloudflare Dashboard

Navigate to: **Pages > strava-club-results > Settings > Builds & deployments**

**Build Configuration:**

| Setting | Value |
|---------|-------|
| Framework preset | None (or React) |
| Root directory | *(leave blank)* |
| Build command | `npm run build:frontend` |
| Build output directory | `frontend/dist` |
| **Deploy command** | ***(MUST BE EMPTY)*** |

⚠️ **CRITICAL:** The deploy command MUST be empty! Pages automatically deploys the built files. If you have any wrangler commands here, remove them.

### Why No Deploy Command?

- **Cloudflare Pages** = Static site hosting
  - Automatically serves whatever is in the build output directory
  - No deployment step needed

- **Cloudflare Workers** = Serverless functions
  - Requires `wrangler deploy` command
  - Already handled by GitHub Actions

## 3. Branch Configuration

### Main Branch
- Protected branch
- Workers deploy via GitHub Actions
- Pages deploy automatically

### Feature Branches
- Pages creates preview deployments automatically
- Workers do NOT auto-deploy from feature branches
- Test Workers changes locally with `npm run dev --workspace=workers`

## 4. Local Development

### Start Both Services
```bash
npm run dev
```

This starts:
- Workers on `http://localhost:8787`
- Frontend on `http://localhost:5173`

### Start Individual Services
```bash
# Workers only
npm run dev --workspace=workers

# Frontend only
npm run dev --workspace=frontend
```

## 5. Build Commands Reference

```bash
# Build everything
npm run build

# Build workers only (type check)
npm run build:workers

# Build frontend only
npm run build:frontend

# Deploy workers
npm run deploy

# Deploy frontend (manual)
npm run deploy:frontend
```

## 6. Database Migrations

```bash
# Run migrations on remote database
cd workers
npx wrangler d1 migrations apply strava-club-db --remote

# Or from root
npm run db:migrate
```

## 7. Troubleshooting

### Pages Build Fails

**Symptom:** Error about "Missing entry-point to Worker script"

**Solution:** Remove any wrangler commands from Pages deploy command. Pages should ONLY build the frontend, not deploy Workers.

### Workers Not Deploying

**Check:**
1. GitHub Actions has `CLOUDFLARE_API_TOKEN` secret set
2. Token has Workers Deploy permission
3. Workflow triggered on merge to main

### Type Errors During Build

```bash
# Run type check locally
npm run build:workers
```

Fix any TypeScript errors before deploying.

## 8. Monitoring & Logs

### Workers Logs

**Live tail:**
```bash
cd workers
npm run tail
```

**Dashboard:**
Workers > strava-club-workers > Logs

**Observability** (enabled on this project):
- Full sampling rate (all requests logged)
- Invocation logs enabled
- View in Cloudflare Dashboard > Workers > Logs > Observability

### Pages Logs

Pages > strava-club-results > Deployments > View logs

## 9. Current Configuration Summary

✅ **Workers** (`/workers`)
- TypeScript with automatic compilation
- D1 Database binding
- Cron trigger (Monday 2 AM UTC)
- Observability logs enabled
- Deploys via GitHub Actions

✅ **Frontend** (`/frontend`)
- React + Vite
- TypeScript
- Deploys via Cloudflare Pages
- Automatic preview deployments

## 10. Next Steps After Setup

1. **Remove deploy command from Pages settings** (if not already done)
2. **Verify GitHub Actions has API token**
3. **Set Worker secrets** (STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET)
4. **Merge this branch to main**
5. **Monitor first deployment**

---

For more information:
- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [Cloudflare Pages Docs](https://developers.cloudflare.com/pages/)
- [Wrangler CLI Docs](https://developers.cloudflare.com/workers/wrangler/)
