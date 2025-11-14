# ML Models for Race Classification - Implementation Plan

## Overview
Build two models:
1. **Parkrun Classifier**: Binary classification (is parkrun / not parkrun)
2. **Event Name Predictor**: Multi-class classification with unknown event detection

## Phase 1: Data Collection & Analysis

### 1.1 Extract Training Data from Database
**What we need:**
- All races from `activity_event_mappings` table joined with activity details
- Features: date, distance, time, location data (if available), activity name, polyline
- Labels: event_name (parkrun vs others)

**SQL Query to extract:**
```sql
SELECT
  aem.strava_activity_id,
  aem.event_name,
  aem.distance,
  aem.manual_time_seconds,
  aem.activity_name,
  aem.activity_date,
  aem.polyline,
  aem.start_latitude,
  aem.start_longitude
FROM activity_event_mappings aem
WHERE aem.is_hidden = 0
```

**Tasks:**
- Create script to export training data from D1 database
- Analyze data distribution (how many parkruns vs other events)
- Identify data quality issues (missing polylines, distances, etc.)

### 1.2 Feature Engineering
**Parkrun-specific features:**
- Distance deviation from 5km (parkruns are ~5000m)
- Day of week (parkruns are typically Saturday mornings)
- Time of day from activity_date (parkruns start ~9am local time)
- Course shape similarity (parkruns often have out-and-back or loop patterns)
- Activity name contains "parkrun", "park run", etc.

**Event-specific features:**
- Distance (events tend to have consistent distances)
- Geographic clustering (events happen at same location)
- Course shape (polyline similarity)
- Date patterns (some events are annual, monthly, etc.)
- Activity name patterns

**Polyline processing:**
- Decode polylines to lat/lng coordinates
- Calculate course shape features:
  - Start/end proximity (loop vs point-to-point)
  - Elevation profile (if available)
  - Bounding box dimensions
  - Turn count and sharpness

## Phase 2: Model Development (Local)

### 2.1 Technology Stack
**Python libraries:**
- `pandas` - data manipulation
- `scikit-learn` - traditional ML models
- `xgboost` or `lightgbm` - gradient boosting
- `polyline` - decode Strava polylines
- `numpy` - numerical operations
- `joblib` - model serialization

**Why not deep learning initially:**
- Limited training data (likely <10k races)
- Traditional ML models are faster, smaller, more interpretable
- Can upgrade to neural networks if needed

### 2.2 Model Architecture

**Parkrun Classifier:**
- Algorithm: XGBoost or Random Forest
- Binary classification
- Output: probability score (0-1)
- Threshold: 0.5 for classification, but expose probability

**Event Name Predictor:**
- Algorithm: Multi-class XGBoost with OVR (One-vs-Rest)
- Classes: All known event names + "unknown_event" class
- Output: probability distribution across all events
- Unknown detection:
  - If max probability < 0.6, classify as "unknown_event"
  - Use geographic distance + distance mismatch as features
  - If location is >5km from known event locations, likely unknown

### 2.3 Training Pipeline
```python
# Pseudocode structure
1. Load data from exported CSV
2. Feature engineering:
   - Extract time/date features
   - Decode polylines
   - Calculate distance deviations
   - Generate course shape features
3. Split data (80% train, 20% test)
4. Train parkrun classifier
5. Train event predictor (excluding parkruns)
6. Evaluate metrics
7. Export models (joblib or ONNX)
```

## Phase 3: Model Deployment Options

### Option A: Cloudflare Workers AI (Recommended)
**Pros:**
- Already using Cloudflare infrastructure
- Low latency (edge computing)
- Built-in model hosting
- No cold starts

**Cons:**
- Limited to supported model formats (ONNX, TensorFlow)
- Need to convert scikit-learn/XGBoost to ONNX
- Model size limits (~25MB compressed)

**Implementation:**
1. Train models locally with sklearn/XGBoost
2. Convert to ONNX format using `skl2onnx` or `onnxmltools`
3. Upload to Cloudflare AI
4. Create API endpoints in workers

### Option B: Cloudflare Workers with WASM
**Pros:**
- Can run custom models directly
- More flexibility in model format
- Still edge-deployed

**Cons:**
- More complex setup
- Larger bundle sizes
- May have performance issues

### Option C: Separate ML Service (Not Recommended)
**Pros:**
- Full control over ML stack
- Can use any framework

