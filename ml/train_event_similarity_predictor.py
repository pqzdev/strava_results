#!/usr/bin/env python3

"""
WOOD-6: Simplified Event Similarity Predictor

This script implements a nearest-neighbor based event matcher that uses
only the most discriminative features:
- day_of_year (when the event happens)
- distance_km (how far)
- start_hour (what time)
- start_lat, start_lng (where)

We pre-compute centroids for known well-clustered events (3+ samples)
and match new activities based on distance to nearest centroid.

Known Events (as of training):
1. City2Surf (n=30): 14km, August, Sunday 7-8am
2. Sydney Marathon (n=12): 42km, Aug-Sep, Sunday 6-7am
3. Sydney 10 (n=8): 10km, May, Sunday 7am
4. Bondi to Manly Ultra (n=4): 79km, October, Friday 5am
5. Cooks River Fun Run (n=3): 10km, June, Sunday 9am
"""

import pandas as pd
import numpy as np
from pathlib import Path
import json
import pickle
from datetime import datetime
from math import radians, sin, cos, sqrt, atan2
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import train_test_split

# Paths
DATA_DIR = Path(__file__).parent / "data"
MODELS_DIR = Path(__file__).parent / "models"
MODELS_DIR.mkdir(exist_ok=True)

# WOOD-6: Load from source data with coordinates, not from feature-engineered CSV
SOURCE_FILE = DATA_DIR / "non_parkrun_training.csv"
MODEL_FILE = MODELS_DIR / "event_similarity_predictor.pkl"
MODEL_METADATA = MODELS_DIR / "event_similarity_metadata.json"
EVALUATION_REPORT = MODELS_DIR / "event_similarity_evaluation.txt"

# Configuration
MIN_SAMPLES_PER_EVENT = 3  # Events with fewer samples are ignored (focus on recurring events)
DISTANCE_THRESHOLD = 0.40  # Normalized distance threshold for matching


def haversine_distance(lat1, lon1, lat2, lon2):
    """Calculate distance between two coordinates in km using Haversine formula"""
    R = 6371  # Earth radius in km

    lat1, lon1, lat2, lon2 = map(radians, [lat1, lon1, lat2, lon2])

    dlat = lat2 - lat1
    dlon = lon2 - lon1

    a = sin(dlat/2)**2 + cos(lat1) * cos(lat2) * sin(dlon/2)**2
    c = 2 * atan2(sqrt(a), sqrt(1-a))

    return R * c


def extract_simple_features(df):
    """
    Extract simplified features for event matching

    Features:
    1. day_of_year: 1-366 (captures seasonality)
    2. distance_km: Activity distance
    3. start_hour: Hour of day (0-23, with decimal for minutes)
    4. start_lat: Starting latitude
    5. start_lng: Starting longitude
    """
    print("🔧 Extracting simplified features...")

    features = pd.DataFrame()

    # Parse date if it's a string
    if 'date' in df.columns:
        dates = pd.to_datetime(df['date'])
        features['day_of_year'] = dates.dt.dayofyear
        features['start_hour'] = dates.dt.hour + dates.dt.minute / 60.0
    else:
        # Fallback to month-based approximation
        month_to_day_of_year = {
            1: 15, 2: 45, 3: 74, 4: 105, 5: 135, 6: 166,
            7: 196, 8: 227, 9: 258, 10: 288, 11: 319, 12: 349
        }
        features['day_of_year'] = df['month'].map(month_to_day_of_year)
        features['start_hour'] = df['hour'].astype(float)

    # Distance - convert from meters to km if needed
    if 'distance' in df.columns:
        features['distance_km'] = df['distance'] / 1000.0
    else:
        features['distance_km'] = df['distance_km']

    # Coordinates - now available from raw_response!
    features['start_lat'] = df['start_lat']
    features['start_lng'] = df['start_lng']

    # Add event name for reference
    features['event_name'] = df['event_name']

    print(f"   ✓ Extracted {len(features.columns)-1} features for {len(features)} activities")

    # Show coordinate coverage
    coord_count = features['start_lat'].notna().sum()
    print(f"   ✓ Coordinates available: {coord_count}/{len(features)} ({100*coord_count/len(features):.1f}%)")

    return features


