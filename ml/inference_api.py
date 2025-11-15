#!/usr/bin/env python3

"""
Lightweight ML Inference API for Cloudflare Workers

Deploy this to Railway/Render/Cloud Run for ML predictions.
Workers will call this API with race features.

Usage:
  uvicorn inference_api:app --reload

Deploy to Railway:
  railway init
  railway up
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import pickle
import numpy as np
from pathlib import Path
from typing import List, Dict, Optional
import logging

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Paths
MODELS_DIR = Path(__file__).parent / "models"
PARKRUN_MODEL = MODELS_DIR / "parkrun_classifier_simple.pkl"
EVENT_MODEL = MODELS_DIR / "event_predictor.pkl"
LABEL_ENCODER = MODELS_DIR / "event_predictor_label_encoder.pkl"

# Load models at startup
logger.info("Loading models...")
with open(PARKRUN_MODEL, 'rb') as f:
    parkrun_model = pickle.load(f)
with open(EVENT_MODEL, 'rb') as f:
    event_model = pickle.load(f)
with open(LABEL_ENCODER, 'rb') as f:
    label_encoder = pickle.load(f)
logger.info("Models loaded successfully!")

# FastAPI app
app = FastAPI(
    title="Race Classification API",
    description="ML inference for parkrun detection and event prediction",
    version="1.0.0"
)

# CORS for Cloudflare Workers
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure this properly in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ParkrunFeatures(BaseModel):
    """Features for parkrun binary classifier (10 features)"""
    contains_parkrun: int  # 0 or 1
    is_5k: int  # 0 or 1
    hour_8: int  # 0 or 1
    hour: int  # 0-23
    distance_km: float
    name_length: int
    elevation_gain: float
    day_5: int  # Saturday = 1
    pace_min_per_km: float
    day_of_week: int  # 0-6


class EventFeatures(BaseModel):
    """Features for event predictor (32 features)"""
    # Core features
    distance_km: float
    pace_min_per_km: float
    elevation_gain: float

    # Time features
    day_of_week: int
    hour: int
    month: int

    # Text features
    contains_parkrun: int
    contains_marathon: int
    contains_half: int
    contains_ultra: int
    contains_fun_run: int
    name_length: int

    # Distance categories
    is_5k: int
    is_10k: int
    is_half_marathon: int
    is_marathon: int
    is_ultra: int

    # One-hot encoded features (all optional, default 0)
    day_0: Optional[int] = 0
    day_1: Optional[int] = 0
    day_2: Optional[int] = 0
    day_3: Optional[int] = 0
    day_4: Optional[int] = 0
    day_5: Optional[int] = 0
    day_6: Optional[int] = 0
    hour_6: Optional[int] = 0
    hour_7: Optional[int] = 0
    hour_8: Optional[int] = 0
    hour_9: Optional[int] = 0
    hour_10: Optional[int] = 0
    hour_other: Optional[int] = 0  # For hours not in 6-10 range


class ParkrunPrediction(BaseModel):
    is_parkrun: bool
    probability: float
    model: str = "parkrun_classifier_simple"


class EventPrediction(BaseModel):
    event_name: str
    probability: float
    top_3: List[Dict[str, float]]
    model: str = "event_predictor"


@app.get("/")
async def root():
    """Health check"""
    return {
        "status": "ok",
        "service": "Race Classification API",
        "models": {
            "parkrun_classifier": "loaded",
            "event_predictor": "loaded"
        }
    }


@app.get("/health")
async def health():
    """Health check endpoint"""
    return {"status": "healthy"}


@app.post("/predict/parkrun", response_model=ParkrunPrediction)
async def predict_parkrun(features: ParkrunFeatures):
    """
    Predict if a race is a parkrun

    Returns:
        - is_parkrun: boolean prediction
        - probability: confidence score (0-1)
    """
    try:
        # Convert features to numpy array in correct order
        X = np.array([[
            features.contains_parkrun,
            features.is_5k,
            features.hour_8,
            features.hour,
            features.distance_km,
            features.name_length,
            features.elevation_gain,
            features.day_5,
            features.pace_min_per_km,
            features.day_of_week,
        ]], dtype=np.float32)

        # Predict
        prediction = parkrun_model.predict(X)[0]
        probability = parkrun_model.predict_proba(X)[0][1]  # Probability of class 1 (parkrun)

        return ParkrunPrediction(
            is_parkrun=bool(prediction == 1),
            probability=float(probability)
        )

    except Exception as e:
        logger.error(f"Error in parkrun prediction: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/predict/event", response_model=EventPrediction)
async def predict_event(features: EventFeatures):
    """
    Predict the event name for a race

    Returns:
        - event_name: predicted event name
        - probability: confidence score for top prediction
        - top_3: list of top 3 predictions with probabilities
    """
    try:
        # Convert features to numpy array (32 features in correct order)
        # This order MUST match the training order from feature_engineering.py
        # Note: coord_count is included but always 0 (polylines not decoded during training)
        X = np.array([[
            features.distance_km,
            features.pace_min_per_km,
            features.elevation_gain,
            features.day_of_week,
            features.hour,
            features.month,
            features.contains_parkrun,
            features.contains_marathon,
            features.contains_half,
            features.contains_ultra,
            features.contains_fun_run,
            features.name_length,
            features.is_5k,
            features.is_10k,
            features.is_half_marathon,
            features.is_marathon,
            features.is_ultra,
            0,  # coord_count (always 0, polylines not decoded)
            0,  # day_of_week.1 (artifact from pandas one-hot encoding, always 0)
            features.day_0,
            features.day_1,
            features.day_2,
            features.day_3,
            features.day_4,
            features.day_5,
            features.day_6,
            features.hour_6,
            features.hour_7,
            features.hour_8,
            features.hour_9,
            features.hour_10,
            features.hour_other,
        ]], dtype=np.float32)

        # Predict
        prediction = event_model.predict(X)[0]
        probabilities = event_model.predict_proba(X)[0]

        # Get top 3 predictions
        top_3_indices = np.argsort(probabilities)[-3:][::-1]
        top_3 = [
            {
                "event_name": label_encoder.classes_[idx],
                "probability": float(probabilities[idx])
            }
            for idx in top_3_indices
        ]

        return EventPrediction(
            event_name=label_encoder.classes_[prediction],
            probability=float(probabilities[prediction]),
            top_3=top_3
        )

    except Exception as e:
        logger.error(f"Error in event prediction: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/predict/batch")
async def predict_batch(races: List[Dict]):
    """
    Batch prediction for multiple races

    This is more efficient than individual API calls.
    """
    try:
        results = []
        for race in races:
            # Extract features and predict
            # Implementation depends on your needs
            pass

        return {"results": results}

    except Exception as e:
        logger.error(f"Error in batch prediction: {e}")
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
