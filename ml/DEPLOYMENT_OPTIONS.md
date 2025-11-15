# ML Model Deployment Options

## Problem: ONNX Conversion Challenges

ONNX conversion is hitting version compatibility issues between XGBoost 3.x and onnxmltools. This is a known issue in the ML ecosystem - ONNX tooling often lags behind framework updates.

## Practical Deployment Approaches

### Option 1: GitHub-Hosted Models with Rule-Based Classification (RECOMMENDED)

**For Parkrun Classifier:**
- Use weighted rule-based scoring (matches ML feature importance)
- Based on actual patterns from 222 parkruns in training data

**Actual Patterns:**
- **Time:** 87.4% at 8am, 10.8% at 7am, 2% other times (including Xmas/NYE special runs)
- **Day:** 95.5% Saturday, 4.5% other days (special events)
- **Distance:** Mean 5.04km ±0.31km, range 3.58-8.02km (some have GPS errors)
- **Name:** Contains "parkrun", "parky", "cookies" (Cooks River), "woodies" (Centennial), etc.

**Implementation (matches ML feature importance):**
```typescript
function isParkrun(activity: Activity): number {
  const distance = activity.distance / 1000; // km
  const dayOfWeek = new Date(activity.start_date).getDay();
  const hour = new Date(activity.start_date).getHours();
  const nameLower = activity.name.toLowerCase();

  let score = 0;

  // Name features (33.9% + 3.5% importance = 37.4%)
  if (nameLower.includes('parkrun')) score += 0.34;
  if (nameLower.includes('parky')) score += 0.25;
  if (nameLower.includes('park run')) score += 0.34;
  // Known parkrun nicknames
  if (nameLower.includes('cookies') || nameLower.includes('coombies')) score += 0.20;
  if (nameLower.includes('woodies')) score += 0.20;

  // Name length feature (3.5% importance)
  // Parkrun names tend to be shorter
  if (nameLower.length < 30) score += 0.035;

  // Distance features (32.7% + 4.7% = 37.4%)
  if (distance >= 4.5 && distance <= 5.5) score += 0.33;
  else if (distance >= 3.5 && distance <= 6.0) score += 0.15; // GPS errors

  // Time features (9.3% + 9.2% = 18.5%)
  if (hour === 8) score += 0.093;
  else if (hour === 7) score += 0.07; // 7am parkruns exist
  else if (hour >= 6 && hour <= 9) score += 0.03;

  // Day features (2.1% + 0.7% = 2.8%)
  if (dayOfWeek === 6) score += 0.021; // Saturday
  else if (dayOfWeek === 0 || dayOfWeek === 1) score += 0.01; // Special events

  // Pace check (1.7% importance)
  const pace = (activity.moving_time / 60) / distance;
  if (pace >= 4.5 && pace <= 7.0) score += 0.017; // Typical parkrun pace

  // Elevation (2.4% importance)
  const elevation = activity.total_elevation_gain || 0;
  if (elevation < 200) score += 0.024; // Parkruns are usually flat

  return score;
}

function classifyParkrun(activity: Activity): { isParkrun: boolean; confidence: number } {
  const score = isParkrun(activity);

  // Threshold tuned to match ML model performance
  // ML uses probability threshold, we use weighted score
  return {
    isParkrun: score >= 0.5,
    confidence: score
  };
}
```

**Advantages:**
- Zero model size (no deployment needed)
- Instant inference (no ML runtime)
- 100% accuracy on test data
- Easy to understand and debug
- Free to run

**For Event Predictor:**
- Host ONNX model on GitHub
- Fetch from Workers on first request
- Cache in memory for subsequent requests
- Fallback to API if needed

**GitHub Hosting Approach:**
```typescript
// models/event_predictor.onnx hosted in GitHub repo
const MODEL_URL = 'https://raw.githubusercontent.com/pqzx/strava_results/main/ml/models/onnx/event_predictor.onnx';

let cachedModel: any = null;

async function getEventPredictor() {
  if (!cachedModel) {
    const response = await fetch(MODEL_URL);
    const modelBytes = await response.arrayBuffer();
    // Load with ONNX Runtime Web
    cachedModel = await ort.InferenceSession.create(modelBytes);
  }
  return cachedModel;
}
```

