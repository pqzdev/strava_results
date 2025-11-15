#!/usr/bin/env python3

"""
Train Event Name Predictor (Multi-class Classifier)

This script trains an XGBoost multi-class classifier to predict event names
for non-parkrun races.

Challenges:
- 48 unique event classes
- Class imbalance (City2Surf: 30 examples, many events: 1-2 examples)
- Need to handle "unknown" events not in training data

Approach:
- Use sample weights to handle class imbalance
- Train on top N events (with sufficient samples)
- Use confidence threshold for unknown detection
- Provide top-K predictions for uncertainty
"""

import pandas as pd
import numpy as np
from pathlib import Path
import json
import pickle
from datetime import datetime
from collections import Counter

# Paths
DATA_DIR = Path(__file__).parent / "data"
MODELS_DIR = Path(__file__).parent / "models"
MODELS_DIR.mkdir(exist_ok=True)

FEATURES_FILE = DATA_DIR / "event_predictor_features.csv"
MODEL_FILE = MODELS_DIR / "event_predictor.pkl"
MODEL_METADATA = MODELS_DIR / "event_predictor_metadata.json"
EVALUATION_REPORT = MODELS_DIR / "event_predictor_evaluation.txt"

# Minimum samples per class to include in training
MIN_SAMPLES_PER_CLASS = 3

# Check dependencies
try:
    import xgboost as xgb
    from sklearn.model_selection import train_test_split
    from sklearn.metrics import (
        accuracy_score, precision_score, recall_score, f1_score,
        classification_report, confusion_matrix, top_k_accuracy_score
    )
    from sklearn.preprocessing import LabelEncoder
    from sklearn.utils.class_weight import compute_sample_weight
except ImportError as e:
    print(f"❌ Missing dependency: {e}")
    print("\nInstall required packages:")
    print("  pip install xgboost scikit-learn")
    exit(1)


def load_features():
    """Load and prepare feature data"""
    print("📊 Loading feature data...")

    df = pd.read_csv(FEATURES_FILE)
    print(f"   Loaded {len(df)} non-parkrun races")
    print(f"   Unique events: {df['event_name'].nunique()}")

    return df


def analyze_class_distribution(df):
    """Analyze and display class distribution"""
    print(f"\n📈 Event Distribution Analysis:")

    event_counts = df['event_name'].value_counts()

    print(f"\n   Top 10 Events:")
    for event, count in event_counts.head(10).items():
        print(f"     {event:30s} {count:3d} samples")

    # Class distribution stats
    print(f"\n   Distribution Statistics:")
    print(f"     Total unique events: {len(event_counts)}")
    print(f"     Max samples per event: {event_counts.max()}")
    print(f"     Min samples per event: {event_counts.min()}")
    print(f"     Mean samples per event: {event_counts.mean():.1f}")
    print(f"     Median samples per event: {event_counts.median():.1f}")

    # Events with few samples
    rare_events = event_counts[event_counts < MIN_SAMPLES_PER_CLASS]
    print(f"\n   Events with < {MIN_SAMPLES_PER_CLASS} samples: {len(rare_events)}")
    if len(rare_events) > 0:
        print(f"     These events will be grouped as 'rare_event'")

    return event_counts


