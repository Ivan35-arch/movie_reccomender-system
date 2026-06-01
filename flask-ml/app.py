"""
Movie Recommender System — Flask ML API
---------------------------------------
Built from model.ipynb (User-based Collaborative Filtering, MovieLens Small).

Saved model structure (model/recommender_model.pkl):
  {
    'user_similarity'  : np.ndarray  (610 x 610 cosine-similarity matrix),
    'user_item_matrix' : pd.DataFrame (610 users x 9719 movies, ratings pivot)
  }

Endpoints
---------
GET  /health                          → service liveness check
GET  /api/users                       → list all known user IDs
GET  /api/movies                      → list all movie titles
GET  /api/recommend/<int:user_id>     → top-N recommendations for a known user
POST /api/recommend/new-user          → recommendations for a cold-start user
                                        (provide rated movies in request body)
GET  /api/similar-users/<int:user_id> → find top similar users
GET  /api/movie/<string:title>        → search movie by (partial) title
"""

import os
import logging
from functools import wraps

import numpy as np
import joblib
import json
import requests
import psycopg2.extras
from flask import Flask, jsonify, request, abort
from flask import send_from_directory
from flask_cors import CORS
from dotenv import load_dotenv

# ---------------------------------------------------------------------------
# Bootstrap
# ---------------------------------------------------------------------------
load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s – %(message)s",
)
logger = logging.getLogger(__name__)

app = Flask(__name__)
app.config["SECRET_KEY"] = os.getenv("SECRET_KEY", "dev-secret")

CORS(app, resources={r"/api/*": {"origins": "*"}})

# ---------------------------------------------------------------------------
# Model loading
# ---------------------------------------------------------------------------
MODEL_PATH = os.getenv("MODEL_PATH", "model/recommender_model.pkl")
_model_data: dict | None = None


def get_model() -> dict:
    """Lazy-load the model once and cache it."""
    global _model_data
    if _model_data is None:
        if not os.path.exists(MODEL_PATH):
            raise FileNotFoundError(
                f"Model file not found at '{MODEL_PATH}'. "
                "Run the notebook to generate 'recommender_model.pkl' first, "
                "then place it in flask-ml/model/."
            )
        logger.info("Loading model from %s …", MODEL_PATH)
        _model_data = joblib.load(MODEL_PATH)
        logger.info(
            "Model loaded — %d users, %d movies.",
            _model_data["user_item_matrix"].shape[0],
            _model_data["user_item_matrix"].shape[1],
        )
    return _model_data


# ---------------------------------------------------------------------------
# Database stub  (wire up your Azure PostgreSQL connection here)
# ---------------------------------------------------------------------------
def get_db_connection():
    """
    TODO: replace this stub with your real Azure PostgreSQL connection.

    Example using psycopg2:
        import psycopg2, os
        conn = psycopg2.connect(
            host     = os.getenv("DB_HOST"),
            port     = os.getenv("DB_PORT", 5432),
            dbname   = os.getenv("DB_NAME"),
            user     = os.getenv("DB_USER"),
            password = os.getenv("DB_PASSWORD"),
            sslmode  = os.getenv("DB_SSLMODE", "require"),
        )
        return conn
    """
    # Prefer a single `DATABASE_URL` (heroku/Postgres-style) if provided.
    import psycopg2

    database_url = os.getenv("DATABASE_URL")
    if database_url:
        # psycopg2 accepts the URL directly; ensure SSL mode is set when required
        return psycopg2.connect(database_url, sslmode=os.getenv("DB_SSLMODE", "require"))

    # Fallback to individual DB_* environment variables
    return psycopg2.connect(
        host=os.getenv("DB_HOST"),
        port=int(os.getenv("DB_PORT", 5432)),
        dbname=os.getenv("DB_NAME"),
        user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASSWORD"),
        sslmode=os.getenv("DB_SSLMODE", "require"),
    )


# ---------------------------------------------------------------------------
# Helper utilities
# ---------------------------------------------------------------------------
def _require_model(f):
    """Decorator — returns 503 when the model file is missing."""
    @wraps(f)
    def wrapper(*args, **kwargs):
        try:
            get_model()
        except FileNotFoundError as exc:
            return jsonify({"error": str(exc)}), 503
        return f(*args, **kwargs)
    return wrapper


