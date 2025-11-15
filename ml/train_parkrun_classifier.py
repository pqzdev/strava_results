#!/usr/bin/env python3

"""
Train Parkrun Binary Classifier

This script trains an XGBoost binary classifier to predict whether a race is a parkrun.

Expected performance: >95% accuracy due to strong signals:
- Distance: 5.04km ±0.31km
- Day: 95.5% on Saturday
- Time: 87.4% at 8am
- Name: Often contains "parkrun"

Model output: Probability [0-1] that the race is a parkrun
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
MODEL_FILE = MODELS_DIR / "parkrun_classifier.pkl"
MODEL_METADATA = MODELS_DIR / "parkrun_classifier_metadata.json"
EVALUATION_REPORT = MODELS_DIR / "parkrun_classifier_evaluation.txt"

# Check dependencies
try:
    import xgboost as xgb
    from sklearn.model_selection import train_test_split, cross_val_score
    from sklearn.metrics import (
        accuracy_score, precision_score, recall_score, f1_score,
        confusion_matrix, classification_report, roc_auc_score, roc_curve
    )
except ImportError as e:
    print(f"❌ Missing dependency: {e}")
    print("\nInstall required packages:")
    print("  pip install xgboost scikit-learn")
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

    Returns:
        X: Feature matrix
        y: Target labels (1 = parkrun, 0 = not parkrun)
        feature_names: List of feature column names
    """
    print("\n🔧 Preparing training data...")

    # Separate features and target
    id_cols = ['id', 'strava_activity_id', 'activity_name']
    target_col = 'is_parkrun'

    # Get feature columns (everything except IDs and target)
    feature_cols = [col for col in df.columns if col not in id_cols + [target_col]]

    X = df[feature_cols]
    y = df[target_col].astype(int)

    # Handle missing values (fill with 0 for now)
    # In production, we'd want more sophisticated imputation
    X = X.fillna(0)

    print(f"   Features: {len(feature_cols)}")
    print(f"   Feature columns: {feature_cols[:10]}... (showing first 10)")
    print(f"   Samples: {len(X)}")
    print(f"   Class distribution: {y.value_counts().to_dict()}")

    return X, y, feature_cols


def train_model(X_train, y_train, X_test, y_test):
    """
    Train XGBoost binary classifier

    Returns:
        model: Trained XGBoost model
        metrics: Dictionary of evaluation metrics
    """
    print("\n🚀 Training XGBoost binary classifier...")

    # XGBoost parameters optimized for binary classification
    params = {
        'objective': 'binary:logistic',
        'max_depth': 6,
        'learning_rate': 0.1,
        'n_estimators': 100,
        'min_child_weight': 1,
        'gamma': 0,
        'subsample': 0.8,
        'colsample_bytree': 0.8,
        'random_state': 42,
        'eval_metric': 'logloss',
    }

    model = xgb.XGBClassifier(**params)

    # Train the model
    model.fit(X_train, y_train, verbose=False)

    print(f"✅ Training complete!")

    return model


def evaluate_model(model, X_test, y_test, X_train, y_train):
    """
    Comprehensive model evaluation

    Returns:
        metrics: Dictionary with all evaluation metrics
    """
    print("\n📊 Evaluating model performance...")

    # Predictions
    y_pred = model.predict(X_test)
    y_pred_proba = model.predict_proba(X_test)[:, 1]

    # Train predictions (to check for overfitting)
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
    }

    # Print results
    print(f"\n{'='*60}")
    print(f"MODEL PERFORMANCE")
    print(f"{'='*60}")
    print(f"\nTest Set Metrics:")
    print(f"  Accuracy:  {metrics['test_accuracy']:.4f}")
    print(f"  Precision: {metrics['test_precision']:.4f}")
    print(f"  Recall:    {metrics['test_recall']:.4f}")
    print(f"  F1 Score:  {metrics['test_f1']:.4f}")
    print(f"  ROC AUC:   {metrics['test_roc_auc']:.4f}")

    print(f"\nTrain Set Metrics:")
    print(f"  Accuracy:  {metrics['train_accuracy']:.4f}")

    print(f"\nOverfitting Check:")
    overfitting = metrics['train_accuracy'] - metrics['test_accuracy']
    print(f"  Train-Test Gap: {overfitting:.4f}")
    if overfitting < 0.05:
        print(f"  ✅ Good generalization (gap < 0.05)")
    elif overfitting < 0.10:
        print(f"  ⚠️  Slight overfitting (gap 0.05-0.10)")
    else:
        print(f"  ❌ Overfitting detected (gap > 0.10)")

    print(f"\nConfusion Matrix:")
    cm = metrics['confusion_matrix']
    print(f"                Predicted")
    print(f"               Not PR | Parkrun")
    print(f"Actual Not PR:   {cm[0][0]:4d} | {cm[0][1]:4d}")
    print(f"Actual Parkrun:  {cm[1][0]:4d} | {cm[1][1]:4d}")

    # Classification report
    print(f"\nDetailed Classification Report:")
    print(classification_report(y_test, y_pred, target_names=['Not Parkrun', 'Parkrun']))

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