def compute_event_centroids(features_df, min_samples=MIN_SAMPLES_PER_EVENT):
    """
    Compute centroids for well-defined events

    Returns:
        dict: {event_name: centroid_features}
    """
    print(f"\n📍 Computing centroids for events with {min_samples}+ samples...")

    # Filter to events with enough samples
    event_counts = features_df['event_name'].value_counts()
    well_defined_events = event_counts[event_counts >= min_samples].index

    centroids = {}

    for event in well_defined_events:
        event_data = features_df[features_df['event_name'] == event]

        # Compute mean of each feature
        centroid = {
            'day_of_year': event_data['day_of_year'].mean(),
            'distance_km': event_data['distance_km'].mean(),
            'start_hour': event_data['start_hour'].mean(),
            'start_lat': event_data['start_lat'].mean() if not event_data['start_lat'].isna().all() else None,
            'start_lng': event_data['start_lng'].mean() if not event_data['start_lng'].isna().all() else None,
            'sample_count': len(event_data),
            'std_distance': event_data['distance_km'].std(),
        }

        centroids[event] = centroid

        print(f"   ✓ {event:30s} (n={centroid['sample_count']:2d}): "
              f"day={centroid['day_of_year']:.0f}, "
              f"dist={centroid['distance_km']:.1f}km, "
              f"hour={centroid['start_hour']:.1f}")

    print(f"\n   Total well-defined events: {len(centroids)}")

    return centroids


def custom_distance(features1, features2, scaler):
    """
    Calculate custom distance between two feature vectors

    Combines:
    - Euclidean distance for normalized temporal/distance features
    - Haversine distance for coordinates (if available)

    Returns normalized distance (0-1+)
    """
    # Extract features
    day1, dist1, hour1, lat1, lon1 = features1
    day2, dist2, hour2, lat2, lon2 = features2

    # Normalize non-coordinate features
    temporal_features1 = np.array([[day1, dist1, hour1]])
    temporal_features2 = np.array([[day2, dist2, hour2]])

    norm1 = scaler.transform(temporal_features1)[0]
    norm2 = scaler.transform(temporal_features2)[0]

    # Euclidean distance on normalized features
    temporal_dist = np.sqrt(np.sum((norm1 - norm2) ** 2))

    # If coordinates available, add coordinate distance
    if not (np.isnan(lat1) or np.isnan(lat2)):
        coord_dist = haversine_distance(lat1, lon1, lat2, lon2)
        # Normalize coordinate distance (assume max 10km for same event)
        coord_dist_norm = coord_dist / 10.0

        # Weighted combination: 50% temporal, 50% spatial
        return 0.5 * temporal_dist + 0.5 * coord_dist_norm
    else:
        # No coordinates, use only temporal distance
        return temporal_dist


class EventSimilarityPredictor:
    """
    Nearest-neighbor event predictor using similarity-based matching
    """

    def __init__(self, distance_threshold=DISTANCE_THRESHOLD):
        self.centroids = {}
        self.scaler = StandardScaler()
        self.distance_threshold = distance_threshold

    def fit(self, features_df):
        """
        Fit the predictor by computing event centroids
        """
        print("\n🎯 Training Event Similarity Predictor...")

        # Compute centroids for well-defined events
        self.centroids = compute_event_centroids(features_df)

        # Fit scaler on all temporal features
        temporal_features = features_df[['day_of_year', 'distance_km', 'start_hour']].values
        self.scaler.fit(temporal_features)

        print(f"   ✓ Fitted scaler on {len(features_df)} activities")
        print(f"   ✓ Learned {len(self.centroids)} event centroids")

    def predict(self, features):
        """
        Predict event for given features

        Args:
            features: dict or Series with keys: day_of_year, distance_km, start_hour, start_lat, start_lng

        Returns:
            (event_name, distance, confidence) or (None, distance, 0) if no match
        """
        # Convert to tuple for distance calculation
        feature_vector = (
            features['day_of_year'],
            features['distance_km'],
            features['start_hour'],
            features.get('start_lat', np.nan),
            features.get('start_lng', np.nan)
        )

        # Find nearest centroid
        min_distance = float('inf')
        nearest_event = None

        for event_name, centroid in self.centroids.items():
            centroid_vector = (
                centroid['day_of_year'],
                centroid['distance_km'],
                centroid['start_hour'],
                centroid.get('start_lat', np.nan),
                centroid.get('start_lng', np.nan)
            )

            dist = custom_distance(feature_vector, centroid_vector, self.scaler)

            if dist < min_distance:
                min_distance = dist
                nearest_event = event_name

        # Check if within threshold
        if min_distance <= self.distance_threshold:
            confidence = 1.0 - (min_distance / self.distance_threshold)
            return nearest_event, min_distance, confidence
        else:
            return None, min_distance, 0.0

    def predict_batch(self, features_df):
        """
        Predict events for a batch of activities

        Returns:
            DataFrame with predictions
        """
        predictions = []

        for idx, row in features_df.iterrows():
            event, distance, confidence = self.predict(row)
            predictions.append({
                'predicted_event': event,
                'distance': distance,
                'confidence': confidence,
                'actual_event': row.get('event_name', None)
            })

        return pd.DataFrame(predictions)


