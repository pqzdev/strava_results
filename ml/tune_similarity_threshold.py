#!/usr/bin/env python3

"""
WOOD-6: Tune distance threshold for event similarity predictor

This script analyzes prediction distances to find optimal threshold
"""

import sys
sys.path.append(str(__file__).replace('/tune_similarity_threshold.py', ''))

from train_event_similarity_predictor import EventSimilarityPredictor, extract_simple_features
import pandas as pd
from sklearn.model_selection import train_test_split

# Load data
df = pd.read_csv('data/event_predictor_features.csv')
df = df[df['event_name'].notna()]

features = extract_simple_features(df)

# Split (same as training)
event_counts = features['event_name'].value_counts()
events_with_multiple = event_counts[event_counts >= 2].index
stratify_labels = features['event_name'].where(
    features['event_name'].isin(events_with_multiple), None
).fillna('_singleton')

train_features, test_features = train_test_split(
    features, test_size=0.2, random_state=42, stratify=stratify_labels
)

# Train predictor with different thresholds
thresholds = [0.10, 0.15, 0.20, 0.25, 0.30, 0.40, 0.50]

print("WOOD-6: Threshold Tuning Analysis")
print("="*80)

for threshold in thresholds:
    predictor = EventSimilarityPredictor(distance_threshold=threshold)
    predictor.fit(train_features)

    # Predict on test set
    predictions = predictor.predict_batch(test_features)

    # Calculate metrics for known events
    known_events = set(predictor.centroids.keys())
    test_known = predictions[predictions['actual_event'].isin(known_events)]
    test_unknown = predictions[~predictions['actual_event'].isin(known_events)]

    if len(test_known) > 0:
        correct = (test_known['predicted_event'] == test_known['actual_event']).sum()
        accuracy = correct / len(test_known)
    else:
        accuracy = 0.0

    if len(test_unknown) > 0:
        correct_rejected = (test_unknown['predicted_event'].isna()).sum()
        reject_accuracy = correct_rejected / len(test_unknown)
    else:
        reject_accuracy = 0.0

    # Overall accuracy (correct predictions + correct rejections)
    overall_correct = correct + (correct_rejected if len(test_unknown) > 0 else 0)
    overall_accuracy = overall_correct / len(predictions)

    print(f"\nThreshold: {threshold:.2f}")
    print(f"  Known event accuracy:   {accuracy:.2%} ({correct}/{len(test_known)})")
    print(f"  Unknown reject rate:    {reject_accuracy:.2%} ({correct_rejected if len(test_unknown) > 0 else 0}/{len(test_unknown)})")
    print(f"  Overall accuracy:       {overall_accuracy:.2%} ({overall_correct}/{len(predictions)})")

# Show per-event distance distributions
print("\n" + "="*80)
print("Per-Event Distance Analysis (Threshold=0.25)")
print("="*80)

predictor = EventSimilarityPredictor(distance_threshold=0.25)
predictor.fit(train_features)
predictions = predictor.predict_batch(test_features)

known_events = set(predictor.centroids.keys())
for event in sorted(known_events):
    event_preds = predictions[predictions['actual_event'] == event]
    if len(event_preds) > 0:
        distances = event_preds['distance'].values
        correct_preds = event_preds[event_preds['predicted_event'] == event]

        print(f"\n{event}:")
        print(f"  Samples: {len(event_preds)}")
        print(f"  Distances: min={distances.min():.3f}, mean={distances.mean():.3f}, max={distances.max():.3f}")
        print(f"  Correct: {len(correct_preds)}/{len(event_preds)}")
        if len(correct_preds) > 0:
            print(f"  Correct distances: {correct_preds['distance'].values}")
        incorrect = event_preds[event_preds['predicted_event'] != event]
        if len(incorrect) > 0:
            print(f"  Incorrect predictions: {incorrect[['predicted_event', 'distance']].to_dict('records')}")
