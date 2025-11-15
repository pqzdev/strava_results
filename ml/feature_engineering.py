#!/usr/bin/env python3

"""
Feature Engineering for Race Classification ML Models

This script processes race data and extracts comprehensive features for training:
1. Polyline-based geolocation features (start/end coordinates, course shape)
2. Time-based features (day of week, hour, month)
3. Distance and pace features
4. Text features from activity names
5. Course shape analysis (loop vs out-and-back)

Outputs:
- Feature matrices ready for XGBoost training
- Separate datasets for parkrun classifier and event predictor
"""

import json
import pandas as pd
import numpy as np
from pathlib import Path
from datetime import datetime
import re
from typing import Tuple, Optional, List

# Paths
DATA_DIR = Path(__file__).parent / "data"
ALL_RACES_CSV = DATA_DIR / "all_races_training.csv"
PARKRUN_CSV = DATA_DIR / "parkrun_training.csv"
NON_PARKRUN_CSV = DATA_DIR / "non_parkrun_training.csv"

# Output paths
PARKRUN_FEATURES = DATA_DIR / "parkrun_classifier_features.csv"
EVENT_FEATURES = DATA_DIR / "event_predictor_features.csv"
FEATURE_INFO = DATA_DIR / "feature_info.json"

# We'll need polyline library for decoding GPS data
try:
    import polyline
except ImportError:
    print("⚠️  polyline library not installed. Install with: pip install polyline")
    print("   Polyline features will be skipped for now.")
    polyline = None


def decode_polyline(polyline_str: Optional[str]) -> Optional[List[Tuple[float, float]]]:
    """Decode Strava polyline to list of (lat, lng) coordinates"""
    if not polyline_str or not polyline:
        return None
    try:
        return polyline.decode(polyline_str)
    except Exception as e:
        return None


def extract_geolocation_features(polyline_str: Optional[str]) -> dict:
    """
    Extract geolocation features from polyline

    Returns:
    - start_lat, start_lng: Starting coordinates
    - end_lat, end_lng: Ending coordinates
    - distance_start_to_end: Straight-line distance (km)
    - is_loop: Whether start and end are close (< 100m)
    - coord_count: Number of GPS points
    """
    features = {
        'start_lat': None,
        'start_lng': None,
        'end_lat': None,
        'end_lng': None,
        'distance_start_to_end_km': None,
        'is_loop': None,
        'coord_count': 0,
    }

    coords = decode_polyline(polyline_str)
    if not coords or len(coords) == 0:
        return features

    # Extract start and end
    start_lat, start_lng = coords[0]
    end_lat, end_lng = coords[-1]

    features['start_lat'] = start_lat
    features['start_lng'] = start_lng
    features['end_lat'] = end_lat
    features['end_lng'] = end_lng
    features['coord_count'] = len(coords)

    # Calculate straight-line distance using Haversine formula
    # Simple approximation for short distances
    lat_diff = abs(end_lat - start_lat)
    lng_diff = abs(end_lng - start_lng)

    # Rough approximation: 1 degree ≈ 111km at equator
    # More accurate: use Haversine
    from math import radians, sin, cos, sqrt, atan2

    R = 6371  # Earth radius in km
    lat1, lng1 = radians(start_lat), radians(start_lng)
    lat2, lng2 = radians(end_lat), radians(end_lng)

    dlat = lat2 - lat1
    dlng = lng2 - lng1

    a = sin(dlat/2)**2 + cos(lat1) * cos(lat2) * sin(dlng/2)**2
    c = 2 * atan2(sqrt(a), sqrt(1-a))
    distance = R * c

    features['distance_start_to_end_km'] = distance
    features['is_loop'] = 1 if distance < 0.1 else 0  # Loop if < 100m

    return features


def extract_text_features(activity_name: str) -> dict:
    """
    Extract text features from activity name

    Returns:
    - contains_parkrun: 1 if "parkrun" in name
    - contains_marathon: 1 if "marathon" in name
    - contains_half: 1 if "half" in name
    - contains_ultra: 1 if "ultra" in name
    - contains_fun_run: 1 if "fun run" in name
    - name_length: Length of activity name
    """
    name_lower = activity_name.lower() if activity_name else ""

    return {
        'contains_parkrun': 1 if 'parkrun' in name_lower or 'park run' in name_lower else 0,
        'contains_marathon': 1 if 'marathon' in name_lower else 0,
        'contains_half': 1 if 'half' in name_lower else 0,
        'contains_ultra': 1 if 'ultra' in name_lower else 0,
        'contains_fun_run': 1 if 'fun run' in name_lower or 'funrun' in name_lower else 0,
        'name_length': len(activity_name) if activity_name else 0,
    }