**Cons:**
- Additional infrastructure cost
- Latency (not edge-deployed)
- More complexity

**Recommendation: Go with Option A (Cloudflare Workers AI)**

## Phase 4: Integration Architecture

### 4.1 Model Inference Endpoints

**New API Routes:**
```typescript
// Predict if activity is parkrun
POST /api/ml/predict-parkrun
Body: { distance, date, time, polyline?, activity_name }
Response: { is_parkrun: boolean, confidence: number }

// Predict event name
POST /api/ml/predict-event
Body: { distance, date, time, polyline?, activity_name, location }
Response: {
  event_name: string,
  confidence: number,
  is_unknown_event: boolean,
  alternatives: [{ event_name, confidence }]
}
```

### 4.2 Integration Points

**During sync process (sync-queue.ts):**
1. When processing race activities (workout_type === 1)
2. Before inserting into activity_event_mappings
3. Use parkrun model first:
   - If confidence > 0.8, set event_name = "parkrun"
   - Else, use event predictor
4. If event predictor returns "unknown_event" or confidence < 0.6:
   - Create event suggestion for admin review
   - Still insert with predicted event_name but flag for review

**Manual submission flow:**
- Use models to pre-populate event name suggestions
- Show confidence scores to users
- Allow override

## Phase 5: Implementation Steps

### Week 1: Data & Exploration
- [ ] Write SQL export script for training data
- [ ] Export data to CSV
- [ ] Exploratory data analysis notebook
- [ ] Analyze parkrun vs non-parkrun distributions
- [ ] Analyze event name distributions
- [ ] Identify feature availability (how many have polylines?)

### Week 2: Feature Engineering & Model Training
- [ ] Build feature engineering pipeline
- [ ] Implement polyline processing
- [ ] Train parkrun classifier
- [ ] Evaluate parkrun classifier (accuracy, precision, recall)
- [ ] Train event name predictor
- [ ] Evaluate event predictor (top-1, top-3 accuracy)
- [ ] Handle class imbalance (some events have few examples)

### Week 3: Model Export & Deployment
- [ ] Convert models to ONNX format
- [ ] Test ONNX inference locally
- [ ] Upload models to Cloudflare AI
- [ ] Create inference endpoints in workers
- [ ] Write integration code in sync-queue.ts
- [ ] Add manual override UI in admin panel

### Week 4: Testing & Refinement
- [ ] Test on held-out data
- [ ] Monitor prediction accuracy
- [ ] Collect false positives/negatives
- [ ] Retrain with feedback
- [ ] Deploy to production

## Phase 6: Monitoring & Iteration

### Metrics to Track
- Parkrun classifier: precision, recall, F1
- Event predictor: top-1 accuracy, top-3 accuracy
- Unknown event detection rate
- Admin override rate (how often admins correct predictions)

### Feedback Loop
1. Admins review and correct predictions
2. Store corrections in database
3. Periodically retrain models with new data
4. Track model performance over time

## Technical Considerations

### Model Size Constraints
- Cloudflare AI model limit: ~25MB compressed
- XGBoost models are typically small (<10MB)
- Feature engineering must happen in workers (not in model)

### Inference Performance
- Target: <100ms inference time
- Workers have 50ms CPU time limit (can request more)
- May need to simplify features if too slow

### Fallback Strategy
- If model inference fails, fall back to current rule-based approach
- If confidence is low, create event suggestion instead of auto-assigning

## Data Privacy
- Models trained on public race data only
- No personal athlete information in features
- Polylines are public (shared by athletes)

## Cost Estimation
- Cloudflare Workers AI: $0.011 per 1000 requests
- Assuming 1000 race activities/month: ~$0.01/month
- Negligible cost

---

## Deliverables

1. **Training Pipeline**
   - Jupyter notebook for exploration
   - Python scripts for data export, training, evaluation
   - Model artifacts (ONNX files)

2. **API Integration**
   - New inference endpoints in workers
   - Integration in sync-queue.ts
   - UI for showing confidence scores in admin

3. **Documentation**
   - Model architecture and features
   - Retraining instructions
   - Performance metrics baseline

4. **Monitoring Dashboard**
   - Add ML metrics to admin panel
   - Show prediction accuracy over time
   - Flag low-confidence predictions for review

---

## Next Steps

Start with Phase 1 (data extraction and analysis):
1. Create script to export training data from D1 database
2. Analyze data distribution and quality
3. Identify which features are available in the data
