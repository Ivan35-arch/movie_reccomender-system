# 🎬 Seive — Movie Recommender System

> A full-stack, AI-powered movie recommendation platform built with collaborative-filtering ML, a Node.js REST API, PostgreSQL, and a responsive frontend.

---

## 📐 Architecture Overview

```
Browser  (frontend/index.html + app.js)
    │  HTTP
    ▼
Express REST API  :3000  (express-api/)
    │                │
 PostgreSQL       HTTP
 (movie_db)         │
                    ▼
              Flask ML API  :5000  (flask-ml/)
```

| Service | Tech | Port | Role |
|---|---|---|---|
| **Frontend** | HTML / CSS / Vanilla JS | static | UI |
| **Express API** | Node.js 20, Express 4 | `3000` | Auth, movies, watchlist, ratings… |
| **Flask ML API** | Python 3.11, Flask 3 | `5000` | Collaborative-filtering recs |
| **Database** | PostgreSQL 15 | `5432` | Persistent storage |

---

## 🗂️ Project Structure

```
movie_reccomender-system-1/
├── frontend/                   # Static web frontend
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── express-api/                # Node.js REST API
│   ├── server.js
│   ├── db.js
│   ├── init.sql                # DB schema
│   ├── package.json
│   ├── Dockerfile
│   └── routes/
│       ├── auth.js
│       ├── movies.js
│       ├── recommendations.js
│       ├── ratings.js
│       ├── watchlist.js
│       ├── history.js
│       └── notifications.js
├── flask-ml/                   # Python ML API
│   ├── app.py
│   ├── .env
│   └── model/
│       └── recommender_model.pkl
├── model.ipynb                 # Model training notebook
├── movie_recommender_model.pkl # Raw trained model artifact
├── requirements.txt            # Python dependencies
├── Dockerfile                  # Flask ML Dockerfile
└── .dockerignore
```

---

## ✨ Features

- 🔐 JWT Authentication (register / login)
- 🎥 Movie catalogue with full-text search
- 🤖 User-based collaborative-filtering recommendations
- ❄️ Cold-start support for new users
- ⭐ Star ratings (0.5–5.0)
- 📋 Watchlist management
- 📜 Watch history tracking
- 🔔 In-app notifications

---

## ⚙️ Environment Variables

### `express-api/.env`

```env
PORT=3000
DB_HOST=localhost
DB_PORT=5432
DB_NAME=movie_db
DB_USER=movie_login
DB_PASSWORD=your_password
DB_SSLMODE=require
JWT_SECRET=change-me-in-production
ALLOWED_ORIGINS=http://localhost:3000
FLASK_ML_URL=http://localhost:5000
```

### `flask-ml/.env`

```env
FLASK_ENV=production
FLASK_DEBUG=0
SECRET_KEY=change-me-in-production
PORT=5000
MODEL_PATH=model/recommender_model.pkl
DB_HOST=localhost
DB_PORT=5432
DB_NAME=movie_db
DB_USER=movie_login
DB_PASSWORD=your_password
DB_SSLMODE=require
```

> ⚠️ Never commit `.env` files — add them to `.gitignore`.

---

## 🚀 Quick Start (Local Dev)

### Prerequisites

| Tool | Min Version |
|---|---|
| Node.js | 20+ |
| Python | 3.11+ |
| PostgreSQL | 14+ |

### 1 — Clone

```bash
git clone https://github.com/your-username/movie_reccomender-system-1.git
cd movie_reccomender-system-1
```

### 2 — Prepare the ML model

```bash
mkdir -p flask-ml/model
cp movie_recommender_model.pkl flask-ml/model/recommender_model.pkl
```

Or re-train by running `model.ipynb`, then copy the output `.pkl` to `flask-ml/model/`.

### 3 — Flask ML API

```bash
cd flask-ml
python -m venv .venv
# Windows:
.venv\Scripts\activate
# macOS/Linux:
source .venv/bin/activate

pip install -r ../requirements.txt
# create .env from the template above
python app.py
# → http://localhost:5000
```

### 4 — Database

```bash
psql -U postgres -c "CREATE DATABASE movie_db;"
psql -U postgres -d movie_db -f express-api/init.sql
```

### 5 — Express API

```bash
cd express-api
npm install
# create .env from the template above
npm run dev
# → http://localhost:3000
```

### 6 — Frontend

Open `frontend/index.html` directly in a browser, or:

```bash
npx serve frontend
```

---

## 🌐 API Reference

### Express API (`localhost:3000`)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | — | Health check |
| `POST` | `/api/auth/register` | — | Register |
| `POST` | `/api/auth/login` | — | Login → JWT |
| `GET` | `/api/movies` | JWT | List / search movies |
| `GET` | `/api/recommendations` | JWT | Get ML recommendations |
| `POST` | `/api/ratings` | JWT | Submit rating |
| `GET/POST` | `/api/watchlist` | JWT | Watchlist CRUD |
| `DELETE` | `/api/watchlist/:id` | JWT | Remove from watchlist |
| `GET/POST` | `/api/history` | JWT | Watch history |
| `GET/PATCH` | `/api/notifications` | JWT | Notifications |

### Flask ML API (`localhost:5000`)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Liveness probe |
| `GET` | `/api/users` | All training user IDs |
| `GET` | `/api/movies` | Movie list (paginated) |
| `GET` | `/api/movie/<title>` | Partial-title search |
| `GET` | `/api/recommend/<user_id>` | Recs for existing user |
| `POST` | `/api/recommend/new-user` | Cold-start recs |
| `GET` | `/api/similar-users/<user_id>` | Similar users |

---

## 🗄️ Database Schema

Tables created by `express-api/init.sql`:

| Table | Purpose |
|---|---|
| `users` | App accounts |
| `movies` | Catalogue (TMDb + MovieLens IDs) |
| `ratings` | User ratings 0.5–5.0 |
| `recommendations` | Cached ML results |
| `watchlist` | Per-user watchlist |
| `watch_history` | Per-user watch history |
| `notifications` | In-app notifications |

---

## 🐳 Docker

See **[deployment.md](./deployment.md)** for full Docker Compose and cloud deployment instructions.

```bash
# Flask ML
docker build -t seive-flask-ml .
docker run -p 5000:5000 --env-file flask-ml/.env seive-flask-ml

# Express API
docker build -t seive-express-api ./express-api
docker run -p 3000:3000 --env-file express-api/.env seive-express-api
```

---

## 📄 License

MIT © 2026 Seive