def find_similar_users(user_id: int, user_similarity: np.ndarray,
                       user_item_matrix, top_n: int = 5):
    """Return the top-N most similar user IDs for *user_id*."""
    user_index = user_item_matrix.index.get_loc(user_id)
    similarities = user_similarity[user_index]
    similar_indices = np.argsort(similarities)[::-1][1: top_n + 1]
    similar_user_ids = user_item_matrix.index[similar_indices].tolist()
    similar_scores = similarities[similar_indices].tolist()
    return similar_user_ids, similar_scores


def generate_recommendations(user_id: int, user_similarity: np.ndarray,
                              user_item_matrix, top_n: int = 10,
                              exclude_seen: bool = True) -> list[dict]:
    """
    Collaborative-filtering recommendations for a *known* user.

    Parameters
    ----------
    user_id      : existing user ID in the matrix
    top_n        : number of movies to return
    exclude_seen : if True, remove movies the user has already rated
    """
    similar_user_ids, _ = find_similar_users(
        user_id, user_similarity, user_item_matrix, top_n=5
    )
    similar_ratings = user_item_matrix.loc[similar_user_ids]
    avg_ratings = similar_ratings.mean()

    if exclude_seen:
        already_rated = user_item_matrix.loc[user_id]
        avg_ratings = avg_ratings[already_rated == 0]

    top_movies = avg_ratings.sort_values(ascending=False).head(top_n)

    return [
        {"title": title, "predicted_rating": round(float(score), 4)}
        for title, score in top_movies.items()
    ]


def cold_start_recommendations(user_ratings: dict, user_similarity: np.ndarray,
                                user_item_matrix, top_n: int = 10) -> list[dict]:
    """
    Recommendations for a *new* user not yet in the matrix.

    Parameters
    ----------
    user_ratings : {movie_title: rating, ...}  — the user's explicit ratings
    """
    import pandas as pd

    # Build a sparse profile vector aligned to the matrix columns
    new_user_vector = pd.Series(0.0, index=user_item_matrix.columns)
    matched = []
    for title, rating in user_ratings.items():
        matches = [c for c in user_item_matrix.columns
                   if title.lower() in c.lower()]
        for m in matches:
            new_user_vector[m] = float(rating)
            matched.append(m)

    if new_user_vector.sum() == 0:
        return []

    # Cosine similarity of this new profile against every known user
    from sklearn.metrics.pairwise import cosine_similarity as cos_sim
    new_vec = new_user_vector.values.reshape(1, -1)
    matrix_arr = user_item_matrix.values
    sims = cos_sim(new_vec, matrix_arr).flatten()

    top_indices = np.argsort(sims)[::-1][:5]
    similar_ratings = user_item_matrix.iloc[top_indices]
    avg_ratings = similar_ratings.mean()

    # Exclude movies the new user already rated
    avg_ratings = avg_ratings[new_user_vector == 0]
    top_movies = avg_ratings.sort_values(ascending=False).head(top_n)

    return [
        {"title": title, "predicted_rating": round(float(score), 4)}
        for title, score in top_movies.items()
    ]


def _enrich_movie_by_title(conn, title: str, tmdb_api_key: str | None = None) -> dict:
    """Try to find the movie in the `movies` table by title; if missing and
    TMDb API key is available, query TMDb and insert the movie record.

    Returns a dict with at least `title` and optional `tmdb_id`, `poster_url`,
    `overview`, `tmdb_rating`, and `tmdb_data`.
    """
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    # Try exact match first
    cur.execute("SELECT * FROM movies WHERE lower(title)=lower(%s) LIMIT 1", (title,))
    row = cur.fetchone()
    if row:
        return dict(row)

    # Fallback: partial match
    cur.execute("SELECT * FROM movies WHERE title ILIKE %s LIMIT 1", (f"%{title}%",))
    row = cur.fetchone()
    if row:
        return dict(row)

    # If not found, optionally call TMDb search API
    if not tmdb_api_key:
        return {"title": title}

    try:
        params = {"api_key": tmdb_api_key, "query": title}
        r = requests.get("https://api.themoviedb.org/3/search/movie", params=params, timeout=5)
        r.raise_for_status()
        data = r.json()
        results = data.get("results") or []
        if not results:
            return {"title": title}

        m = results[0]
        tmdb_id = m.get("id")
        poster_path = m.get("poster_path")
        poster_url = f"https://image.tmdb.org/t/p/w342{poster_path}" if poster_path else None

        # Insert into movies table (id = tmdb_id)
        cur.execute(
            "INSERT INTO movies (id, title, poster_url, overview, release_year, tmdb_rating, tmdb_data) VALUES (%s,%s,%s,%s,%s,%s,%s) ON CONFLICT (id) DO NOTHING",
            (
                tmdb_id,
                m.get("title"),
                poster_url,
                m.get("overview"),
                int(m.get("release_date", "0000-00-00")[:4]) if m.get("release_date") else None,
                float(m.get("vote_average")) if m.get("vote_average") is not None else None,
                json.dumps(m),
            ),
        )
        conn.commit()

        # Return enriched dict
        return {
            "title": m.get("title"),
            "tmdb_id": tmdb_id,
            "poster_url": poster_url,
            "overview": m.get("overview"),
            "tmdb_rating": m.get("vote_average"),
            "tmdb_data": m,
        }
    except Exception:
        conn.rollback()
        return {"title": title}


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.route("/health", methods=["GET"])
def health():
    """Liveness probe — always responds even if model is missing."""
    model_ok = os.path.exists(MODEL_PATH)
    return jsonify({
        "status": "ok",
        "model_loaded": model_ok,
        "model_path": MODEL_PATH,
    }), 200


