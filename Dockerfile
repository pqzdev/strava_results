# Dockerfile for Railway ML API deployment
FROM python:3.10-slim

# Set working directory
WORKDIR /app

# Copy everything from repo
COPY . /app/

# Debug: List what was copied
RUN ls -la /app && ls -la /app/ml || echo "ml directory not found"

# Install Python dependencies from ml directory
RUN cd /app/ml && pip install --no-cache-dir -r requirements.txt

# Expose port
EXPOSE 8000

# Start command - run from ml directory
CMD ["sh", "-c", "cd /app/ml && uvicorn inference_api:app --host 0.0.0.0 --port ${PORT:-8000}"]
