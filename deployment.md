# Seive — Deployment Guide

This document covers every supported deployment path:

1. [Local Docker Compose](#1-local-docker-compose) ← recommended for staging
2. [Manual Server (VPS / bare-metal)](#2-manual-server-deployment)
3. [Azure (App Service + Azure Database for PostgreSQL)](#3-azure-deployment)
4. [Railway / Render (PaaS)](#4-railway--render-paas)

---

## Prerequisites

| Tool | Purpose |
|---|---|
| Docker ≥ 24 & Docker Compose v2 | Containerised deployment |
| Node.js 20 | Express API local dev |
| Python 3.11 | Flask ML local dev |
| PostgreSQL 14+ client (`psql`) | Running the init script |
| Git | Source control |

---

## 0 — Shared Pre-flight Checklist

Before deploying to **any** environment:

- [ ] Copy the trained model: `flask-ml/model/recommender_model.pkl` (see README §2)
- [ ] Create and populate both `.env` files (never commit them)
- [ ] Generate a strong `JWT_SECRET` and `SECRET_KEY` — at least 32 random characters
- [ ] Set `FLASK_DEBUG=0` and `FLASK_ENV=production` in Flask `.env`

---

## 1 — Local Docker Compose

This is the fastest way to run all three services together.

### 1.1 — Create `docker-compose.yml`

Create this file at the **project root**:

```yaml
version: "3.9"

services:
  # ── PostgreSQL ──────────────────────────────────────────
  db:
    image: postgres:15-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: movie_db
      POSTGRES_USER: movie_login
      POSTGRES_PASSWORD: your_password
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./express-api/init.sql:/docker-entrypoint-initdb.d/init.sql:ro
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U movie_login -d movie_db"]
      interval: 10s
      timeout: 5s
      retries: 5

  # ── Flask ML API ────────────────────────────────────────
  flask-ml:
    build:
      context: .
      dockerfile: Dockerfile
    restart: unless-stopped
    env_file: ./flask-ml/.env
    environment:
      MODEL_PATH: model/recommender_model.pkl
      PORT: "5000"
    volumes:
      - ./flask-ml/model:/app/model:ro
    ports:
      - "5000:5000"
    depends_on:
      db:
        condition: service_healthy

  # ── Express API ─────────────────────────────────────────
  express-api:
    build:
      context: ./express-api
      dockerfile: Dockerfile
    restart: unless-stopped
    env_file: ./express-api/.env
    environment:
      PORT: "3000"
      DB_HOST: db
      DB_PORT: "5432"
      DB_NAME: movie_db
      DB_USER: movie_login
      DB_PASSWORD: your_password
      DB_SSLMODE: disable          # SSL not needed inside Docker network
      FLASK_ML_URL: http://flask-ml:5000
    ports:
      - "3000:3000"
    depends_on:
      db:
        condition: service_healthy
      flask-ml:
        condition: service_started

volumes:
  postgres_data:
```

> **Note:** The `init.sql` is mounted into Postgres's `docker-entrypoint-initdb.d/` — it runs automatically on first startup.

### 1.2 — Build and Start

```bash
# From the project root
docker compose up --build -d

# Follow logs
docker compose logs -f

# Stop everything
docker compose down

# Wipe volumes (full reset)
docker compose down -v
```

### 1.3 — Verify

```bash
curl http://localhost:3000/health
# {"status":"ok","service":"seive-express-api","ts":"..."}

curl http://localhost:5000/health
# {"status":"ok","model_loaded":true,"model_path":"..."}
```

Open `frontend/index.html` in your browser and point it at `http://localhost:3000`.

---

## 2 — Manual Server Deployment

Use this for a Linux VPS (Ubuntu 22.04 / Debian 12).

### 2.1 — Install dependencies

```bash
# Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Python 3.11
sudo apt-get install -y python3.11 python3.11-venv python3-pip

# PostgreSQL
sudo apt-get install -y postgresql postgresql-client

# Process manager
sudo npm install -g pm2
```

### 2.2 — PostgreSQL setup

```bash
sudo -u postgres psql <<'SQL'
CREATE USER movie_login WITH PASSWORD 'your_password';
CREATE DATABASE movie_db OWNER movie_login;
GRANT ALL PRIVILEGES ON DATABASE movie_db TO movie_login;
SQL

psql -U movie_login -d movie_db -f express-api/init.sql
```

### 2.3 — Flask ML API (via Gunicorn + PM2)

```bash
cd /opt/seive/flask-ml
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r ../requirements.txt

# Copy the model
mkdir -p model
cp /path/to/movie_recommender_model.pkl model/recommender_model.pkl

# Create .env (edit values)
cp .env.example .env

# Start with PM2
pm2 start "gunicorn -w 2 -b 0.0.0.0:5000 app:app" \
    --name seive-flask \
    --cwd /opt/seive/flask-ml \
    --interpreter /opt/seive/flask-ml/.venv/bin/python

pm2 save
pm2 startup
```

### 2.4 — Express API (via PM2)

```bash
cd /opt/seive/express-api
npm ci --omit=dev

# Create .env (edit values)
cp .env.example .env

pm2 start server.js --name seive-express
pm2 save
```

### 2.5 — Frontend (via Nginx)

```bash
sudo apt-get install -y nginx

sudo tee /etc/nginx/sites-available/seive <<'NGINX'
server {
    listen 80;
    server_name your-domain.com;

    # Serve static frontend
    root /opt/seive/frontend;
    index index.html;

    # Proxy Express API
    location /api/ {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # Proxy Flask ML API (if exposed externally)
    location /ml/ {
        proxy_pass http://localhost:5000/;
        proxy_set_header Host $host;
    }
}
NGINX

sudo ln -s /etc/nginx/sites-available/seive /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### 2.6 — HTTPS with Certbot

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

---

## 3 — Azure Deployment

### 3.1 — Azure Database for PostgreSQL (Flexible Server)

```bash
# Create resource group
az group create --name seive-rg --location eastus

# Create Postgres Flexible Server
az postgres flexible-server create \
  --resource-group seive-rg \
  --name movie-recommender \
  --admin-user movie_login \
  --admin-password "your_strong_password" \
  --sku-name Standard_B1ms \
  --tier Burstable \
  --version 15 \
  --public-access 0.0.0.0

# Create database
az postgres flexible-server db create \
  --resource-group seive-rg \
  --server-name movie-recommender \
  --database-name movie_db

# Allow Azure services to connect
az postgres flexible-server firewall-rule create \
  --resource-group seive-rg \
  --name movie-recommender \
  --rule-name AllowAzureServices \
  --start-ip-address 0.0.0.0 \
  --end-ip-address 0.0.0.0
```

Run schema init:

```bash
psql "host=movie-recommender.postgres.database.azure.com \
      port=5432 \
      dbname=movie_db \
      user=movie_login \
      sslmode=require" \
  -f express-api/init.sql
```

### 3.2 — Azure Container Registry

```bash
az acr create \
  --resource-group seive-rg \
  --name seiveregistry \
  --sku Basic

az acr login --name seiveregistry

# Build and push Flask ML image
docker build -t seiveregistry.azurecr.io/seive-flask-ml:latest .
docker push seiveregistry.azurecr.io/seive-flask-ml:latest

# Build and push Express API image
docker build -t seiveregistry.azurecr.io/seive-express-api:latest ./express-api
docker push seiveregistry.azurecr.io/seive-express-api:latest
```

### 3.3 — Azure App Service (Flask ML)

```bash
az appservice plan create \
  --name seive-plan \
  --resource-group seive-rg \
  --is-linux \
  --sku B1

az webapp create \
  --resource-group seive-rg \
  --plan seive-plan \
  --name seive-flask-ml \
  --deployment-container-image-name seiveregistry.azurecr.io/seive-flask-ml:latest

# Set environment variables
az webapp config appsettings set \
  --resource-group seive-rg \
  --name seive-flask-ml \
  --settings \
    FLASK_ENV=production \
    FLASK_DEBUG=0 \
    SECRET_KEY="your_secret_key" \
    MODEL_PATH="model/recommender_model.pkl" \
    DB_HOST="movie-recommender.postgres.database.azure.com" \
    DB_PORT=5432 \
    DB_NAME=movie_db \
    DB_USER=movie_login \
    DB_PASSWORD="your_strong_password" \
    DB_SSLMODE=require
```

### 3.4 — Azure App Service (Express API)

```bash
az webapp create \
  --resource-group seive-rg \
  --plan seive-plan \
  --name seive-express-api \
  --deployment-container-image-name seiveregistry.azurecr.io/seive-express-api:latest

az webapp config appsettings set \
  --resource-group seive-rg \
  --name seive-express-api \
  --settings \
    PORT=3000 \
    DB_HOST="movie-recommender.postgres.database.azure.com" \
    DB_PORT=5432 \
    DB_NAME=movie_db \
    DB_USER=movie_login \
    DB_PASSWORD="your_strong_password" \
    DB_SSLMODE=require \
    JWT_SECRET="your_jwt_secret" \
    FLASK_ML_URL="https://seive-flask-ml.azurewebsites.net"
```

### 3.5 — Frontend on Azure Static Web Apps

```bash
az staticwebapp create \
  --name seive-frontend \
  --resource-group seive-rg \
  --source https://github.com/your-username/movie_reccomender-system-1 \
  --location eastus2 \
  --branch main \
  --app-location "frontend" \
  --output-location ""
```

---

## 4 — Railway / Render (PaaS)

Both platforms are Docker-native and zero-config friendly.

### Railway

1. Install Railway CLI: `npm i -g @railway/cli`
2. `railway login`
3. Add a **PostgreSQL** plugin from the Railway dashboard
4. Deploy services:

```bash
# From project root — Flask ML
railway up --service flask-ml

# From express-api/ — Express API
cd express-api
railway up --service express-api
```

5. Set environment variables in the Railway dashboard for each service.
6. Deploy the frontend to **Vercel** or **Netlify** (drag-and-drop the `frontend/` folder).

### Render

1. Create a **PostgreSQL** instance on Render → copy the Internal DB URL
2. Create a **Web Service** for Flask ML:
   - Root directory: `.`
   - Dockerfile path: `Dockerfile`
   - Set env vars (use Render's secret store)
3. Create a **Web Service** for Express API:
   - Root directory: `express-api`
   - Dockerfile path: `express-api/Dockerfile`
   - `DATABASE_URL` = Render's internal Postgres URL
4. Create a **Static Site** for the frontend:
   - Root directory: `frontend`
   - Build command: *(leave empty)*
   - Publish directory: `frontend`

---

## 5 — Health Checks & Smoke Tests

Run these after every deployment:

```bash
# Express API
curl https://your-domain.com/health

# Flask ML
curl https://your-flask-domain.com/health

# Auth flow
curl -X POST https://your-domain.com/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"Test1234!","username":"tester"}'

# Recommendations (replace TOKEN)
curl https://your-domain.com/api/recommendations \
  -H "Authorization: Bearer TOKEN"

# ML direct
curl "https://your-flask-domain.com/api/recommend/1?top_n=5"
```

---

## 6 — Environment Variable Quick Reference

| Variable | Service | Description |
|---|---|---|
| `PORT` | Both | Listening port |
| `DB_HOST` | Both | Postgres host |
| `DB_PORT` | Both | Postgres port (default `5432`) |
| `DB_NAME` | Both | Database name |
| `DB_USER` | Both | DB username |
| `DB_PASSWORD` | Both | DB password |
| `DB_SSLMODE` | Both | `require` (Azure) or `disable` (local) |
| `JWT_SECRET` | Express | JWT signing secret |
| `ALLOWED_ORIGINS` | Express | CORS allowed origins |
| `FLASK_ML_URL` | Express | Base URL of the Flask ML service |
| `MODEL_PATH` | Flask | Path to `.pkl` model file |
| `SECRET_KEY` | Flask | Flask secret key |
| `FLASK_DEBUG` | Flask | `0` in production |

---

## 7 — Troubleshooting

| Symptom | Likely Cause | Fix |
|---|---|---|
| `503 Model file not found` | `.pkl` not mounted | Check `MODEL_PATH` and volume mount |
| `ECONNREFUSED 5432` | Postgres not ready | Wait for healthcheck or check `DB_HOST` |
| `JWT malformed` | Wrong `JWT_SECRET` | Ensure Express and client share the same secret |
| `CORS error` | `ALLOWED_ORIGINS` mismatch | Add frontend origin to `ALLOWED_ORIGINS` |
| Postgres SSL error | `DB_SSLMODE` wrong | Use `require` for Azure, `disable` inside Docker network |
| `User X not found` | User ID not in training set | Valid IDs are **1–610** (MovieLens Small) |
