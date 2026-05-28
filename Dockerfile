FROM python:3.11-slim

WORKDIR /app

# Install curl for Docker healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY flask-ml/ .

EXPOSE 5000

# Use gunicorn in production (2 workers; tune up for larger servers)
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "2", "--timeout", "120", "app:app"]