# Serve OpenAPI spec and simple Swagger UI
@app.route('/openapi.yaml', methods=['GET'])
def openapi_yaml():
        try:
                return send_from_directory(os.path.dirname(__file__), 'openapi.yaml')
        except Exception:
                return jsonify({'error': 'OpenAPI file not found.'}), 404


@app.route('/docs', methods=['GET'])
def swagger_ui():
        # Minimal Swagger UI page using CDN
        html = '''
        <!doctype html>
        <html>
            <head>
                <title>API Docs</title>
                <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@4.18.2/swagger-ui.css" />
            </head>
            <body>
                <div id="swagger-ui"></div>
                <script src="https://unpkg.com/swagger-ui-dist@4.18.2/swagger-ui-bundle.js"></script>
                <script>
                    window.onload = function(){
                        const ui = SwaggerUIBundle({ url: '/openapi.yaml', dom_id: '#swagger-ui' });
                    };
                </script>
            </body>
        </html>
        '''
        return html, 200


# ── Users ──────────────────────────────────────────────────────────────────

@app.route("/api/users", methods=["GET"])
@_require_model
def list_users():
    """Return all known user IDs."""
    model = get_model()
    user_ids = model["user_item_matrix"].index.tolist()
    return jsonify({"count": len(user_ids), "user_ids": user_ids}), 200


# ── Movies ─────────────────────────────────────────────────────────────────

@app.route("/api/movies", methods=["GET"])
@_require_model
def list_movies():
    """Return all movie titles (paginated)."""
    model = get_model()
    titles = model["user_item_matrix"].columns.tolist()

    # Optional pagination
    page = request.args.get("page", 1, type=int)
    per_page = request.args.get("per_page", 100, type=int)
    per_page = min(per_page, 500)          # cap to avoid huge payloads

    start = (page - 1) * per_page
    end = start + per_page
    page_titles = titles[start:end]

    return jsonify({
        "page": page,
        "per_page": per_page,
        "total": len(titles),
        "movies": page_titles,
    }), 200


@app.route("/api/movie/<path:title>", methods=["GET"])
@_require_model
def search_movie(title: str):
    """Case-insensitive partial-title search."""
    model = get_model()
    all_titles = model["user_item_matrix"].columns.tolist()
    query = title.lower()
    results = [t for t in all_titles if query in t.lower()]

    if not results:
        return jsonify({"error": f"No movies found matching '{title}'"}), 404

    return jsonify({"query": title, "count": len(results), "results": results}), 200


# ── Recommendations ────────────────────────────────────────────────────────

@app.route("/api/recommend/<int:user_id>", methods=["GET"])
@_require_model
def recommend_for_user(user_id: int):
    """
    Top-N recommendations for an existing user.

    Query params
    ------------
    top_n        (int, default 10)  — number of movies to return
    exclude_seen (bool, default 1)  — skip movies the user already rated
    """
    model = get_model()
    user_item_matrix = model["user_item_matrix"]
    user_similarity = model["user_similarity"]

    if user_id not in user_item_matrix.index:
        return jsonify({
            "error": f"User {user_id} not found. Valid IDs: 1–610."
        }), 404

    top_n = request.args.get("top_n", 10, type=int)
    top_n = max(1, min(top_n, 50))
    exclude_seen = request.args.get("exclude_seen", "1") != "0"

    recommendations = generate_recommendations(
        user_id, user_similarity, user_item_matrix,
        top_n=top_n, exclude_seen=exclude_seen
    )

    return jsonify({
        "user_id": user_id,
        "top_n": top_n,
        "exclude_seen": exclude_seen,
        "recommendations": recommendations,
    }), 200


