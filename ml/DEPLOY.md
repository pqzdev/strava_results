# Deploy ML Models to Railway

## Summary

- **Parkrun model**: 47 KB (tiny!)
- **Event model**: 1.1 MB
- **Solution**: Deploy FastAPI service to Railway (free tier)
- **Time**: ~5 minutes

## Steps

### 1. Install Railway CLI (if needed)

```bash
npm install -g @railway/cli
# OR
brew install railway
```

### 2. Login to Railway

```bash
railway login
```

This will open a browser for authentication.

### 3. Deploy from ml/ directory

```bash
cd /Users/pqz/Code/strava_results/ml

# Initialize Railway project
railway init

# Deploy
railway up
```

### 4. Get your API URL

```bash
railway domain
```

This will give you a URL like: `https://your-app.up.railway.app`

### 5. Test the API

```bash
# Health check
curl https://your-app.up.railway.app/health

# Test parkrun prediction
curl -X POST https://your-app.up.railway.app/predict/parkrun \
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

### 6. Use in Cloudflare Workers

Update your Workers code to call the API:

```typescript
interface Env {
  ML_API_URL: string;  // Add to wrangler.toml
}

async function classifyParkrun(activity: StravaActivity, env: Env) {
  const features = {
    contains_parkrun: activity.name.toLowerCase().includes('parkrun') ? 1 : 0,
    is_5k: (activity.distance / 1000 >= 4.5 && activity.distance / 1000 <= 5.5) ? 1 : 0,
    hour_8: new Date(activity.start_date).getHours() === 8 ? 1 : 0,
    hour: new Date(activity.start_date).getHours(),
    distance_km: activity.distance / 1000,
    name_length: activity.name.length,
    elevation_gain: activity.total_elevation_gain || 0,
    day_5: new Date(activity.start_date).getDay() === 6 ? 1 : 0,
    pace_min_per_km: (activity.moving_time / 60) / (activity.distance / 1000),
    day_of_week: new Date(activity.start_date).getDay(),
  };

  const response = await fetch(`${env.ML_API_URL}/predict/parkrun`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(features),
  });

  return response.json();
}
```

## Alternative: Render.com (also free tier)

If Railway doesn't work, try Render:

1. Go to https://render.com
2. Connect your GitHub repo
3. Create new "Web Service"
4. Point to `/ml` directory
5. Build command: `pip install -r requirements.txt`
6. Start command: `uvicorn inference_api:app --host 0.0.0.0 --port $PORT`

## Cost

- **Railway**: Free tier includes 500 hours/month (enough for this)
- **Render**: Free tier (spins down after inactivity, cold start ~30s)
- **Upgraded**: ~$5/month for always-on

## Monitoring

View logs:
```bash
railway logs
```

## Next Steps

After deployment:
1. Add ML_API_URL to wrangler.toml
2. Implement feature extraction in Workers
3. Test with real Strava activities
4. Set up the review dashboard you mentioned
