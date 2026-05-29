"""
seed_movies.py — Seed the movies table from MovieLens CSV + TMDb API
Usage:
    python scripts/seed_movies.py

Requires:  data/movies.csv, data/links.csv  (MovieLens-Small)
Env vars:  DATABASE_URL, TMDB_API_KEY  (from .env or shell)
"""

import os
import sys
import time

import pandas as pd
import psycopg2
import psycopg2.extras
import requests
from dotenv import load_dotenv

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", "flask-ml", ".env"))

TMDB_API_KEY = os.getenv("TMDB_API_KEY")
DATABASE_URL = os.getenv("DATABASE_URL")
TMDB_IMG     = "https://image.tmdb.org/t/p/w300"

MOVIES_CSV = os.getenv(
    "MOVIES_CSV",
    r"C:\Users\USER\Desktop\projects\Certificates for data analysis\ml-latest-small\ml-latest-small\movies.csv",
)
LINKS_CSV = os.getenv(
    "LINKS_CSV",
    r"C:\Users\USER\Desktop\projects\Certificates for data analysis\ml-latest-small\ml-latest-small\links.csv",
)

if not TMDB_API_KEY:
    sys.exit("ERROR: TMDB_API_KEY not set.")
if not DATABASE_URL:
    sys.exit("ERROR: DATABASE_URL not set.")


def fetch_tmdb(tmdb_id: int) -> dict | None:
    res = requests.get(
        f"https://api.themoviedb.org/3/movie/{tmdb_id}",
        params={"api_key": TMDB_API_KEY},
        timeout=5,
    )
    return res.json() if res.status_code == 200 else None


def main():
    print("Connecting to Azure PostgreSQL…")
    conn = psycopg2.connect(DATABASE_URL, sslmode="require")
    cur  = conn.cursor()

    print(f"Loading CSVs…\n  {MOVIES_CSV}\n  {LINKS_CSV}")
    movies_df = pd.read_csv(MOVIES_CSV)
    links_df  = pd.read_csv(LINKS_CSV)

    merged = movies_df.merge(links_df, on="movieId", how="inner")
    merged = merged.dropna(subset=["tmdbId"])
    merged["tmdbId"] = merged["tmdbId"].astype(int)
    total = len(merged)
    print(f"Seeding {total} movies…\n")

    ok = skipped = errors = 0

    for idx, row in merged.iterrows():
        movielens_id = int(row["movieId"])
        tmdb_id      = int(row["tmdbId"])

        data = fetch_tmdb(tmdb_id)
        if not data or data.get("success") is False:
            print(f"  [{idx+1}/{total}] SKIP  tmdbId={tmdb_id} — not found")
            skipped += 1
            time.sleep(0.1)
            continue

        title        = data.get("title", row["title"])
        genres       = [g["name"] for g in data.get("genres", [])]
        poster_url   = f"{TMDB_IMG}{data['poster_path']}" if data.get("poster_path") else None
        overview     = data.get("overview")
        release_year = int(data["release_date"][:4]) if data.get("release_date") else None
        tmdb_rating  = data.get("vote_average")

        try:
            cur.execute(
                """
                INSERT INTO movies
                    (id, movielens_id, title, genres, poster_url, overview,
                     release_year, tmdb_rating, tmdb_data)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO NOTHING
                """,
                (
                    tmdb_id, movielens_id, title, genres, poster_url,
                    overview, release_year, tmdb_rating,
                    psycopg2.extras.Json(data),
                ),
            )
            conn.commit()
            ok += 1
            if ok % 50 == 0:
                print(f"  [{idx+1}/{total}] {ok} inserted, {skipped} skipped, {errors} errors")
        except Exception as exc:
            conn.rollback()
            print(f"  [{idx+1}/{total}] ERROR tmdbId={tmdb_id}: {exc}")
            errors += 1

        # Respect TMDb rate limit (40 req / 10 s)
        time.sleep(0.26)

    cur.close()
    conn.close()
    print(f"\nDone! Inserted: {ok} | Skipped: {skipped} | Errors: {errors}")


if __name__ == "__main__":
    main()
