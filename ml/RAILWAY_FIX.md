# Railway 404 Fix - Root Directory Configuration

## Problem
Railway deployed from the repo root, not the `/ml` directory, causing 404 errors.

## Solution

### Option 1: Configure via Railway Dashboard (Recommended)

1. Open Railway dashboard: https://railway.app/dashboard
2. Select project: **woodstock-results**
3. Click on the service
4. Go to **Settings** tab
5. Find **Root Directory** setting
6. Set to: `ml`
7. Click **Save**
8. Railway will automatically redeploy

### Option 2: Add railway.toml to Repository Root

Create `/Users/pqz/Code/strava_results/railway.toml`:

```toml
[build]
builder = "NIXPACKS"

[deploy]
startCommand = "cd ml && uvicorn inference_api:app --host 0.0.0.0 --port $PORT"
```

Then:
```bash
git add railway.toml
git commit -m "Configure Railway to deploy from ml directory"
git push
```

### Option 3: Redeploy from ml Directory

```bash
cd /Users/pqz/Code/strava_results/ml
railway up --detach
```

## Verify Fix

Once redeployed, test:

```bash
curl https://woodstock-results-production.up.railway.app/health
# Should return: {"status":"healthy"}

curl https://woodstock-results-production.up.railway.app/
# Should return API info
```

## Expected Response

```json
{
  "status": "ok",
  "service": "Race Classification API",
  "models": {
    "parkrun_classifier": "loaded",
    "event_predictor": "loaded"
  }
}
```
