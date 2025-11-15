# Railway ML API Deployment
FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Copy requirements first for better Docker layer caching
COPY requirements.txt .

# Install dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy everything (models, inference_api.py, etc.)
COPY . .

# Expose port (Railway sets PORT env var)
EXPOSE 8000

# Start the API server
CMD uvicorn inference_api:app --host 0.0.0.0 --port ${PORT:-8000}
