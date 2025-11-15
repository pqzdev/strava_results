#!/usr/bin/env python3

"""
Convert XGBoost models to ONNX format for Cloudflare Workers deployment

This checks:
1. If conversion works
2. Model file sizes
3. If models are small enough for Workers (<1MB ideal, <10MB max)
"""

import pickle
import numpy as np
from pathlib import Path
from onnxmltools.convert import convert_xgboost
from onnxmltools.convert.common.data_types import FloatTensorType
import onnxruntime as ort

# Paths
MODELS_DIR = Path(__file__).parent / "models"
ONNX_DIR = MODELS_DIR / "onnx"
ONNX_DIR.mkdir(exist_ok=True)

# Model files
PARKRUN_MODEL = MODELS_DIR / "parkrun_classifier_simple.pkl"
EVENT_MODEL = MODELS_DIR / "event_predictor.pkl"

def convert_parkrun_model():
    """Convert parkrun classifier to ONNX"""
    print("🔄 Converting Parkrun Classifier to ONNX...")

    # Load model
    with open(PARKRUN_MODEL, 'rb') as f:
        model = pickle.load(f)

    # Get the underlying booster
    booster = model.get_booster()

    # Define input shape (10 features for simplified model)
    initial_type = [('float_input', FloatTensorType([None, 10]))]

    # Convert to ONNX using onnxmltools for XGBoost
    onnx_model = convert_xgboost(booster, initial_types=initial_type, target_opset=12)

    # Save
    onnx_path = ONNX_DIR / "parkrun_classifier.onnx"
    with open(onnx_path, "wb") as f:
        f.write(onnx_model.SerializeToString())

    # Check size
    size_bytes = onnx_path.stat().st_size
    size_kb = size_bytes / 1024
    size_mb = size_kb / 1024

    print(f"   ✅ Parkrun model converted!")
    print(f"   File: {onnx_path}")
    print(f"   Size: {size_kb:.1f} KB ({size_mb:.2f} MB)")

    # Validate
    session = ort.InferenceSession(str(onnx_path))
    print(f"   ✅ Model validated with ONNX Runtime")

    # Test inference
    test_input = np.array([[
        1,  # contains_parkrun
        1,  # is_5k
        1,  # hour_8
        8,  # hour
        5.0,  # distance_km
        20,  # name_length
        100,  # elevation_gain
        1,  # day_5 (Saturday)
        5.5,  # pace_min_per_km
        5,  # day_of_week
    ]], dtype=np.float32)

    outputs = session.run(None, {'float_input': test_input})
    print(f"   ✅ Test inference successful")
    print(f"   Prediction: {outputs[0][0]} (1 = parkrun)")
    print(f"   Probability: {outputs[1][0]}")

    return size_mb < 1.0  # Return True if small enough for Workers


def convert_event_model():
    """Convert event predictor to ONNX"""
    print("\n🔄 Converting Event Predictor to ONNX...")

    # Load model
    with open(EVENT_MODEL, 'rb') as f:
        model = pickle.load(f)

    # Get the underlying booster
    booster = model.get_booster()

    # Define input shape (32 features)
    initial_type = [('float_input', FloatTensorType([None, 32]))]

    # Convert to ONNX using onnxmltools for XGBoost
    onnx_model = convert_xgboost(booster, initial_types=initial_type, target_opset=12)

    # Save
    onnx_path = ONNX_DIR / "event_predictor.onnx"
    with open(onnx_path, "wb") as f:
        f.write(onnx_model.SerializeToString())

    # Check size
    size_bytes = onnx_path.stat().st_size
    size_kb = size_bytes / 1024
    size_mb = size_kb / 1024

    print(f"   ✅ Event model converted!")
    print(f"   File: {onnx_path}")
    print(f"   Size: {size_kb:.1f} KB ({size_mb:.2f} MB)")

    # Validate
    session = ort.InferenceSession(str(onnx_path))
    print(f"   ✅ Model validated with ONNX Runtime")

    return size_mb < 1.0  # Return True if small enough for Workers


if __name__ == "__main__":
    print("🚀 Converting models to ONNX format\n")

    parkrun_ok = convert_parkrun_model()
    event_ok = convert_event_model()

    print("\n" + "="*60)
    print("DEPLOYMENT FEASIBILITY")
    print("="*60)
    print(f"\nCloudflare Workers limits:")
    print(f"  Recommended: < 1 MB per model")
    print(f"  Maximum: ~10 MB total bundle size")

    print(f"\nParkrun Classifier: {'✅ GOOD' if parkrun_ok else '⚠️  TOO LARGE'}")
    print(f"Event Predictor: {'✅ GOOD' if event_ok else '⚠️  TOO LARGE'}")

    if parkrun_ok and event_ok:
        print(f"\n✅ Both models are small enough for Cloudflare Workers!")
        print(f"   Can use ONNX Runtime Web for in-Worker inference")
    else:
        print(f"\n⚠️  Models may be too large for Workers")
        print(f"   Options:")
        print(f"   1. Use rule-based system (recommended for parkrun)")
        print(f"   2. Deploy as separate API service")
        print(f"   3. Use Cloudflare Durable Objects for storage")

    print()