def engineer_features(df: pd.DataFrame, include_event_name: bool = False) -> pd.DataFrame:
    """
    Engineer all features from raw race data

    Args:
        df: DataFrame with raw race data
        include_event_name: Whether to include event_name as target (for event predictor)

    Returns:
        DataFrame with engineered features
    """
    print(f"🔧 Engineering features for {len(df)} races...")

    # Make a copy to avoid modifying original
    features_df = df.copy()

    # 1. Time-based features (already computed in process_all_data.py)
    # Ensure these exist
    if 'day_of_week' not in features_df.columns:
        features_df['date'] = pd.to_datetime(features_df['date'])
        features_df['day_of_week'] = features_df['date'].dt.dayofweek
        features_df['hour'] = features_df['date'].dt.hour
        features_df['month'] = features_df['date'].dt.month
        features_df['year'] = features_df['date'].dt.year

    # 2. Distance features (already in km from process_all_data.py)
    if 'distance_km' not in features_df.columns:
        features_df['distance_km'] = features_df['final_distance'] / 1000

    # 3. Pace features
    if 'pace_min_per_km' not in features_df.columns:
        features_df['pace_min_per_km'] = (features_df['final_time'] / 60) / features_df['distance_km']

    # 4. Text features from activity name
    print("   Extracting text features from activity names...")
    text_features = features_df['activity_name'].apply(extract_text_features)
    text_features_df = pd.DataFrame(text_features.tolist())
    features_df = pd.concat([features_df, text_features_df], axis=1)

    # 5. Geolocation features from polylines
    if polyline and 'polyline' in features_df.columns:
        print("   Extracting geolocation features from polylines...")
        # This might take a while, so we'll do it in batches
        geo_features = []
        for idx, row in features_df.iterrows():
            if idx % 100 == 0:
                print(f"      Processing polyline {idx}/{len(features_df)}...")

            # Get polyline from database (need to query it)
            # For now, we'll skip polyline extraction and handle it separately
            # since our CSV doesn't include the actual polyline string
            geo_features.append(extract_geolocation_features(None))

        geo_features_df = pd.DataFrame(geo_features)
        features_df = pd.concat([features_df, geo_features_df], axis=1)
    else:
        print("   ⚠️  Skipping polyline features (not available in CSV)")
        # Add placeholder columns
        features_df['start_lat'] = None
        features_df['start_lng'] = None
        features_df['end_lat'] = None
        features_df['end_lng'] = None
        features_df['distance_start_to_end_km'] = None
        features_df['is_loop'] = None
        features_df['coord_count'] = 0

    # 6. Categorical encoding for day of week (one-hot)
    day_dummies = pd.get_dummies(features_df['day_of_week'], prefix='day')
    features_df = pd.concat([features_df, day_dummies], axis=1)

    # 7. Categorical encoding for hour (one-hot for common race hours)
    # Most races happen 6am-10am, so we'll group others
    features_df['hour_binned'] = features_df['hour'].apply(
        lambda h: h if 6 <= h <= 10 else 'other'
    )
    hour_dummies = pd.get_dummies(features_df['hour_binned'], prefix='hour')
    features_df = pd.concat([features_df, hour_dummies], axis=1)

    # 8. Distance category features
    features_df['is_5k'] = ((features_df['distance_km'] >= 4.5) & (features_df['distance_km'] <= 5.5)).astype(int)
    features_df['is_10k'] = ((features_df['distance_km'] >= 9.5) & (features_df['distance_km'] <= 10.5)).astype(int)
    features_df['is_half_marathon'] = ((features_df['distance_km'] >= 20) & (features_df['distance_km'] <= 22)).astype(int)
    features_df['is_marathon'] = ((features_df['distance_km'] >= 40) & (features_df['distance_km'] <= 43)).astype(int)
    features_df['is_ultra'] = (features_df['distance_km'] > 43).astype(int)

    # Select feature columns for model
    feature_cols = [
        # Core features
        'distance_km',
        'pace_min_per_km',
        'elevation_gain',

        # Time features
        'day_of_week',
        'hour',
        'month',

        # Text features
        'contains_parkrun',
        'contains_marathon',
        'contains_half',
        'contains_ultra',
        'contains_fun_run',
        'name_length',

        # Distance category features
        'is_5k',
        'is_10k',
        'is_half_marathon',
        'is_marathon',
        'is_ultra',

        # Geolocation features (will be None for now)
        'start_lat',
        'start_lng',
        'end_lat',
        'end_lng',
        'distance_start_to_end_km',
        'is_loop',
        'coord_count',
    ]

    # Add one-hot encoded day features
    day_cols = [col for col in features_df.columns if col.startswith('day_')]
    feature_cols.extend(day_cols)

    # Add one-hot encoded hour features
    hour_cols = [col for col in features_df.columns if col.startswith('hour_')]
    feature_cols.extend(hour_cols)

    # Keep ID and target columns
    id_cols = ['id', 'strava_activity_id', 'activity_name']
    target_cols = ['is_parkrun']
    if include_event_name:
        target_cols.append('event_name')

    # Final feature set
    final_cols = id_cols + target_cols + feature_cols

    # Filter to only columns that exist
    final_cols = [col for col in final_cols if col in features_df.columns]

    result = features_df[final_cols]

    # Ensure all feature columns are numeric (no object dtypes)
    object_cols = result.select_dtypes(include=['object']).columns
    object_cols = [col for col in object_cols if col not in id_cols + target_cols + ['event_name']]
    if len(object_cols) > 0:
        print(f"   ⚠️  Dropping object columns: {list(object_cols)}")
        result = result.drop(columns=object_cols)

    print(f"✅ Feature engineering complete!")
    print(f"   Total features: {len(feature_cols)}")
    print(f"   Records: {len(result)}")

    return result


