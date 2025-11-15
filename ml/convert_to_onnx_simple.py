#!/usr/bin/env python3

"""
Convert XGBoost models to ONNX using XGBoost's native export
This avoids the onnxmltools compatibility issues
"""

import pickle
import numpy as np
from pathlib import Path

# Paths
MODELS_DIR = Path(__file__).parent / "models"
ONNX_DIR = MODELS_DIR / "onnx"
ONNX_DIR.mkdir(exist_ok=True)

PARKRUN_MODEL = MODELS_DIR / "parkrun_classifier_simple.pkl"
EVENT_MODEL = MODELS_DIR / "event_predictor.pkl"

def convert_parkrun_model():
    """Convert parkrun classifier using XGBoost native JSON format"""
    print("🔄 Converting Parkrun Classifier...")

    # Load model
    with open(PARKRUN_MODEL, 'rb') as f:
        model = pickle.load(f)

    # Get the booster
    booster = model.get_booster()

    # Save as JSON (XGBoost native format - can be loaded in JS)
    json_path = ONNX_DIR / "parkrun_classifier.json"
    booster.save_model(str(json_path))

    # Also try saving as ubj (more compact)
    ubj_path = ONNX_DIR / "parkrun_classifier.ubj"
    booster.save_model(str(ubj_path))

    # Check sizes
    json_size = json_path.stat().st_size / 1024
    ubj_size = ubj_path.stat().st_size / 1024

    print(f"   ✅ Parkrun model converted!")
    print(f"   JSON: {json_path} ({json_size:.1f} KB)")
    print(f"   UBJ:  {ubj_path} ({ubj_size:.1f} KB)")

    # Test loading
    import xgboost as xgb
    loaded_model = xgb.Booster()
    loaded_model.load_model(str(json_path))
    print(f"   ✅ Model validated (can be loaded)")

    return json_size < 1024  # Return True if < 1MB


def convert_event_model():
    """Convert event predictor using XGBoost native JSON format"""
    print("\n🔄 Converting Event Predictor...")

    # Load model
    with open(EVENT_MODEL, 'rb') as f:
        model = pickle.load(f)

    # Get the booster
    booster = model.get_booster()

    # Save as JSON
    json_path = ONNX_DIR / "event_predictor.json"
    booster.save_model(str(json_path))

    # Also try UBJ
    ubj_path = ONNX_DIR / "event_predictor.ubj"
    booster.save_model(str(ubj_path))

    # Check sizes
    json_size = json_path.stat().st_size / 1024
    ubj_size = ubj_path.stat().st_size / 1024

    print(f"   ✅ Event model converted!")
    print(f"   JSON: {json_path} ({json_size:.1f} KB)")
    print(f"   UBJ:  {ubj_path} ({ubj_size:.1f} KB)")

    # Test loading
    import xgboost as xgb
    loaded_model = xgb.Booster()
    loaded_model.load_model(str(json_path))
    print(f"   ✅ Model validated (can be loaded)")

    return json_size < 1024  # Return True if < 1MB


if __name__ == "__main__":
    print("🚀 Converting models to XGBoost native format\n")
    print("This avoids ONNX conversion issues and works with xgboost.js\n")

    parkrun_ok = convert_parkrun_model()
    event_ok = convert_event_model()

    print("\n" + "="*60)
    print("DEPLOYMENT OPTIONS")
    print("="*60)

    print("\nOption 1: Use XGBoost.js in Cloudflare Workers")
    print("  - Load .json or .ubj models directly")
    print("  - Use xgboost.js library for inference")
    print("  - Host models on GitHub or Workers KV")
    print(f"  - Parkrun model: {'✅ GOOD' if parkrun_ok else '⚠️  LARGE'}")
    print(f"  - Event model: {'✅ GOOD' if event_ok else '⚠️  LARGE'}")

    print("\nOption 2: Use Workers AI with Hugging Face")
    print("  - Upload models to Hugging Face")
    print("  - Use @cloudflare/ai in Workers")
    print("  - May require model format conversion")

    print("\nOption 3: Simple API Service (FastAPI)")
    print("  - Deploy inference_api.py to Railway/Render")
    print("  - Workers call API for predictions")
    print("  - ~$5/month cost, auto-scaling")

    print("\nRECOMMENDATION:")
    if parkrun_ok and event_ok:
        print("✅ Both models are small enough!")
        print("Use Option 1 (xgboost.js in Workers) or Option 3 (API)")
    else:
        print("Models may be too large for Workers bundle")
        print("Use Option 3 (separate API service)")

    print()