def evaluate_model(predictor, test_features):
    """
    Evaluate model on test set
    """
    print("\n📊 Evaluating model...")

    predictions = predictor.predict_batch(test_features)

    # Calculate metrics
    # For events in our training set
    known_events = set(predictor.centroids.keys())
    test_known = predictions[predictions['actual_event'].isin(known_events)]

    if len(test_known) > 0:
        correct = (test_known['predicted_event'] == test_known['actual_event']).sum()
        accuracy = correct / len(test_known)

        print(f"\n   Known Events Performance:")
        print(f"     Test samples: {len(test_known)}")
        print(f"     Correct: {correct}")
        print(f"     Accuracy: {accuracy:.4f}")

    # For unknown events (should predict None)
    test_unknown = predictions[~predictions['actual_event'].isin(known_events)]
    if len(test_unknown) > 0:
        correct_unknown = (test_unknown['predicted_event'].isna()).sum()
        unknown_accuracy = correct_unknown / len(test_unknown)

        print(f"\n   Unknown Events Performance:")
        print(f"     Test samples: {len(test_unknown)}")
        print(f"     Correctly rejected: {correct_unknown}")
        print(f"     Rejection accuracy: {unknown_accuracy:.4f}")

    # Overall stats
    print(f"\n   Distance Statistics:")
    print(f"     Mean distance: {predictions['distance'].mean():.4f}")
    print(f"     Median distance: {predictions['distance'].median():.4f}")
    print(f"     Mean confidence: {predictions['confidence'].mean():.4f}")

    # Per-event breakdown
    print(f"\n   Per-Event Breakdown:")
    for event in known_events:
        event_preds = test_known[test_known['actual_event'] == event]
        if len(event_preds) > 0:
            event_correct = (event_preds['predicted_event'] == event).sum()
            event_acc = event_correct / len(event_preds)
            print(f"     {event:30s} {event_correct}/{len(event_preds)} ({event_acc:.2%})")

    return predictions


def save_model(predictor, predictions):
    """Save model and metadata"""
    print(f"\n💾 Saving model...")

    # Save model
    with open(MODEL_FILE, 'wb') as f:
        pickle.dump(predictor, f)
    print(f"   ✅ Model saved: {MODEL_FILE}")

    # Save metadata
    metadata = {
        'model_type': 'event_similarity_predictor',
        'version': '1.0.0',
        'trained_at': datetime.now().isoformat(),
        'features': ['day_of_year', 'distance_km', 'start_hour', 'start_lat', 'start_lng'],
        'num_known_events': len(predictor.centroids),
        'known_events': list(predictor.centroids.keys()),
        'distance_threshold': predictor.distance_threshold,
        'min_samples_per_event': MIN_SAMPLES_PER_EVENT,
        'centroids': {
            name: {k: float(v) if isinstance(v, (int, float, np.number)) and not np.isnan(v) else None
                   for k, v in centroid.items()}
            for name, centroid in predictor.centroids.items()
        }
    }

    with open(MODEL_METADATA, 'w') as f:
        json.dump(metadata, f, indent=2)
    print(f"   ✅ Metadata saved: {MODEL_METADATA}")


if __name__ == "__main__":
    print("🚀 WOOD-6: Training Event Similarity Predictor\n")
    print("="*80)

    # Load data
    print("\n📊 Loading training data...")
    df = pd.read_csv(SOURCE_FILE)
    df = df[df['event_name'].notna()]  # Only labeled events

    # Exclude "Other" - it's a catch-all category, not a recurring event
    df = df[df['event_name'] != 'Other']

    print(f"   Loaded {len(df)} labeled activities (excluding 'Other' catch-all)")

    # Check coordinate coverage
    coord_coverage = df['start_lat'].notna().sum()
    print(f"   Coordinates available: {coord_coverage}/{len(df)} ({100*coord_coverage/len(df):.1f}%)")

    # Extract features
    features = extract_simple_features(df)

    # Split train/test (stratify only for events with 2+ samples)
    event_counts = features['event_name'].value_counts()
    events_with_multiple = event_counts[event_counts >= 2].index

    if len(events_with_multiple) > 0:
        # Create stratify labels (only for events with 2+ samples, None for others)
        stratify_labels = features['event_name'].where(
            features['event_name'].isin(events_with_multiple),
            None
        ).fillna('_singleton')  # Group all singletons together

        train_features, test_features = train_test_split(
            features, test_size=0.2, random_state=42, stratify=stratify_labels
        )
    else:
        train_features, test_features = train_test_split(
            features, test_size=0.2, random_state=42
        )
    print(f"\n   Train: {len(train_features)} samples")
    print(f"   Test:  {len(test_features)} samples")

    # Train model
    predictor = EventSimilarityPredictor(distance_threshold=DISTANCE_THRESHOLD)
    predictor.fit(train_features)

    # Evaluate
    predictions = evaluate_model(predictor, test_features)

    # Save
    save_model(predictor, predictions)

    print("\n" + "="*80)
    print("✨ Training Complete!")
    print("\nNext steps:")
    print("1. Extract polylines from database to add start coordinates")
    print("2. Re-train with coordinates for better accuracy")
    print("3. Compare with XGBoost model performance")
    print("4. Deploy to production")
