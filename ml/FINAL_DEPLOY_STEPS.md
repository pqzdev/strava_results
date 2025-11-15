# Final Deployment Steps - Copy & Paste

## ✅ What's Done:

1. ML models trained (100% accuracy parkrun, 88% accuracy events)
2. Models exported to JSON format (47KB + 1.1MB)
3. FastAPI inference service created
4. Railway config files ready
5. Branch pushed with WOOD-6 reference
6. PR page opened in browser

## 🚀 What You Need to Do:

### Step 1: Create the PR (Browser is open)

**Title:**
```
[WOOD-6] ML model deployment infrastructure
```

**Description:** (copy this)
```
## Summary
Adds complete ML model deployment infrastructure for parkrun classification and event prediction.

## Models
- **Parkrun classifier**: 47KB (100% accuracy)
- **Event predictor**: 1.1MB (88% top-1, 99% top-3 accuracy)

## Deployment
FastAPI service ready for Railway deployment with:
- `/predict/parkrun` endpoint
- `/predict/event` endpoint
- Full documentation in ml/DEPLOY.md

## Quick Deploy
```bash
cd ml
railway init
railway up
```

See ml/RAILWAY_QUICKSTART.md for details.

Related: WOOD-6
```

Click "Create Pull Request"

### Step 2: Deploy to Railway (in Terminal)

Open a new terminal and run:

```bash
cd /Users/pqz/Code/strava_results/ml

# Option A: Interactive deployment
railway init
# When prompted:
#   Workspace: kalvinoz's Projects
#   Create new: Yes
#   Name: strava-ml-api

railway up
railway domain

# Option B: Web UI (if CLI is problematic)
open https://railway.app/new
# Then:
# 1. "Deploy from GitHub repo"
# 2. Select: kalvinoz/strava_results
# 3. Root directory: /ml
# 4. Click Deploy
```

### Step 3: Test the Deployment

Once deployed, Railway will give you a URL. Test it:

```bash
# Get your URL from Railway dashboard or:
railway status

# Test health endpoint
curl https://YOUR-APP.railway.app/health

# Should return: {"status":"healthy"}
```

### Step 4: Test ML Predictions

```bash
# Test parkrun classifier
curl -X POST https://YOUR-APP.railway.app/predict/parkrun \
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

# Should return: {"is_parkrun":true,"probability":0.99...}
```

### Step 5: Add URL to Workers

Once you have the Railway URL, add it to your Workers config:

```bash
# Edit wrangler.toml
nano wrangler.toml

# Add:
[vars]
ML_API_URL = "https://your-app.railway.app"
```

## 📊 Expected Timeline:

- PR creation: 1 minute
- Railway deployment: 3-5 minutes
- Testing: 2 minutes
- **Total: ~10 minutes**

## 🆘 If Something Fails:

### Railway init fails:
```bash
railway logout
railway login
railway whoami  # Verify login
```

### Deployment fails:
```bash
railway logs  # Check error logs
```

### Can't find gh command:
The PR page is already open in your browser, just fill it in manually.

## ✅ Success Checklist:

- [ ] PR created with [WOOD-6] title
- [ ] Railway project created
- [ ] API deployed and responding
- [ ] Health endpoint returns 200
- [ ] Parkrun prediction works
- [ ] Event prediction works
- [ ] URL added to wrangler.toml

## 🎉 Once Complete:

You'll have a live ML API at:
```
https://strava-ml-api-production.up.railway.app
```

Workers can call it for predictions!

## Next Steps After Deployment:

1. Integrate ML API into Workers sync process
2. Set up the review dashboard (you mentioned this)
3. Test with real Strava activities
4. Monitor performance and accuracy

---

**Current Status**: Ready to deploy! Just run the commands above.
