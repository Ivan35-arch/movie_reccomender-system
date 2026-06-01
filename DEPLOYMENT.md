# Deployment Guide

## Overview

This is a **full-Python stack** using Flask for all API endpoints (ML inference, ratings, real-time notifications).

**Services**
- Flask (Python): ML recommendations, ratings, SSE notifications
- PostgreSQL (Azure): single source of truth
- Frontend (Vanilla JS): served statically by Flask or separate

## Local Development

1. Ensure `.env.local` has your database credentials:
```bash
cat .env.local
# DATABASE_URL=postgresql://movie_login:@hazardkid10@movie-recommender.postgres.database.azure.com:5432/movie_db
# MODEL_PATH=/path/to/movie_recommender_model.joblib
```

2. **Start with Docker Compose**:
```bash
docker-compose --env-file .env.local up --build
# Flask runs on http://localhost:5000
# Postgres runs on localhost:5432
```

Or run Flask locally:
```bash
cd flask-ml
python run_dev.py
# Runs on http://localhost:5000
```

3. **Test endpoints**:
```bash
curl http://localhost:5000/health
curl http://localhost:5000/api/movies?page=1&per_page=5
curl -X POST http://localhost:5000/api/ratings \
  -H "Content-Type: application/json" \
  -d '{"user_id":1, "movie_id":1, "rating":4.5}'
```

## Deploy Flask to Render

1. **Push your repo to GitHub** (with `render.yaml` and model file or disk setup).

2. **Create Render Web Service**:
   - Go to [render.com](https://render.com) → Dashboard → **New** → **Web Service**
   - Connect your GitHub repo
   - Render will auto-detect `render.yaml` and read configuration

3. **Set Environment Variables** (Render Dashboard → Settings → Environment):
   - **DATABASE_URL**: `postgresql://movie_login:@hazardkid10@movie-recommender.postgres.database.azure.com:5432/movie_db`
   - **TMDB_API_KEY**: (optional, for movie enrichment)
   - **SECRET_KEY**: (random strong secret)
   - **JWT_SECRET**: (random strong secret)
   - **MODEL_PATH**: `/opt/render/project/src/flask-ml/model/movie_recommender_model.joblib`

4. **Upload or Include Model**:
   - Option A: Place model file in `flask-ml/model/movie_recommender_model.joblib` and commit to repo
   - Option B: Use Render Disks to upload after deployment
   - Ensure `MODEL_PATH` points to the model location

5. **Initialize Database** (one-time):
```bash
psql postgresql://movie_login:@hazardkid10@movie-recommender.postgres.database.azure.com:5432/movie_db < flask-ml/init.sql
```

Verify tables:
```bash
psql postgresql://movie_login:@hazardkid10@movie-recommender.postgres.database.azure.com:5432/movie_db
\dt
```

6. **Test Deployment**:
   - Render URL (example): `https://seive-flask.onrender.com`
   - Test:
     ```bash
     curl https://seive-flask.onrender.com/health
     curl https://seive-flask.onrender.com/api/movies?page=1&per_page=5
     ```

## Deploy Frontend to Vercel

1. **Create Vercel Project**:
   - Go to [vercel.com](https://vercel.com) → **Add New** → **Project**
   - Import your GitHub repo
   - **Framework Preset**: None
   - **Root Directory**: `./frontend`
   - **Build Command**: (empty for static)
   - **Output Directory**: `./frontend`

2. **Set Environment Variables** (Vercel Dashboard → Settings → Environment Variables):
   - **REACT_APP_API_URL**: `https://seive-flask.onrender.com` (your Render Flask URL)

3. **Deploy**:
   - Click **Deploy** on Vercel dashboard
   - Vercel will auto-deploy on repo pushes

## Azure Firewall Rules

To allow Render to access Azure PostgreSQL:

1. **Azure Portal** → PostgreSQL Server → **Networking**
2. Add firewall rules:
   - Render IP (check Render docs for IP range or use `0.0.0.0/0` for dev only)
   - Or toggle **Allow access to Azure services** (less secure for production)

## API Endpoints

All endpoints on Flask:

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Liveness probe |
| GET | `/api/movies` | List all movies (paginated) |
| GET | `/api/movie/<title>` | Search movies by title |
| GET | `/api/recommend/<user_id>` | Get recommendations for user |
| POST | `/api/ratings` | Write a movie rating |
| POST | `/api/recompute/<user_id>` | Regenerate + cache recs |
| GET | `/sse/notifications` | Real-time SSE stream |

## Monitoring & Logs

- **Render**: Dashboard → Service → **Logs** tab
- **Vercel**: Dashboard → **Deployments** → click deployment
- **Azure**: Query logs or use Connection string in psql

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `Model not found` | Ensure model is at `MODEL_PATH` in Render; check env vars |
| `DATABASE_URL not set` | Add `DATABASE_URL` to Render Environment Variables |
| `Connection refused` | Check Azure firewall allows Render IP; test with `psql` locally |
| `SSE not working` | Flask SSE needs persistent connection; Vercel serverless won't support it — keep Flask on Render for SSE |
| `CORS errors` | Flask has `flask-cors` enabled for `*` origins; adjust in `app.py` if needed |