def create_feature_info(df: pd.DataFrame, model_type: str) -> dict:
    """Create metadata about features for documentation"""

    # Get feature columns (excluding ID and target)
    id_cols = ['id', 'strava_activity_id', 'activity_name']
    target_cols = ['is_parkrun', 'event_name']
    feature_cols = [col for col in df.columns if col not in id_cols + target_cols]

    info = {
        'model_type': model_type,
        'total_features': len(feature_cols),
        'feature_groups': {
            'core': ['distance_km', 'pace_min_per_km', 'elevation_gain'],
            'time': ['day_of_week', 'hour', 'month'],
            'text': ['contains_parkrun', 'contains_marathon', 'contains_half', 'contains_ultra', 'contains_fun_run', 'name_length'],
            'distance_category': ['is_5k', 'is_10k', 'is_half_marathon', 'is_marathon', 'is_ultra'],
            'geolocation': ['start_lat', 'start_lng', 'end_lat', 'end_lng', 'distance_start_to_end_km', 'is_loop', 'coord_count'],
            'day_one_hot': [col for col in feature_cols if col.startswith('day_')],
            'hour_one_hot': [col for col in feature_cols if col.startswith('hour_')],
        },
        'feature_names': feature_cols,
        'record_count': len(df),
    }

    return info


def main():
    print("🚀 Starting Feature Engineering Pipeline...\n")

    # Check if pandas is available
    try:
        import pandas as pd
    except ImportError:
        print("❌ pandas not installed. Install with: pip install pandas")
        return 1

    # Load processed data
    print("📊 Loading processed training data...")

    if not ALL_RACES_CSV.exists():
        print(f"❌ Training data not found: {ALL_RACES_CSV}")
        print("   Run process_all_data.py first!")
        return 1

    all_races = pd.read_csv(ALL_RACES_CSV)
    print(f"   Loaded {len(all_races)} total races")

    # 1. Create features for Parkrun Binary Classifier
    print("\n" + "="*60)
    print("1️⃣  PARKRUN BINARY CLASSIFIER FEATURES")
    print("="*60 + "\n")

    parkrun_features = engineer_features(all_races, include_event_name=False)
    parkrun_features.to_csv(PARKRUN_FEATURES, index=False)
    print(f"\n✅ Saved parkrun classifier features: {PARKRUN_FEATURES}")

    parkrun_info = create_feature_info(parkrun_features, 'parkrun_binary_classifier')

    # 2. Create features for Event Name Predictor (non-parkruns only)
    print("\n" + "="*60)
    print("2️⃣  EVENT NAME PREDICTOR FEATURES")
    print("="*60 + "\n")

    non_parkruns = all_races[~all_races['is_parkrun']].copy()
    print(f"   Filtering to {len(non_parkruns)} non-parkrun events...")

    event_features = engineer_features(non_parkruns, include_event_name=True)
    event_features.to_csv(EVENT_FEATURES, index=False)
    print(f"\n✅ Saved event predictor features: {EVENT_FEATURES}")

    event_info = create_feature_info(event_features, 'event_name_predictor')

    # 3. Save feature metadata
    feature_metadata = {
        'parkrun_classifier': parkrun_info,
        'event_predictor': event_info,
        'polyline_features_available': polyline is not None,
        'notes': {
            'polyline_extraction': 'Polyline features currently not extracted (requires separate DB query)',
            'next_step': 'Extract polylines from database and add geolocation features',
        }
    }

    with open(FEATURE_INFO, 'w') as f:
        json.dump(feature_metadata, f, indent=2)

    print(f"\n✅ Saved feature metadata: {FEATURE_INFO}")

    # 4. Summary
    print("\n" + "="*60)
    print("📊 FEATURE ENGINEERING SUMMARY")
    print("="*60)
    print(f"\n✅ Parkrun Classifier:")
    print(f"   Records: {len(parkrun_features)}")
    print(f"   Features: {parkrun_info['total_features']}")
    print(f"   Target: is_parkrun (binary)")
    print(f"   Class balance: {parkrun_features['is_parkrun'].sum()} parkruns / {(~parkrun_features['is_parkrun']).sum()} events")

    print(f"\n✅ Event Predictor:")
    print(f"   Records: {len(event_features)}")
    print(f"   Features: {event_info['total_features']}")
    print(f"   Target: event_name ({event_features['event_name'].nunique()} unique events)")
    print(f"   Top events: {list(event_features['event_name'].value_counts().head(5).index)}")

    print("\n" + "="*60)
    print("⚠️  NEXT STEPS:")
    print("="*60)
    print("1. Extract polylines from database for geolocation features")
    print("2. Train initial models with current features")
    print("3. Evaluate model performance")
    print("4. Add polyline features if needed for better accuracy")
    print("\n✨ Feature engineering complete!")

    return 0


if __name__ == "__main__":
    exit(main())
