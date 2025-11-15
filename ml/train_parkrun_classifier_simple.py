#!/usr/bin/env python3

"""
Train Parkrun Binary Classifier (Simplified Version)

This version uses only the TOP 10 most important features from the full model.
Expected to maintain 100% accuracy with much smaller model size.

Key features only:
1. is_5k (40.4%)
2. contains_parkrun (30.0%)
3. hour (12.3%)
4. hour_8 (6.4%)
5. distance_km (3.7%)
6. name_length (2.1%)
7. pace_min_per_km (1.6%)
8. elevation_gain (1.2%)
9. day_of_week (0.9%)
10. day_5 (Saturday, 0.7%)

Total: 99.3% of feature importance with just 10 features instead of 32!
"""

import pandas as pd
import numpy as np
from pathlib import Path
import json
import pickle
from datetime import datetime

# Paths
DATA_DIR = Path(__file__).parent / "data"
MODELS_DIR = Path(__file__).parent / "models"
MODELS_DIR.mkdir(exist_ok=True)

FEATURES_FILE = DATA_DIR / "parkrun_classifier_features.csv"
MODEL_FILE = MODELS_DIR / "parkrun_classifier_simple.pkl"
MODEL_METADATA = MODELS_DIR / "parkrun_classifier_simple_metadata.json"
EVALUATION_REPORT = MODELS_DIR / "parkrun_classifier_simple_evaluation.txt"

# ONLY USE TOP 10 FEATURES
SELECTED_FEATURES = [
    'is_5k',
    'contains_parkrun',
    'hour',
    'hour_8',
    'distance_km',
    'name_length',
    'pace_min_per_km',
    'elevation_gain',
    'day_of_week',
    'day_5',
]

# Check dependencies
try:
    import xgboost as xgb
    from sklearn.model_selection import train_test_split
    from sklearn.metrics import (
        accuracy_score, precision_score, recall_score, f1_score,
        confusion_matrix, classification_report, roc_auc_score
    )
except ImportError as e:
    print(f"❌ Missing dependency: {e}")
    exit(1)


def load_features():
    """Load and prepare feature data"""
    print("📊 Loading feature data...")

    df = pd.read_csv(FEATURES_FILE)
    print(f"   Loaded {len(df)} records")
    print(f"   Parkruns: {df['is_parkrun'].sum()}")
    print(f"   Non-parkruns: {(~df['is_parkrun']).sum()}")

    return df


def prepare_training_data(df):
    """
    Prepare X (features) and y (target) for training
    Uses ONLY the top 10 most important features

    Returns:
        X: Feature matrix (only 10 features!)
        y: Target labels (1 = parkrun, 0 = not parkrun)
    """
    print(f"\n🔧 Preparing training data (SIMPLIFIED)...")

    # Select ONLY the important features
    X = df[SELECTED_FEATURES].fillna(0)
    y = df['is_parkrun'].astype(int)

    print(f"   Features: {len(SELECTED_FEATURES)} (trimmed from 32!)")
    print(f"   Feature list: {SELECTED_FEATURES}")
    print(f"   Samples: {len(X)}")
    print(f"   Class distribution: {y.value_counts().to_dict()}")

    return X, y


def train_model(X_train, y_train):
    """Train XGBoost binary classifier (simpler params)"""
    print(f"\n🚀 Training simplified XGBoost classifier...")

    # Simpler parameters for smaller feature set
    params = {
        'objective': 'binary:logistic',
        'max_depth': 4,  # Reduced from 6
        'learning_rate': 0.1,
        'n_estimators': 50,  # Reduced from 100
        'min_child_weight': 1,
        'subsample': 0.8,
        'colsample_bytree': 0.8,
        'random_state': 42,
        'eval_metric': 'logloss',
    }

    model = xgb.XGBClassifier(**params)
    model.fit(X_train, y_train, verbose=False)

    print(f"✅ Training complete!")

    return model


def evaluate_model(model, X_test, y_test, X_train, y_train):
    """Comprehensive model evaluation"""
    print(f"\n📊 Evaluating model performance...")

    # Predictions
    y_pred = model.predict(X_test)
    y_pred_proba = model.predict_proba(X_test)[:, 1]

    # Train predictions
    y_train_pred = model.predict(X_train)

    # Metrics
    metrics = {
        'test_accuracy': accuracy_score(y_test, y_pred),
        'test_precision': precision_score(y_test, y_pred),
        'test_recall': recall_score(y_test, y_pred),
        'test_f1': f1_score(y_test, y_pred),
        'test_roc_auc': roc_auc_score(y_test, y_pred_proba),
        'train_accuracy': accuracy_score(y_train, y_train_pred),
        'confusion_matrix': confusion_matrix(y_test, y_pred).tolist(),
        'num_features': len(SELECTED_FEATURES),
    }

    # Print results
    print(f"\n{'='*60}")
    print(f"SIMPLIFIED MODEL PERFORMANCE")
    print(f"{'='*60}")
    print(f"\nFeature Count: {len(SELECTED_FEATURES)} (vs 32 in full model)")
    print(f"\nTest Set Metrics:")
    print(f"  Accuracy:  {metrics['test_accuracy']:.4f}")
    print(f"  Precision: {metrics['test_precision']:.4f}")
    print(f"  Recall:    {metrics['test_recall']:.4f}")
    print(f"  F1 Score:  {metrics['test_f1']:.4f}")
    print(f"  ROC AUC:   {metrics['test_roc_auc']:.4f}")

    print(f"\nTrain Set Metrics:")
    print(f"  Accuracy:  {metrics['train_accuracy']:.4f}")

    overfitting = metrics['train_accuracy'] - metrics['test_accuracy']
    print(f"\nOverfitting Check:")
    print(f"  Train-Test Gap: {overfitting:.4f}")
    if overfitting < 0.05:
        print(f"  ✅ Good generalization")

    print(f"\nConfusion Matrix:")
    cm = metrics['confusion_matrix']
    print(f"                Predicted")
    print(f"               Not PR | Parkrun")
    print(f"Actual Not PR:   {cm[0][0]:4d} | {cm[0][1]:4d}")
    print(f"Actual Parkrun:  {cm[1][0]:4d} | {cm[1][1]:4d}")

    print(f"\nClassification Report:")
    print(classification_report(y_test, y_pred, target_names=['Not Parkrun', 'Parkrun']))

    return metrics