@app.route("/api/recommend/new-user", methods=["POST"])
@_require_model
def recommend_new_user():
    """
    Cold-start recommendations for a user not yet in the training set.

    Request body (JSON)
    -------------------
    {
        "ratings": {
            "Toy Story (1995)": 5.0,
            "Heat (1995)": 4.0
        },
        "top_n": 10
    }
    """
    body = request.get_json(silent=True)
    if not body or "ratings" not in body:
        return jsonify({
            "error": "Request body must be JSON with a 'ratings' key.",
            "example": {
                "ratings": {"Toy Story (1995)": 5.0, "Heat (1995)": 4.0},
                "top_n": 10,
            },
        }), 400

    user_ratings: dict = body["ratings"]
    if not isinstance(user_ratings, dict) or len(user_ratings) == 0:
        return jsonify({"error": "'ratings' must be a non-empty object."}), 400

    top_n = int(body.get("top_n", 10))
    top_n = max(1, min(top_n, 50))

    model = get_model()
    recommendations = cold_start_recommendations(
        user_ratings,
        model["user_similarity"],
        model["user_item_matrix"],
        top_n=top_n,
    )

    if not recommendations:
        return jsonify({
            "error": "None of the provided movie titles matched the dataset.",
            "hint": "Use /api/movie/<title> to search for the exact title format.",
        }), 404

    return jsonify({
        "type": "cold-start",
        "input_movies": list(user_ratings.keys()),
        "top_n": top_n,
        "recommendations": recommendations,
    }), 200


# ── Similar users ──────────────────────────────────────────────────────────

@app.route("/api/similar-users/<int:user_id>", methods=["GET"])
@_require_model
def similar_users(user_id: int):
    """
    Return the top-N users most similar to *user_id*.

    Query params
    ------------
    top_n  (int, default 5)
    """
    model = get_model()
    user_item_matrix = model["user_item_matrix"]
    user_similarity = model["user_similarity"]

    if user_id not in user_item_matrix.index:
        return jsonify({
            "error": f"User {user_id} not found. Valid IDs: 1–610."
        }), 404

    top_n = request.args.get("top_n", 5, type=int)
    top_n = max(1, min(top_n, 20))

    ids, scores = find_similar_users(user_id, user_similarity,
                                     user_item_matrix, top_n=top_n)
    result = [
        {"user_id": uid, "similarity_score": round(s, 6)}
        for uid, s in zip(ids, scores)
    ]

    return jsonify({
        "user_id": user_id,
        "top_n": top_n,
        "similar_users": result,
    }), 200


@app.route("/api/recompute/<int:user_id>", methods=["POST"])
@_require_model
def recompute_and_cache(user_id: int):
    """Trigger recomputation of recommendations for *user_id*, enrich with
    TMDb data when available, cache into `recommendations` table, and return
    the generated payload.
    """
    model = get_model()
    user_item_matrix = model["user_item_matrix"]
    user_similarity = model["user_similarity"]

    if user_id not in user_item_matrix.index:
        return jsonify({"error": f"User {user_id} not found."}), 404

    body = request.get_json(silent=True) or {}
    top_n = int(body.get("top_n", 10))
    top_n = max(1, min(top_n, 50))

    recommendations = generate_recommendations(
        user_id, user_similarity, user_item_matrix, top_n=top_n
    )

    # Try to cache into DB and enrich using movies table / TMDb if available
    tmdb_api_key = os.getenv("TMDB_API_KEY")
    payload = []
    try:
        conn = get_db_connection()
    except Exception as exc:
        # DB not available — return recommendations without caching
        logger.exception("DB connection failed while caching recommendations")
        return jsonify({"user_id": user_id, "recommendations": recommendations, "cached": False}), 200

    try:
        cur = conn.cursor()
        for rec in recommendations:
            title = rec.get("title")
            enriched = _enrich_movie_by_title(conn, title, tmdb_api_key)
            rec_record = {**rec, **enriched}
            payload.append(rec_record)

        # Insert into recommendations table
        cur.execute(
            "INSERT INTO recommendations (user_id, payload) VALUES (%s, %s) RETURNING id, generated_at",
            (user_id, psycopg2.extras.Json(payload)),
        )
        row = cur.fetchone()
        conn.commit()

        resp = {
            "user_id": user_id,
            "top_n": top_n,
            "cached": True,
            "recommendation_id": row[0] if row else None,
            "generated_at": row[1].isoformat() if row and row[1] else None,
            "recommendations": payload,
        }
        return jsonify(resp), 200
    except Exception:
        conn.rollback()
        logger.exception("Failed to cache recommendations")
        return jsonify({"user_id": user_id, "recommendations": recommendations, "cached": False}), 200
    finally:
        try:
            conn.close()
        except Exception:
            pass


