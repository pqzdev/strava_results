# Cloudflare Pages Setup

## Issue
The Cloudflare Pages automatic git integration is misconfigured and causing deployment failures.

## Solution Options

### Option 1: Disable Automatic Builds (Recommended)
Since we're using GitHub Actions to handle builds and deployments, disable automatic builds in Cloudflare Pages:

1. Go to Cloudflare Dashboard → Pages → woodstock-results
2. Go to Settings → Builds & deployments
3. Disable "Automatic deployments from Git"
4. All deployments will now go through GitHub Actions only

### Option 2: Fix Automatic Build Configuration
If you want to keep automatic builds enabled, update the Pages project settings:

1. Go to Cloudflare Dashboard → Pages → woodstock-results
2. Go to Settings → Builds & deployments
3. Update build configuration:
   - **Build command**: `npm run build --workspace=frontend`
   - **Build output directory**: `frontend/dist`
   - **Root directory**: `/` (leave as root)

## Current GitHub Actions Workflow
The GitHub Actions workflow (`.github/workflows/deploy.yml`) is correctly configured and will work once automatic builds are disabled or fixed.

The workflow:
- Builds from `frontend/` directory
- Deploys `frontend/dist` to Pages using: `wrangler pages deploy dist --project-name=woodstock-results`