def save_model(model, metrics, feature_importance, feature_names):
    """Save model and metadata"""
    print(f"\n💾 Saving model...")

    # Save model
    with open(MODEL_FILE, 'wb') as f:
        pickle.dump(model, f)
    print(f"   ✅ Model saved: {MODEL_FILE}")

    # Save metadata
    metadata = {
        'model_type': 'parkrun_binary_classifier',
        'framework': 'xgboost',
        'version': '1.0.0',
        'trained_at': datetime.now().isoformat(),
        'metrics': {k: float(v) if isinstance(v, (int, float, np.number)) else v
                   for k, v in metrics.items()},
        'feature_importance': feature_importance,
        'feature_names': feature_names,
        'num_features': len(feature_names),
        'training_records': len(df),
        'class_balance': {
            'parkrun': int(df['is_parkrun'].sum()),
            'not_parkrun': int((~df['is_parkrun']).sum()),
        }
    }

    with open(MODEL_METADATA, 'w') as f:
        json.dump(metadata, f, indent=2)
    print(f"   ✅ Metadata saved: {MODEL_METADATA}")


def save_evaluation_report(metrics, feature_importance, df):
    """Save human-readable evaluation report"""
    with open(EVALUATION_REPORT, 'w') as f:
        f.write("="*60 + "\n")
        f.write("PARKRUN BINARY CLASSIFIER - EVALUATION REPORT\n")
        f.write("="*60 + "\n\n")

        f.write(f"Training Date: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
        f.write(f"Training Records: {len(df)}\n")
        f.write(f"Parkruns: {df['is_parkrun'].sum()} ({df['is_parkrun'].sum()/len(df)*100:.1f}%)\n")
        f.write(f"Non-Parkruns: {(~df['is_parkrun']).sum()} ({(~df['is_parkrun']).sum()/len(df)*100:.1f}%)\n\n")

        f.write("-"*60 + "\n")
        f.write("TEST SET PERFORMANCE\n")
        f.write("-"*60 + "\n\n")
        f.write(f"Accuracy:  {metrics['test_accuracy']:.4f}\n")
        f.write(f"Precision: {metrics['test_precision']:.4f}\n")
        f.write(f"Recall:    {metrics['test_recall']:.4f}\n")
        f.write(f"F1 Score:  {metrics['test_f1']:.4f}\n")
        f.write(f"ROC AUC:   {metrics['test_roc_auc']:.4f}\n\n")

        f.write("-"*60 + "\n")
        f.write("FEATURE IMPORTANCE (Top 15)\n")
        f.write("-"*60 + "\n\n")
        for item in feature_importance[:15]:
            f.write(f"{item['feature']:30s} {item['importance']:.4f}\n")

        f.write("\n" + "="*60 + "\n")

    print(f"   ✅ Evaluation report saved: {EVALUATION_REPORT}")


if __name__ == "__main__":
    print("🚀 Training Parkrun Binary Classifier\n")

    # Load data
    df = load_features()

    # Prepare training data
    X, y, feature_names = prepare_training_data(df)

    # Split into train/test sets
    print("\n📊 Splitting data into train/test sets...")
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )
    print(f"   Train: {len(X_train)} samples")
    print(f"   Test:  {len(X_test)} samples")

    # Train model
    model = train_model(X_train, y_train, X_test, y_test)

    # Evaluate
    metrics = evaluate_model(model, X_test, y_test, X_train, y_train)

    # Feature importance
    feature_importance = analyze_feature_importance(model, feature_names)

    # Save everything
    save_model(model, metrics, feature_importance, feature_names)
    save_evaluation_report(metrics, feature_importance, df)

    print(f"\n{'='*60}")
    print(f"✨ TRAINING COMPLETE!")
    print(f"{'='*60}")
    print(f"\nModel files:")
    print(f"  {MODEL_FILE}")
    print(f"  {MODEL_METADATA}")
    print(f"  {EVALUATION_REPORT}")
    print(f"\nNext steps:")
    print(f"1. Review evaluation report")
    print(f"2. Test model predictions on sample data")
    print(f"3. Convert to ONNX format for Cloudflare deployment")
    print(f"4. Train event name predictor")
    print()
