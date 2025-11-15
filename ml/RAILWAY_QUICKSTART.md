# Railway Deployment - Quick Start

## You're already logged in! ✅

Now just run these commands:

```bash
cd /Users/pqz/Code/strava_results/ml

# Create new project via Railway web UI (easier)
open https://railway.app/new

# OR use CLI (requires interaction)
railway init
# When prompted:
#   - Workspace: kalvinoz's Projects
#   - Create new project: yes
#   - Project name: strava-ml-api

# Deploy
railway up

# Get URL
railway domain
```

## What Happens:

1. **railway init** - Creates a new project in your Railway account
2. **railway up** - Deploys your code:
   - Detects Python project
   - Reads `railway.json` for config
   - Installs dependencies from `requirements.txt`
   - Starts with: `uvicorn inference_api:app --host 0.0.0.0 --port $PORT`
3. **railway domain** - Creates a public URL

## Expected Output:

```
✓ Deployment successful
✓ Service is live at: https://strava-ml-api-production.up.railway.app
```

## Test the API:

```bash
# Get your URL
RAILWAY_URL=$(railway domain 2>&1 | grep -o 'https://[^ ]*')

# Test health endpoint
curl $RAILWAY_URL/health

# Test parkrun prediction
curl -X POST $RAILWAY_URL/predict/parkrun \
  -H "Content-Type: application/json" \
  -d '{
    "contains_parkrun": 1,
    "is_5k": 1,
    "hour_8": 1,
    "hour": 8,
    "distance_km": 5.0,
    "name_length": 20,
    "elevation_gain": 50,
    "day_5": 1,
    "pace_min_per_km": 5.5,
    "day_of_week": 5
  }'
```

## Alternative: Deploy via GitHub

If CLI doesn't work:

1. Go to https://railway.app/new
2. Select "Deploy from GitHub repo"
3. Choose: kalvinoz/strava_results
4. Root directory: `/ml`
5. Click "Deploy"

Railway will auto-detect Python and use your configs.

## Next Steps:

Once deployed, add the URL to your Workers:

```toml
# wrangler.toml
[vars]
ML_API_URL = "https://your-app.railway.app"
```

## Monitoring:

```bash
# View logs
railway logs

# Check status
railway status

# Open in browser
railway open
```
