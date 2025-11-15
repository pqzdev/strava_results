# Simplest ML Model Deployment

## Solution: Hybrid Approach

Based on actual model sizes:
- **Parkrun model**: 47 KB (tiny!)
- **Event model**: 1.1 MB (too large for Workers script bundle)

## Deployment Strategy

### 1. Parkrun Model → Inline in Workers Code ✅

The parkrun model is only 47KB, so we can:
1. Convert it to a simple lookup table or decision tree
2. OR: Embed the XGBoost JSON directly in Workers
3. OR: Fetch from GitHub on first request and cache

**Simplest approach**: Since it's tiny, fetch from GitHub and cache in memory:

```typescript
// In your Workers code
const PARKRUN_MODEL_URL = 'https://raw.githubusercontent.com/pqzx/strava_results/main/ml/models/onnx/parkrun_classifier.json';

let cachedParkrunModel: any = null;

async function loadParkrunModel() {
  if (!cachedParkrunModel) {
    const response = await fetch(PARKRUN_MODEL_URL);
    cachedParkrunModel = await response.json();
  }
  return cachedParkrunModel;
}
```

### 2. Event Model → Workers AI Binding ✅

Use Cloudflare's built-in AI capabilities:

```typescript
export interface Env {
  AI: Ai;  // Workers AI binding
}

export default {
  async fetch(request: Request, env: Env) {
    // Use Workers AI for event prediction
    const prediction = await env.AI.run('@cf/meta/llama-2-7b-chat-int8', {
      prompt: "Classify this race..."
    });
  }
}
```

**BUT** Workers AI doesn't support custom XGBoost models yet.

## ACTUAL Simplest Solution: Cloudflare D1 + Workers

Since your models are simple and you already use D1:

### Option A: Embed Models in D1 Database

1. Store model predictions in D1 as a lookup table
2. For new races, calculate features and query similar races
3. Use nearest neighbor matching

### Option B: Use Cloudflare Workers KV for Model Storage

1. Store the parkrun model (47KB) in Workers KV
2. Store event model (1.1MB) in Workers KV (KV supports up to 25MB)
3. Load on first request, cache in memory

```typescript
export interface Env {
  ML_MODELS: KVNamespace;
}

async function loadParkrunModel(env: Env) {
  const model = await env.ML_MODELS.get('parkrun_classifier', 'json');
  return model;
}
```

### Option C: Railway API (SIMPLEST FOR NOW)

Deploy the FastAPI service to Railway (free tier available):

1. Create `requirements.txt`:
```
fastapi==0.104.0
uvicorn==0.24.0
xgboost==3.1.1
numpy==1.24.0
scikit-learn==1.3.0
```

2. Create `railway.json`:
```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "NIXPACKS"
  },
  "deploy": {
    "startCommand": "uvicorn inference_api:app --host 0.0.0.0 --port $PORT",
    "restartPolicyType": "ON_FAILURE"
  }
}
```

3. Deploy:
```bash
cd /Users/pqz/Code/strava_results/ml
railway init
railway up
```

4. Get API URL and use in Workers:
```typescript
async function classifyRace(race: Activity) {
  const features = extractFeatures(race);

  const response = await fetch('https://your-app.railway.app/predict/parkrun', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(features)
  });

  return response.json();
}
```

## Recommended Path Forward

Given your requirements (simplest deployment + actual ML models):

**Today**: Deploy FastAPI to Railway (15 minutes)
1. Add `requirements.txt` and `railway.json` to ml/ directory
2. Run `railway init` and `railway up`
3. Update Workers to call the API

**Next week**: Optimize if needed
- Move parkrun model to Workers KV (remove API call for parkruns)
- Keep event predictor in API (it's more complex anyway)

## Railway Deployment Files

I'll create the deployment files needed for Railway in the next step.
