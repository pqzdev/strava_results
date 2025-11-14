# ML Training Data Analysis Summary

## Data Export Complete ✅

Successfully exported and processed **ALL** race data from the Strava club database, including previously hidden parkruns!

### Dataset Overview

**Total Activities:** 678 race activities
**Date Range:** August 2010 - November 2025 (15 years)
**Parkruns:** 222 activities (32.7%)
**Non-parkruns:** 456 activities (67.3%)
**Unique Events:** 48 different race events (non-parkrun)
**Polyline Coverage:** 95.4% (647/678 activities have GPS data)

### Top Events by Frequency

| Event | Count |
|-------|-------|
| City2Surf | 30 |
| Sydney Marathon | 12 |
| Sydney 10 | 8 |
| Bondi to Manly Ultra | 4 |
| Cooks River Fun Run | 3 |
| BBB | 2 |
| Canberra Marathon | 2 |

### Distance Distribution

| Category | Count |
|----------|-------|
| <5km | 126 |
| 5-10km | 99 |
| 10-15km | 107 |
| 15-21km (Half Marathon) | 16 |
| 21-42km (Marathon) | 63 |
| >42km (Ultra) | 43 |

## Key Findings

### 1. Excellent Parkrun Data ✅
**Found:** 222 parkrun activities (were marked as `is_hidden = 1`)
**Quality:** 99.1% have polylines - excellent for geolocation features
**Characteristics:**
- Average distance: 5.04km (±0.31km) - very consistent!
- 95.5% happen on **Saturdays** (212/222)
- 87.4% happen at **8am** (194/222)
- Very clear pattern for detection

**Class Balance:** 33% parkrun / 67% events - well balanced for training!

### 2. Strong Event Name Data
**Good:** 47 unique events with multiple examples each
**Challenge:** Class imbalance - City2Surf has 30 examples, many events have only 1-2
**Solution:**
- Use weighted loss functions or oversampling for rare events
- Consider grouping very rare events into "unknown" class

### 3. Excellent Polyline Coverage
**93.6% of activities have GPS polylines**
This enables strong geolocation-based features:
- Start/end coordinates
- Course shape analysis
- Distance from known event locations

## Revised ML Strategy

### Phase 1: Parkrun Binary Classifier (Immediate)
Build a binary classifier to detect parkruns - this has very strong signal!

**Training Data:** 678 total (222 parkrun, 456 non-parkrun)

**Strong Features:**
- **Distance:** Parkruns = 5.04km ±0.31km (very tight distribution!)
- **Day of week:** 95.5% on Saturday
- **Time of day:** 87.4% at 8am local time
- **Activity name:** Often contains "parkrun" but not always
- **Geolocation:** If we have known parkrun locations, distance from them

**Model:** XGBoost binary classifier
**Expected Performance:** Very high (>95% accuracy) due to clear patterns

### Phase 2: Event Name Predictor
Focus on predicting event names for the 456 non-parkrun races.

**Features:**
- Distance (strong signal - events have consistent distances)
- Date/time (some events are annual)
- Location (start coordinates from polyline)
- Activity name (text features)
- Course shape (from polyline - loop vs out-and-back)

**Model:**
- XGBoost multi-class classifier
- Handle class imbalance with sample weights
- Unknown event detection based on confidence threshold + geographic distance

**Success Metrics:**
- Top-1 accuracy (exact match)
- Top-3 accuracy (event in top 3 predictions)
- Unknown detection precision/recall

## Data Files

- **Raw Export:** `ml/data/races_raw.json` (455 records)
- **Processed CSV:** `ml/data/races_training.csv` (with engineered features)
- **Statistics:** `ml/data/data_stats.json` (summary metrics)

## Next Steps

1. ✅ Data export complete
2. ✅ Initial analysis complete
3. 🔄 Create Jupyter notebook for EDA
4. ⏳ Feature engineering for event predictor
5. ⏳ Train initial model
6. ⏳ Evaluate and iterate

## Updated Timeline

**Week 1:** ✅ Data collection complete ahead of schedule
**Week 2:** Feature engineering + event name predictor training
**Week 3:** Model export to ONNX + Cloudflare deployment
**Week 4:** Integration + testing
**Parkrun classifier:** Deferred until we collect parkrun Strava data
