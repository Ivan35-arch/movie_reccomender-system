"""
Movie Recommender System — Flask ML API
---------------------------------------
Endpoints
---------
GET  /health
GET  /api/users
GET  /api/movies
GET  /api/recommend/<int:user_id>
POST /api/recommend/new-user          ← cold-start (raw titles)
POST /api/recommend                   ← called by Express: cold-start + TMDb enrichment + DB cache
GET  /api/similar-users/<int:user_id>
GET  /api/movie/<string:title>
"""

import os
import time
import logging
import requests
from functools import wraps

import numpy as np
import joblib
import psycopg2
import psycopg2.extras
from flask import Flask, jsonify, request
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

CORS(app, resources={r"/api/*": {"origins": "*"}, r"/health": {"origins": "*"}})

TMDB_API_KEY = os.getenv("TMDB_API_KEY")
TMDB_BASE    = "https://api.themoviedb.org/3"
TMDB_IMG     = "https://image.tmdb.org/t/p/w300"

# ---------------------------------------------------------------------------
# Model loading
# ---------------------------------------------------------------------------
MODEL_PATH = os.getenv("MODEL_PATH", "model/recommender_model.pkl")
_model_data: dict | None = None


def get_model() -> dict:
    global _model_data
    if _model_data is None:
        if not os.path.exists(MODEL_PATH):
            raise FileNotFoundError(
                f"Model file not found at '{MODEL_PATH}'. "
                "Run the notebook to generate 'recommender_model.pkl' first."
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
# Database connection — Azure PostgreSQL
# ---------------------------------------------------------------------------
def get_db_connection():
    """Return a new psycopg2 connection to Azure PostgreSQL."""
    database_url = os.getenv("DATABASE_URL")
    if database_url:
        return psycopg2.connect(database_url, sslmode="require")
    return psycopg2.connect(
        host=os.getenv("DB_HOST"),
        port=int(os.getenv("DB_PORT", 5432)),
        dbname=os.getenv("DB_NAME"),
        user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASSWORD"),
        sslmode=os.getenv("DB_SSLMODE", "require"),
    )


# ---------------------------------------------------------------------------
# TMDb helpers
# ---------------------------------------------------------------------------
def tmdb_search(title: str) -> dict | None:
    """Search TMDb for a movie title, return first result or None."""
    if not TMDB_API_KEY:
        return None
    clean = title.replace(r"\s*\(\d{4}\)\s*$", "").strip()
    try:
        res = requests.get(
            f"{TMDB_BASE}/search/movie",
            params={"api_key": TMDB_API_KEY, "query": clean},
            timeout=5,
        )
        if res.status_code == 200:
            results = res.json().get("results", [])
            return results[0] if results else None
    except Exception as exc:
        logger.warning("TMDb search failed for '%s': %s", title, exc)
    return None


def enrich_from_db(titles: list[str]) -> dict[str, dict]:
    """
    Lookup movie metadata from the movies table by title (fuzzy match).
    Returns {title: {poster_url, overview, release_year, tmdb_rating, genres, id}}.
    """
    enriched = {}
    try:
        conn = get_db_connection()
        cur  = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        for title in titles:
            clean = title.rsplit("(", 1)[0].strip()
            cur.execute(
                """SELECT id, title, poster_url, overview, release_year,
                          tmdb_rating, genres
                   FROM movies WHERE title ILIKE %s LIMIT 1""",
                (f"%{clean}%",),
            )
            row = cur.fetchone()
            if row:
                enriched[title] = dict(row)
        cur.close()
        conn.close()
    except Exception as exc:
        logger.warning("DB enrich failed: %s", exc)
    return enriched


def enrich_from_tmdb(title: str) -> dict:
    """Fallback: hit TMDb API directly when movie not in DB."""
    hit = tmdb_search(title)
    if not hit:
        return {}
    return {
        "id": hit.get("id"),
        "poster_url": f"{TMDB_IMG}{hit['poster_path']}" if hit.get("poster_path") else None,
        "overview": hit.get("overview"),
        "release_year": int(hit["release_date"][:4]) if hit.get("release_date") else None,
        "tmdb_rating": hit.get("vote_average"),
        "genres": [],
    }


# ---------------------------------------------------------------------------
# Helper utilities
# ---------------------------------------------------------------------------
def _require_model(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        try:
            get_model()
        except FileNotFoundError as exc:
            return jsonify({"error": str(exc)}), 503
        return f(*args, **kwargs)
    return wrapper


def find_similar_users(user_id, user_similarity, user_item_matrix, top_n=5):
    user_index    = user_item_matrix.index.get_loc(user_id)
    similarities  = user_similarity[user_index]
    similar_indices = np.argsort(similarities)[::-1][1: top_n + 1]
    similar_user_ids = user_item_matrix.index[similar_indices].tolist()
    similar_scores   = similarities[similar_indices].tolist()
    return similar_user_ids, similar_scores


def generate_recommendations(user_id, user_similarity, user_item_matrix,
                              top_n=10, exclude_seen=True):
    similar_user_ids, _ = find_similar_users(
        user_id, user_similarity, user_item_matrix, top_n=5
    )
    similar_ratings = user_item_matrix.loc[similar_user_ids]
    avg_ratings     = similar_ratings.mean()

    if exclude_seen:
        already_rated = user_item_matrix.loc[user_id]
        avg_ratings   = avg_ratings[already_rated == 0]

    top_movies = avg_ratings.sort_values(ascending=False).head(top_n)
    return [
        {"title": title, "predicted_rating": round(float(score), 4)}
        for title, score in top_movies.items()
    ]


def cold_start_recommendations(user_ratings, user_similarity,
                               user_item_matrix, top_n=10):
    import pandas as pd
    from sklearn.metrics.pairwise import cosine_similarity as cos_sim

    new_user_vector = pd.Series(0.0, index=user_item_matrix.columns)
    for title, rating in user_ratings.items():
        matches = [c for c in user_item_matrix.columns if title.lower() in c.lower()]
        for m in matches:
            new_user_vector[m] = float(rating)

    if new_user_vector.sum() == 0:
        return []

    new_vec    = new_user_vector.values.reshape(1, -1)
    sims       = cos_sim(new_vec, user_item_matrix.values).flatten()
    top_idx    = np.argsort(sims)[::-1][:5]
    avg_ratings = user_item_matrix.iloc[top_idx].mean()
    avg_ratings = avg_ratings[new_user_vector == 0]
    top_movies  = avg_ratings.sort_values(ascending=False).head(top_n)

    return [
        {"title": title, "predicted_rating": round(float(score), 4)}
        for title, score in top_movies.items()
    ]


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.route("/health", methods=["GET"])
def health():
    model_ok = os.path.exists(MODEL_PATH)
    db_ok    = False
    try:
        conn  = get_db_connection()
        conn.close()
        db_ok = True
    except Exception:
        pass
    return jsonify({
        "status": "ok",
        "model_loaded": model_ok,
        "db_connected": db_ok,
        "model_path": MODEL_PATH,
    }), 200


@app.route("/api/users", methods=["GET"])
@_require_model
def list_users():
    model    = get_model()
    user_ids = model["user_item_matrix"].index.tolist()
    return jsonify({"count": len(user_ids), "user_ids": user_ids}), 200


@app.route("/api/movies", methods=["GET"])
@_require_model
def list_movies():
    model   = get_model()
    titles  = model["user_item_matrix"].columns.tolist()
    page     = request.args.get("page", 1, type=int)
    per_page = min(request.args.get("per_page", 100, type=int), 500)
    start    = (page - 1) * per_page
    return jsonify({
        "page": page, "per_page": per_page,
        "total": len(titles), "movies": titles[start: start + per_page],
    }), 200


@app.route("/api/movie/<path:title>", methods=["GET"])
@_require_model
def search_movie(title):
    model   = get_model()
    query   = title.lower()
    results = [t for t in model["user_item_matrix"].columns.tolist() if query in t.lower()]
    if not results:
        return jsonify({"error": f"No movies found matching '{title}'"}), 404
    return jsonify({"query": title, "count": len(results), "results": results}), 200


@app.route("/api/recommend/<int:user_id>", methods=["GET"])
@_require_model
def recommend_for_user(user_id):
    model            = get_model()
    user_item_matrix = model["user_item_matrix"]
    user_similarity  = model["user_similarity"]

    if user_id not in user_item_matrix.index:
        return jsonify({"error": f"User {user_id} not found. Valid IDs: 1–610."}), 404

    top_n        = max(1, min(request.args.get("top_n", 10, type=int), 50))
    exclude_seen = request.args.get("exclude_seen", "1") != "0"

    recs = generate_recommendations(
        user_id, user_similarity, user_item_matrix,
        top_n=top_n, exclude_seen=exclude_seen
    )
    return jsonify({"user_id": user_id, "top_n": top_n,
                    "exclude_seen": exclude_seen, "recommendations": recs}), 200


@app.route("/api/recommend/new-user", methods=["POST"])
@_require_model
def recommend_new_user():
    body = request.get_json(silent=True)
    if not body or "ratings" not in body:
        return jsonify({"error": "Request body must be JSON with a 'ratings' key."}), 400

    user_ratings = body["ratings"]
    if not isinstance(user_ratings, dict) or not user_ratings:
        return jsonify({"error": "'ratings' must be a non-empty object."}), 400

    top_n = max(1, min(int(body.get("top_n", 10)), 50))
    model = get_model()
    recs  = cold_start_recommendations(
        user_ratings, model["user_similarity"], model["user_item_matrix"], top_n=top_n
    )
    if not recs:
        return jsonify({"error": "None of the provided movie titles matched the dataset."}), 404

    return jsonify({
        "type": "cold-start",
        "input_movies": list(user_ratings.keys()),
        "top_n": top_n,
        "recommendations": recs,
    }), 200


# ---------------------------------------------------------------------------
# NEW: POST /api/recommend  — called by Express after a user rates a movie
# Runs cold-start inference, enriches with TMDb, returns enriched results.
# ---------------------------------------------------------------------------
@app.route("/api/recommend", methods=["POST"])
@_require_model
def recommend_enriched():
    """
    Called by Express after a user submits a rating.

    Request body (JSON)
    -------------------
    {
        "user_ratings": {"Toy Story (1995)": 4.5, ...},
        "top_n": 10
    }

    Response
    --------
    {
        "recommendations": [
            {
                "title": "...", "predicted_rating": 0.9,
                "tmdb_id": 862, "poster_url": "...", "overview": "...",
                "release_year": 1995, "tmdb_rating": 7.9, "genres": [...]
            }, ...
        ]
    }
    """
    body = request.get_json(silent=True)
    if not body or "user_ratings" not in body:
        return jsonify({"error": "Request body must include 'user_ratings'."}), 400

    user_ratings = body["user_ratings"]
    if not isinstance(user_ratings, dict) or not user_ratings:
        return jsonify({"error": "'user_ratings' must be a non-empty object."}), 400

    top_n = max(1, min(int(body.get("top_n", 10)), 50))
    model = get_model()

    # 1. Run cold-start inference
    recs = cold_start_recommendations(
        user_ratings, model["user_similarity"], model["user_item_matrix"], top_n=top_n
    )
    if not recs:
        return jsonify({"recommendations": []}), 200

    # 2. Enrich from DB first (fast)
    titles    = [r["title"] for r in recs]
    db_data   = enrich_from_db(titles)

    enriched = []
    for rec in recs:
        title  = rec["title"]
        meta   = db_data.get(title)

        # 3. Fallback to live TMDb API if not in DB
        if not meta and TMDB_API_KEY:
            meta = enrich_from_tmdb(title)
            time.sleep(0.1)          # light rate-limit guard

        row = {
            "title":            title,
            "predicted_rating": rec["predicted_rating"],
            "tmdb_id":          meta.get("id")           if meta else None,
            "poster_url":       meta.get("poster_url")   if meta else None,
            "overview":         meta.get("overview")     if meta else None,
            "release_year":     meta.get("release_year") if meta else None,
            "tmdb_rating":      float(meta["tmdb_rating"]) if meta and meta.get("tmdb_rating") else None,
            "genres":           meta.get("genres", [])   if meta else [],
        }
        enriched.append(row)

    return jsonify({"recommendations": enriched}), 200


@app.route("/api/similar-users/<int:user_id>", methods=["GET"])
@_require_model
def similar_users(user_id):
    model            = get_model()
    user_item_matrix = model["user_item_matrix"]
    user_similarity  = model["user_similarity"]

    if user_id not in user_item_matrix.index:
        return jsonify({"error": f"User {user_id} not found. Valid IDs: 1–610."}), 404

    top_n     = max(1, min(request.args.get("top_n", 5, type=int), 20))
    ids, scores = find_similar_users(user_id, user_similarity, user_item_matrix, top_n=top_n)
    result    = [{"user_id": uid, "similarity_score": round(s, 6)} for uid, s in zip(ids, scores)]
    return jsonify({"user_id": user_id, "top_n": top_n, "similar_users": result}), 200


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
    port  = int(os.getenv("PORT", 5000))
    debug = os.getenv("FLASK_DEBUG", "1") == "1"
    logger.info("Starting Flask dev server on port %d (debug=%s)", port, debug)
    app.run(host="0.0.0.0", port=port, debug=debug)
