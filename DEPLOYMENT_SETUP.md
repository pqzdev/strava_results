# Deployment Setup Instructions

## Issue
Cloudflare Pages has automatic git integration enabled, which is causing deployment failures because it tries to deploy before building the frontend.

## Solution
**Disable Cloudflare Pages automatic builds** and rely solely on GitHub Actions for deployments.

## Steps to Fix

### 1. Disable Cloudflare Pages Automatic Builds

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Navigate to **Pages** → **woodstock-results**
3. Go to **Settings** → **Builds & deployments**
4. Under **Automatic deployments**, click **Disable automatic deployments**

This will prevent Cloudflare from trying to build/deploy on every git push.

### 2. Verify GitHub Actions Deployment

GitHub Actions is already properly configured in `.github/workflows/deploy.yml`:
- ✅ Workers deployment with `wrangler.workers.toml`
- ✅ Pages deployment from `dist/` directory
- ✅ Proper build order (Workers first, then Pages)

### How Deployments Work After Setup

**On Push to Main Branch:**
1. GitHub Actions triggers automatically
2. Workers are built and deployed using `wrangler.workers.toml`
3. Frontend is built to `dist/`
4. Pages are deployed from `dist/`

**Manual Deployment:**
- Workers: `npm run deploy` (uses `wrangler.workers.toml`)
- Frontend: `npm run build:frontend && npm run deploy:frontend`

## Why This Setup?

- **Workers** and **Pages** have different configurations
- Mixing them in one `wrangler.toml` causes validation errors
- GitHub Actions provides better control over build/deploy order
- Automatic builds were trying to deploy before building

## Current File Structure

- `wrangler.toml` - Minimal placeholder (prevents auto-build errors)
- `wrangler.workers.toml` - Workers configuration
- `.github/workflows/deploy.yml` - Automated deployment pipeline
