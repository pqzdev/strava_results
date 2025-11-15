# Railway ML API Deployment
FROM python:3.11-slim

# Set working directory to ml subdirectory
WORKDIR /app/ml

# Copy requirements first for better Docker layer caching
COPY ml/requirements.txt .

# Install dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy the entire ml directory (including models and inference_api.py)
COPY ml/ .

# Expose port (Railway sets PORT env var)
EXPOSE 8000

# Start the API server
CMD uvicorn inference_api:app --host 0.0.0.0 --port ${PORT:-8000}