def analyze_feature_importance(model):
    """Analyze feature importance"""
    print(f"\n{'='*60}")
    print(f"FEATURE IMPORTANCE (ALL 10 FEATURES)")
    print(f"{'='*60}\n")

    importance = model.feature_importances_
    feature_importance = pd.DataFrame({
        'feature': SELECTED_FEATURES,
        'importance': importance
    }).sort_values('importance', ascending=False)

    for idx, row in feature_importance.iterrows():
        bar_length = int(row['importance'] * 50)
        bar = '█' * bar_length
        print(f"  {row['feature']:30s} {bar} {row['importance']:.4f}")

    return feature_importance.to_dict('records')


def save_model(model, metrics, feature_importance):
    """Save model and metadata"""
    print(f"\n💾 Saving simplified model...")

    # Save model
    with open(MODEL_FILE, 'wb') as f:
        pickle.dump(model, f)
    print(f"   ✅ Model saved: {MODEL_FILE}")

    # Save metadata
    metadata = {
        'model_type': 'parkrun_binary_classifier_simple',
        'framework': 'xgboost',
        'version': '2.0.0',
        'trained_at': datetime.now().isoformat(),
        'metrics': {k: float(v) if isinstance(v, (int, float, np.number)) else v
                   for k, v in metrics.items()},
        'feature_importance': feature_importance,
        'feature_names': SELECTED_FEATURES,
        'num_features': len(SELECTED_FEATURES),
        'notes': 'Simplified model using only top 10 features (99.3% of importance from full model)'
    }

    with open(MODEL_METADATA, 'w') as f:
        json.dump(metadata, f, indent=2)
    print(f"   ✅ Metadata saved: {MODEL_METADATA}")


def save_evaluation_report(metrics, feature_importance):
    """Save evaluation report"""
    with open(EVALUATION_REPORT, 'w') as f:
        f.write("="*60 + "\n")
        f.write("PARKRUN CLASSIFIER (SIMPLIFIED) - EVALUATION REPORT\n")
        f.write("="*60 + "\n\n")

        f.write(f"Training Date: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
        f.write(f"Features Used: {len(SELECTED_FEATURES)} (simplified from 32)\n\n")

        f.write("-"*60 + "\n")
        f.write("TEST SET PERFORMANCE\n")
        f.write("-"*60 + "\n\n")
        f.write(f"Accuracy:  {metrics['test_accuracy']:.4f}\n")
        f.write(f"Precision: {metrics['test_precision']:.4f}\n")
        f.write(f"Recall:    {metrics['test_recall']:.4f}\n")
        f.write(f"F1 Score:  {metrics['test_f1']:.4f}\n")
        f.write(f"ROC AUC:   {metrics['test_roc_auc']:.4f}\n\n")

        f.write("-"*60 + "\n")
        f.write("FEATURE IMPORTANCE (ALL 10 FEATURES)\n")
        f.write("-"*60 + "\n\n")
        for item in feature_importance:
            f.write(f"{item['feature']:30s} {item['importance']:.4f}\n")

        f.write("\n" + "="*60 + "\n")

    print(f"   ✅ Evaluation report saved: {EVALUATION_REPORT}")


if __name__ == "__main__":
    print("🚀 Training Simplified Parkrun Binary Classifier\n")
    print("Using ONLY top 10 features (99.3% of importance)\n")

    # Load data
    df = load_features()

    # Prepare training data
    X, y = prepare_training_data(df)

    # Split
    print(f"\n📊 Splitting data...")
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )
    print(f"   Train: {len(X_train)} samples")
    print(f"   Test:  {len(X_test)} samples")

    # Train
    model = train_model(X_train, y_train)

    # Evaluate
    metrics = evaluate_model(model, X_test, y_test, X_train, y_train)

    # Feature importance
    feature_importance = analyze_feature_importance(model)

    # Save
    save_model(model, metrics, feature_importance)
    save_evaluation_report(metrics, feature_importance)

    print(f"\n{'='*60}")
    print(f"✨ SIMPLIFIED MODEL TRAINING COMPLETE!")
    print(f"{'='*60}")
    print(f"\nModel Size Reduction:")
    print(f"  Features: 10 (vs 32 in full model) - 69% reduction!")
    print(f"  Coverage: 99.3% of feature importance retained")
    print(f"\nModel files:")
    print(f"  {MODEL_FILE}")
    print(f"  {MODEL_METADATA}")
    print(f"\nExpected: Same 100% accuracy with much smaller model!")
    print()