def prepare_training_data(df, event_counts):
    """
    Prepare X (features) and y (target) for training

    Strategy for class imbalance:
    - Events with >= MIN_SAMPLES_PER_CLASS: Keep as-is
    - Events with < MIN_SAMPLES_PER_CLASS: Group into "rare_event" class

    Returns:
        X: Feature matrix
        y: Target labels (event names)
        y_encoded: Encoded target labels (integers)
        label_encoder: LabelEncoder for inverse transform
        feature_names: List of feature column names
        rare_events: List of rare event names
    """
    print(f"\n🔧 Preparing training data...")

    # Identify rare events
    rare_events = event_counts[event_counts < MIN_SAMPLES_PER_CLASS].index.tolist()

    # Create modified dataframe
    df_prepared = df.copy()

    # Group rare events
    if len(rare_events) > 0:
        print(f"   Grouping {len(rare_events)} rare events into 'rare_event' class")
        df_prepared.loc[df_prepared['event_name'].isin(rare_events), 'event_name'] = 'rare_event'

    # Get final class distribution
    final_counts = df_prepared['event_name'].value_counts()
    print(f"   Final classes: {len(final_counts)}")
    print(f"   Samples per class: {final_counts.min()} - {final_counts.max()}")

    # Separate features and target
    id_cols = ['id', 'strava_activity_id', 'activity_name', 'is_parkrun']
    target_col = 'event_name'

    # Get feature columns
    feature_cols = [col for col in df_prepared.columns
                   if col not in id_cols + [target_col]]

    X = df_prepared[feature_cols]
    y = df_prepared[target_col]

    # Handle missing values
    X = X.fillna(0)

    # Encode labels
    label_encoder = LabelEncoder()
    y_encoded = label_encoder.fit_transform(y)

    print(f"\n   Features: {len(feature_cols)}")
    print(f"   Samples: {len(X)}")
    print(f"   Classes: {len(label_encoder.classes_)}")

    return X, y, y_encoded, label_encoder, feature_cols, rare_events


def train_model(X_train, y_train, X_test, y_test, num_classes):
    """
    Train XGBoost multi-class classifier

    Returns:
        model: Trained XGBoost model
    """
    print(f"\n🚀 Training XGBoost multi-class classifier...")
    print(f"   Number of classes: {num_classes}")

    # Compute sample weights to handle class imbalance
    sample_weights = compute_sample_weight('balanced', y_train)
    print(f"   Using balanced sample weights")

    # XGBoost parameters for multi-class classification
    params = {
        'objective': 'multi:softprob',  # Multi-class with probabilities
        'num_class': num_classes,
        'max_depth': 6,
        'learning_rate': 0.1,
        'n_estimators': 200,  # More trees for harder problem
        'min_child_weight': 1,
        'gamma': 0,
        'subsample': 0.8,
        'colsample_bytree': 0.8,
        'random_state': 42,
        'eval_metric': 'mlogloss',
    }

    model = xgb.XGBClassifier(**params)

    # Train the model with sample weights
    model.fit(X_train, y_train, sample_weight=sample_weights, verbose=False)

    print(f"✅ Training complete!")

    return model