# ── Ratings & Notifications ────────────────────────────────────────────────

@app.route("/api/ratings", methods=["POST"])
def submit_rating():
    """Write a movie rating to the database and trigger notification.
    
    Request body (JSON)
    -------------------
    {
        "user_id": 1,
        "movie_id": 123,
        "rating": 4.5
    }
    """
    body = request.get_json(silent=True)
    if not body or "user_id" not in body or "movie_id" not in body or "rating" not in body:
        return jsonify({"error": "user_id, movie_id, and rating are required"}), 400
    
    user_id = int(body["user_id"])
    movie_id = int(body["movie_id"])
    rating = float(body["rating"])
    
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        
        # Insert or update rating
        cur.execute(
            "INSERT INTO ratings (user_id, movie_id, rating) VALUES (%s, %s, %s) ON CONFLICT (user_id, movie_id) DO UPDATE SET rating = EXCLUDED.rating, created_at = NOW()",
            (user_id, movie_id, rating),
        )
        
        # Create notification event
        notification_payload = {"type": "rating", "user_id": user_id, "movie_id": movie_id, "rating": rating}
        cur.execute(
            "INSERT INTO notifications (user_id, type, payload) VALUES (%s, %s, %s)",
            (user_id, "rating", psycopg2.extras.Json(notification_payload)),
        )
        
        conn.commit()
        logger.info(f"Rating saved: user {user_id}, movie {movie_id}, rating {rating}")
        return jsonify({"ok": True, "user_id": user_id, "movie_id": movie_id}), 201
    except Exception as e:
        logger.exception(f"Failed to save rating: {e}")
        return jsonify({"error": "Failed to save rating"}), 500
    finally:
        try:
            conn.close()
        except Exception:
            pass


@app.route("/sse/notifications", methods=["GET"])
def sse_notifications():
    """Server-Sent Events endpoint for real-time notifications.
    
    Query params
    -----------
    user_id  (optional, int) — filter notifications by user
    """
    user_id = request.args.get("user_id", None)
    if user_id is not None:
        user_id = int(user_id)
    
    def event_stream():
        lastId = 0
        try:
            conn = get_db_connection()
        except Exception as e:
            logger.exception(f"SSE DB connection failed: {e}")
            yield f"data: {json.dumps({'error': 'DB connection failed'})}\n\n"
            return
        
        try:
            import time
            while True:
                cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
                
                if user_id:
                    query = "SELECT id, user_id, type, payload FROM notifications WHERE id > %s AND user_id = %s ORDER BY id ASC LIMIT 50"
                    cur.execute(query, (lastId, user_id))
                else:
                    query = "SELECT id, user_id, type, payload FROM notifications WHERE id > %s ORDER BY id ASC LIMIT 50"
                    cur.execute(query, (lastId,))
                
                rows = cur.fetchall()
                
                for row in rows:
                    data = dict(row)
                    lastId = data["id"]
                    cur.execute("UPDATE notifications SET delivered = TRUE WHERE id = %s", (lastId,))
                    yield f"data: {json.dumps(data)}\n\n"
                
                conn.commit()
                time.sleep(2)
        except Exception as e:
            logger.exception(f"SSE error: {e}")
        finally:
            try:
                conn.close()
            except Exception:
                pass
    
    return event_stream(), 200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
    }


# ---------------------------------------------------------------------------
# Error handlers
# ---------------------------------------------------------------------------

@app.errorhandler(404)
def not_found(e):
    return jsonify({"error": "Endpoint not found."}), 404


@app.errorhandler(405)
def method_not_allowed(e):
    return jsonify({"error": "Method not allowed."}), 405


@app.errorhandler(500)
def internal_error(e):
    logger.exception("Unhandled exception")
    return jsonify({"error": "Internal server error."}), 500


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    port = int(os.getenv("PORT", 5000))
    debug = os.getenv("FLASK_DEBUG", "1") == "1"
    logger.info("Starting Flask dev server on port %d (debug=%s)", port, debug)
    app.run(host="0.0.0.0", port=port, debug=debug)
