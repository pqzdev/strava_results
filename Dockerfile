# Dockerfile for Railway ML API deployment
FROM python:3.10-slim

# Set working directory
WORKDIR /app

# Copy ml directory
COPY ml/ /app/ml/

# Install Python dependencies
RUN cd ml && pip install --no-cache-dir -r requirements.txt

# Expose port
EXPOSE 8000

# Start command
CMD ["sh", "-c", "cd ml && uvicorn inference_api:app --host 0.0.0.0 --port ${PORT:-8000}"]