def evaluate_model(model, X_test, y_test, X_train, y_train, label_encoder):
    """
    Comprehensive model evaluation for multi-class classification

    Returns:
        metrics: Dictionary with all evaluation metrics
    """
    print(f"\n📊 Evaluating model performance...")

    # Predictions
    y_pred = model.predict(X_test)
    y_pred_proba = model.predict_proba(X_test)

    # Train predictions (to check for overfitting)
    y_train_pred = model.predict(X_train)

    # Basic metrics
    test_accuracy = accuracy_score(y_test, y_pred)
    train_accuracy = accuracy_score(y_train, y_train_pred)

    # Top-k accuracy (how often the correct answer is in top 3 predictions)
    top3_accuracy = top_k_accuracy_score(y_test, y_pred_proba, k=3)
    top5_accuracy = top_k_accuracy_score(y_test, y_pred_proba, k=5)

    # Weighted metrics (to account for class imbalance)
    precision = precision_score(y_test, y_pred, average='weighted', zero_division=0)
    recall = recall_score(y_test, y_pred, average='weighted', zero_division=0)
    f1 = f1_score(y_test, y_pred, average='weighted', zero_division=0)

    # Confidence statistics (for unknown detection)
    max_probs = y_pred_proba.max(axis=1)
    mean_confidence = max_probs.mean()

    # Metrics dictionary
    metrics = {
        'test_accuracy': test_accuracy,
        'test_top3_accuracy': top3_accuracy,
        'test_top5_accuracy': top5_accuracy,
        'test_precision': precision,
        'test_recall': recall,
        'test_f1': f1,
        'train_accuracy': train_accuracy,
        'mean_confidence': mean_confidence,
        'num_classes': len(label_encoder.classes_),
    }

    # Print results
    print(f"\n{'='*60}")
    print(f"MODEL PERFORMANCE")
    print(f"{'='*60}")
    print(f"\nTest Set Metrics:")
    print(f"  Top-1 Accuracy: {metrics['test_accuracy']:.4f}")
    print(f"  Top-3 Accuracy: {metrics['test_top3_accuracy']:.4f}")
    print(f"  Top-5 Accuracy: {metrics['test_top5_accuracy']:.4f}")
    print(f"  Precision:      {metrics['test_precision']:.4f}")
    print(f"  Recall:         {metrics['test_recall']:.4f}")
    print(f"  F1 Score:       {metrics['test_f1']:.4f}")

    print(f"\nTrain Set Metrics:")
    print(f"  Accuracy:       {metrics['train_accuracy']:.4f}")

    print(f"\nOverfitting Check:")
    overfitting = train_accuracy - test_accuracy
    print(f"  Train-Test Gap: {overfitting:.4f}")
    if overfitting < 0.10:
        print(f"  ✅ Good generalization (gap < 0.10)")
    elif overfitting < 0.20:
        print(f"  ⚠️  Slight overfitting (gap 0.10-0.20)")
    else:
        print(f"  ❌ Overfitting detected (gap > 0.20)")

    print(f"\nPrediction Confidence:")
    print(f"  Mean max probability: {mean_confidence:.4f}")
    print(f"  → Can use confidence threshold ~0.5 for unknown detection")

    # Detailed per-class report (only for test set)
    print(f"\n{'='*60}")
    print(f"PER-CLASS PERFORMANCE (Top 10 Events)")
    print(f"{'='*60}\n")

    # Get classification report as dict
    report = classification_report(
        y_test, y_pred,
        target_names=label_encoder.classes_,
        output_dict=True,
        zero_division=0
    )

    # Sort by support (number of samples) and show top 10
    class_reports = [(name, stats) for name, stats in report.items()
                     if isinstance(name, str) and name not in ['accuracy', 'macro avg', 'weighted avg']]
    class_reports.sort(key=lambda x: x[1]['support'], reverse=True)

    for event_name, stats in class_reports[:10]:
        print(f"{str(event_name):30s} | "
              f"Precision: {stats['precision']:.3f} | "
              f"Recall: {stats['recall']:.3f} | "
              f"F1: {stats['f1-score']:.3f} | "
              f"Samples: {int(stats['support'])}")

    return metrics


def analyze_feature_importance(model, feature_names):
    """Analyze and display feature importance"""
    print(f"\n{'='*60}")
    print(f"FEATURE IMPORTANCE")
    print(f"{'='*60}\n")

    # Get feature importance
    importance = model.feature_importances_
    feature_importance = pd.DataFrame({
        'feature': feature_names,
        'importance': importance
    }).sort_values('importance', ascending=False)

    # Top 15 features
    print("Top 15 Most Important Features:")
    for idx, row in feature_importance.head(15).iterrows():
        bar_length = int(row['importance'] * 50)
        bar = '█' * bar_length
        print(f"  {row['feature']:30s} {bar} {row['importance']:.4f}")

    return feature_importance.to_dict('records')


def save_model(model, metrics, feature_importance, feature_names, label_encoder, rare_events):
    """Save model and metadata"""
    print(f"\n💾 Saving model...")

    # Save model
    with open(MODEL_FILE, 'wb') as f:
        pickle.dump(model, f)
    print(f"   ✅ Model saved: {MODEL_FILE}")

    # Save metadata
    metadata = {
        'model_type': 'event_name_predictor',
        'framework': 'xgboost',
        'version': '1.0.0',
        'trained_at': datetime.now().isoformat(),
        'metrics': {k: float(v) if isinstance(v, (int, float, np.number)) else v
                   for k, v in metrics.items()},
        'feature_importance': feature_importance,
        'feature_names': feature_names,
        'num_features': len(feature_names),
        'classes': label_encoder.classes_.tolist(),
        'num_classes': len(label_encoder.classes_),
        'rare_events': rare_events,
        'min_samples_per_class': MIN_SAMPLES_PER_CLASS,
        'usage': {
            'unknown_detection_threshold': 0.5,
            'top_k_predictions': 3,
        }
    }

    with open(MODEL_METADATA, 'w') as f:
        json.dump(metadata, f, indent=2)
    print(f"   ✅ Metadata saved: {MODEL_METADATA}")

    # Save label encoder separately
    label_encoder_file = MODELS_DIR / "event_predictor_label_encoder.pkl"
    with open(label_encoder_file, 'wb') as f:
        pickle.dump(label_encoder, f)
    print(f"   ✅ Label encoder saved: {label_encoder_file}")


