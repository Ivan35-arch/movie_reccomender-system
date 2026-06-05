# Seive — Movie Recommendation System

A full-stack personalized movie recommendation platform using collaborative filtering (user-based cosine similarity) and real-time updates via SSE.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      Frontend (Vercel)                  │
│         Vanilla JS / HTML / CSS (static site)           │
└────────────────────┬────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────┐
│              Flask API (Render, Full Python)            │
│  ├─ GET /api/movies (list movies)                       │
│  ├─ GET /api/movie/<title> (search)                     │
│  ├─ GET /api/recommend/<user_id> (recommendations)      │
│  ├─ POST /api/ratings (write rating to DB)             │
│  ├─ POST /api/recompute/<user_id> (cache recs)         │
│  └─ GET /sse/notifications (real-time updates)          │
└────────┬──────────────────────────────────────────────┘
         │
    ┌────▼──────────────────┐
    │ Azure PostgreSQL       │
    │ (Tables: movies,       │
    │  ratings, recs,        │
    │  notifications)        │
    └────────────────────────┘

ML Engine (inside Flask)
├── MovieLens dataset (610 users, 9.7K movies)
├── User-based cosine similarity (model.joblib)
└── TMDb API enrichment (posters, ratings, overviews)
```

## Features

- **Collaborative Filtering**: User-based cosine similarity recommendations (from MovieLens dataset)
- **Real-time Updates**: SSE notifications when recommendations are generated
- **Movie Enrichment**: Fetch posters, ratings, overviews from TMDb API
- **Caching**: Store recommendations in DB for fast retrieval
- **JWT Auth Stub**: Placeholder endpoints for login/register (ready to extend)

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | Vanilla JS / HTML / CSS |
| Backend (API) | Flask (Python) — all endpoints |
| ML Engine | scikit-learn (user-based CF) + joblib |
| Database | PostgreSQL (Azure) |
| Deployment | Vercel (Frontend), Render (Flask API) |

## Quick Start (Local Development)

### Prerequisites
- Python 3.11+ (Flask ML)
- PostgreSQL 15+ or access to Azure PostgreSQL
- Docker & Docker Compose (optional)

### 1. Set Up Environment

Copy credentials into `.env.local` (already created):
```bash
cat .env.local
# Should contain:
# DATABASE_URL=postgresql://movie_login:@hazardkid10@movie-recommender.postgres.database.azure.com:5432/movie_db
# MODEL_PATH=C:/Users/USER/Desktop/movie_reccomender-system/movie_recommender_model.joblib
# etc.
```

### 2. Initialize Database

Run schema and seed movies (one-time):
```bash
psql postgresql://movie_login:@hazardkid10@movie-recommender.postgres.database.azure.com:5432/movie_db < flask-ml/init.sql
```

### 3. Start Services Locally

**Option A: Using Docker Compose**
```bash
docker-compose --env-file .env.local up --build
# Services:
# - Flask: http://localhost:5000
# - Express: http://localhost:3000
# - Postgres: localhost:5432
```

**Option B: Run Flask locally**

Flask (Terminal 1):
```bash
cd flask-ml
pip install -r requirements.txt
python run_dev.py
# Runs on http://localhost:5000
```

Frontend (Terminal 2):
```bash
cd frontend
python -m http.server 8000
# Open browser: http://localhost:8000
```

### 4. Test the Flow

1. **Search for a movie**: type in the search box
2. **Rate it**: click the stars (1-5)
3. **Watch recommendations**: sidebar updates with predictions
4. **Monitor notifications**: live SSE events in the events panel

## API Endpoints

All endpoints run on **Flask** (http://localhost:5000/api or https://your-render-flask.onrender.com/api):

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Liveness probe |
| GET | `/movies?page=1&per_page=20` | List all movies (paginated) |
| GET | `/movie/<title>` | Search movies by (partial) title |
| GET | `/recommend/<user_id>?top_n=10` | Recommendations for existing user |
| POST | `/recommend/new-user` | Cold-start recs for new user with initial ratings |
| POST | `/recompute/<user_id>` | Regenerate + cache recs for user |
| GET | `/similar-users/<user_id>` | Find similar users (cosine similarity) |
| POST | `/ratings` | Write movie rating to database |
| GET | `/sse/notifications?user_id=<id>` | Real-time SSE event stream |

## Project Structure

```
movie-recommender/
├── frontend/                    # Vanilla JS/HTML/CSS (static site)
│   ├── index.html              # Main UI
│   ├── app.js                  # Client logic (search, rating, SSE)
│   └── styles.css              # Dark theme, glassmorphism
├── flask-ml/                    # Python Flask API (all endpoints)
│   ├── app.py                  # Flask app: ML, ratings, SSE, enrichment
│   ├── run_dev.py              # Dev server runner
│   ├── requirements.txt         # pip dependencies
│   ├── Dockerfile              # Container image
│   ├── init.sql                # PostgreSQL schema
│   ├── dotenv.py               # Config loader
│   ├── model.ipynb             # Training notebook (MovieLens)
│   ├── model/
│   │   └── movie_recommender_model.joblib  # Trained CF model
│   └── scripts/
│       └── seed_movies.py       # Movie data loader
├── .env.local                  # Local secrets (git-ignored)
├── .gitignore
├── docker-compose.yml          # Local dev: postgres + flask
├── render.yaml                 # Render deployment manifest
├── DEPLOYMENT.md               # Deployment instructions
└── README.md                   # This file
```

## Model Details

**Training Data**: MovieLens 100K dataset
- 610 users, 9,724 movies, ~100K ratings
- Built with scikit-learn (cosine similarity)
- Saved as `movie_recommender_model.joblib`

**Inference**: User-based collaborative filtering
- For a user, find top-5 most similar users (cosine similarity)
- Average their ratings for unseen movies
- Return top-N highest-predicted-rating movies

**Cold-start**: For new users, collect a few rated movies and compute similarity against the training corpus.

## Deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md) for step-by-step instructions for:
- **Local Docker Compose** (Postgres + Flask)
- **Render** (Flask API with gunicorn)
- **Vercel** (Frontend static site)
- **Azure Firewall** rules
- **Troubleshooting**

## Key Files to Know

- `flask-ml/app.py` — Flask API: all endpoints (search, recommendations, ratings, SSE, enrichment)
- `frontend/app.js` — Client-side logic (search, rating, SSE notifications)
- `frontend/index.html` — Semantic HTML structure
- `frontend/styles.css` — Dark theme with glassmorphism
- `render.yaml` — Render deployment configuration for Flask
- `docker-compose.yml` — Local development orchestration (postgres + flask)
- `.env.local` — Local dev secrets (not committed to git)

## Future Enhancements

- [ ] Content-based filtering (genres, cast, keywords)
- [ ] Hybrid model (CF + content)
- [ ] Real-time model retraining (batch jobs)
- [ ] User profile customization (preferences, watched history)
- [ ] Mobile app (React Native)
- [ ] Analytics dashboard (user engagement, model performance)
- [ ] A/B testing for recommendation algorithms

## License

MIT

---

**Questions?** See [DEPLOYMENT.md](./DEPLOYMENT.md) or check [render.yaml](./render.yaml) for service configs.
