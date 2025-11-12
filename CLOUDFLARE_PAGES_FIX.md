# Cloudflare Pages Worker Deployment Fix

## The Problem

The Cloudflare Pages deployment is failing with:
```
✘ [ERROR] Missing entry-point to Worker script or to assets directory
```

This error occurs because:
1. Cloudflare Pages has a deploy command configured: `npx wrangler versions upload`
2. This command was being run from the root directory
3. No wrangler configuration existed at the root level

## Immediate Fix Applied

✅ Created a root-level `wrangler.toml` file that:
- Points to the correct worker entry point: `workers/src/index.ts`
- Includes all necessary D1 database bindings
- Configures cron triggers and environment variables
- Runs the build command before deployment

This allows the Pages deployment to successfully deploy the worker when it runs `npx wrangler versions upload`.

## Proper Long-Term Solution

**IMPORTANT:** According to the project's deployment architecture, Cloudflare Pages should NOT be deploying workers. The correct setup is:

- **Cloudflare Pages** → Deploys frontend only (static site)
- **GitHub Actions** → Deploys workers (API backend)

### Recommended Steps:

1. Go to Cloudflare Dashboard
2. Navigate to: **Pages > woodstock-results > Settings > Builds & deployments**
3. Find the **Deploy command** field
4. **Remove the deploy command** (make it empty/blank)
5. Ensure these settings:
   - **Build command:** `npm run build:frontend`
   - **Build output directory:** `frontend/dist`
   - **Deploy command:** *(LEAVE EMPTY)*

### Why This Matters

- **Separation of Concerns:** Pages should only handle frontend deployment
- **Proper CI/CD:** Workers should deploy via GitHub Actions (which includes database migrations)
- **Avoid Conflicts:** Deploying workers from both Pages and GitHub Actions can cause issues

## Current State

With the root-level `wrangler.toml` in place:
- ✅ Pages deployment will work (though not ideal)
- ✅ GitHub Actions deployment will still work correctly
- ⚠️ Workers may be deployed twice (from Pages AND GitHub Actions)

## Next Steps

Choose one of:

1. **Keep current setup** (both root and workers/wrangler.toml)
   - Works but redundant
   - Workers deploy from both Pages and GitHub Actions

2. **Implement proper solution** (recommended)
   - Remove deploy command from Pages settings
   - Delete root-level `wrangler.toml`
   - Workers deploy only via GitHub Actions
   - Pages only builds and deploys frontend

## Testing

To verify the fix works, push this branch and check:
1. Pages deployment succeeds
2. Worker is accessible at: https://strava-club-workers.pedroqueiroz.workers.dev
3. GitHub Actions still deploys workers on merge to main

---

For more details, see: [DEPLOYMENT.md](./DEPLOYMENT.md) (Section 7: Troubleshooting)