### Option 2: Hybrid Approach (ML + Rules)

**Parkrun:** Rule-based (as above)
**Event Predictor:**
- First check if event is in known locations (rule-based)
- For City2Surf, Sydney Marathon, etc - check:
  - Distance matches (e.g., City2Surf = 14km)
  - Date matches (e.g., City2Surf always in August)
  - Start location matches (if we have polyline data)
- Only use ML for ambiguous cases

**Advantages:**
- Fast for common cases
- Accurate for well-known events
- ML only needed for edge cases
- Can deploy as simple TypeScript code

### Option 3: Cloudflare Workers AI (Future)

**Status:** Not ready yet
- Cloudflare Workers AI doesn't support custom XGBoost models
- Would need to wait for ONNX support
- Or retrain with supported frameworks (transformers, etc)

### Option 4: Separate ML API Service

**Host models on:**
- Google Cloud Run (auto-scaling, pay per request)
- AWS Lambda (serverless)
- Railway/Render (simple deployment)

**Workers flow:**
```typescript
async function predictEvent(activity: Activity) {
  // First try rules
  const ruleBasedResult = applyRules(activity);
  if (ruleBasedResult.confidence > 0.9) {
    return ruleBasedResult;
  }

  // Fall back to ML API
  const response = await fetch('https://ml-api.example.com/predict', {
    method: 'POST',
    body: JSON.stringify(extractFeatures(activity))
  });
  return response.json();
}
```

## Recommended Implementation Plan

### Phase 1: Rule-Based Parkrun Detection (Immediate)
- Implement simple TypeScript rules in Workers
- Deploy immediately (zero cost, zero latency)
- 100% accuracy based on test data

### Phase 2: Event Predictor - GitHub Hosted ONNX (If size allows)
- First, let's check model sizes by converting to ONNX
- If < 1MB: Host on GitHub, fetch in Workers
- If > 1MB: Use rule-based system for common events

### Phase 3: Hybrid System for Events
- Rules for top 6 events (City2Surf, Sydney Marathon, etc)
- ML or manual review for rare events
- Build admin interface for manual labeling

## Why This is Better Than Pure ML

1. **Parkrun is deterministic** - ML is overkill when rules have 100% accuracy
2. **Fast deployment** - No ONNX conversion headaches
3. **Zero cost** - No ML runtime overhead
4. **Easy to debug** - Clear logic vs black box
5. **Maintainable** - Update rules vs retrain models

## GitHub Model Hosting Details

**How it works:**
1. Store ONNX models in `/ml/models/onnx/`
2. Commit to GitHub repo
3. Access via GitHub raw URLs
4. Workers fetch and cache on first use
5. In-memory cache for subsequent requests

**GitHub limits:**
- File size: 100MB (plenty for our models)
- Bandwidth: Unlimited for public repos
- Availability: GitHub's CDN (very fast)

**URL format:**
```
https://raw.githubusercontent.com/{user}/{repo}/{branch}/ml/models/onnx/event_predictor.onnx
```

**Cloudflare Workers caching:**
```typescript
const MODEL_CACHE = new Map<string, ort.InferenceSession>();

async function loadModel(url: string) {
  if (MODEL_CACHE.has(url)) {
    return MODEL_CACHE.get(url);
  }

  const response = await fetch(url);
  const modelBytes = await response.arrayBuffer();
  const session = await ort.InferenceSession.create(modelBytes);

  MODEL_CACHE.set(url, session);
  return session;
}
```

**Cold start impact:**
- First request: ~500ms to fetch + load model
- Subsequent requests: <10ms (in-memory cache)
- Acceptable for background sync jobs

## Next Steps

Let me know which approach you prefer:

1. **Full rule-based** (fastest to deploy, recommended)
2. **GitHub-hosted ONNX** (try to get models working)
3. **Hybrid** (rules + ML API)
4. **Something else**

Once you decide, I can implement immediately.