def save_evaluation_report(metrics, feature_importance, label_encoder):
    """Save human-readable evaluation report"""
    with open(EVALUATION_REPORT, 'w') as f:
        f.write("="*60 + "\n")
        f.write("EVENT NAME PREDICTOR - EVALUATION REPORT\n")
        f.write("="*60 + "\n\n")

        f.write(f"Training Date: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
        f.write(f"Number of Classes: {metrics['num_classes']}\n")
        f.write(f"Event Classes: {', '.join(str(c) for c in label_encoder.classes_[:10])}...\n\n")

        f.write("-"*60 + "\n")
        f.write("TEST SET PERFORMANCE\n")
        f.write("-"*60 + "\n\n")
        f.write(f"Top-1 Accuracy: {metrics['test_accuracy']:.4f}\n")
        f.write(f"Top-3 Accuracy: {metrics['test_top3_accuracy']:.4f}\n")
        f.write(f"Top-5 Accuracy: {metrics['test_top5_accuracy']:.4f}\n")
        f.write(f"Precision:      {metrics['test_precision']:.4f}\n")
        f.write(f"Recall:         {metrics['test_recall']:.4f}\n")
        f.write(f"F1 Score:       {metrics['test_f1']:.4f}\n\n")

        f.write("-"*60 + "\n")
        f.write("FEATURE IMPORTANCE (Top 15)\n")
        f.write("-"*60 + "\n\n")
        for item in feature_importance[:15]:
            f.write(f"{item['feature']:30s} {item['importance']:.4f}\n")

        f.write("\n" + "="*60 + "\n")

    print(f"   ✅ Evaluation report saved: {EVALUATION_REPORT}")


if __name__ == "__main__":
    print("🚀 Training Event Name Predictor\n")

    # Load data
    df = load_features()

    # Analyze class distribution
    event_counts = analyze_class_distribution(df)

    # Prepare training data
    X, y, y_encoded, label_encoder, feature_names, rare_events = prepare_training_data(df, event_counts)

    # Split into train/test sets
    print("\n📊 Splitting data into train/test sets...")
    X_train, X_test, y_train, y_test = train_test_split(
        X, y_encoded, test_size=0.2, random_state=42, stratify=y_encoded
    )
    print(f"   Train: {len(X_train)} samples")
    print(f"   Test:  {len(X_test)} samples")

    # Train model
    model = train_model(X_train, y_train, X_test, y_test, len(label_encoder.classes_))

    # Evaluate
    metrics = evaluate_model(model, X_test, y_test, X_train, y_train, label_encoder)

    # Feature importance
    feature_importance = analyze_feature_importance(model, feature_names)

    # Save everything
    save_model(model, metrics, feature_importance, feature_names, label_encoder, rare_events)
    save_evaluation_report(metrics, feature_importance, label_encoder)

    print(f"\n{'='*60}")
    print(f"✨ TRAINING COMPLETE!")
    print(f"{'='*60}")
    print(f"\nModel files:")
    print(f"  {MODEL_FILE}")
    print(f"  {MODEL_METADATA}")
    print(f"  {EVALUATION_REPORT}")
    print(f"\nNext steps:")
    print(f"1. Review evaluation report")
    print(f"2. Test predictions on sample events")
    print(f"3. Convert both models to ONNX format")
    print(f"4. Deploy to Cloudflare Workers AI")
    print()
