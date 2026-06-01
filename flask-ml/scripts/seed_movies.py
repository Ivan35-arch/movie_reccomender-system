#!/usr/bin/env python3
"""
Seed movies into PostgreSQL by merging MovieLens CSVs with TMDb metadata.

Usage:
  - Set `DATABASE_URL` or PostgreSQL env vars (`DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`).
  - Set `TMDB_API_KEY` in your environment (do NOT commit it to source control).
  - Provide paths to `movies.csv` and `links.csv` either via args or edit defaults below.

Example:
  TMDB_API_KEY=xxx DATABASE_URL=postgres://... python scripts/seed_movies.py \
    --movies "C:/path/ml/movies.csv" --links "C:/path/ml/links.csv"

This script is conservative and uses ON CONFLICT DO NOTHING for existing movies.
"""
import os
import time
import argparse
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
import psycopg2
import psycopg2.extras
import psycopg2.errors
import psycopg2.extensions
import pandas as pd
import socket


def get_conn():
    # Prefer DATABASE_URL if provided
    database_url = os.getenv("DATABASE_URL")
    if database_url:
        return psycopg2.connect(database_url, sslmode=os.getenv("DB_SSLMODE", "require"))

    # Fallback to individual vars
    return psycopg2.connect(
        host=os.getenv("DB_HOST"),
        port=int(os.getenv("DB_PORT", 5432)),
        dbname=os.getenv("DB_NAME"),
        user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASSWORD"),
        sslmode=os.getenv("DB_SSLMODE", "require"),
    )


def seed(movies_csv, links_csv, tmdb_api_key, pause=0.25, limit: int | None = None):
    # Prepare HTTP session with retries for transient network errors
    session = requests.Session()
    retries = Retry(total=5, backoff_factor=0.5,
                    status_forcelist=(429, 500, 502, 503, 504),
                    allowed_methods=('GET',))
    adapter = HTTPAdapter(max_retries=retries)
    session.mount('https://', adapter)
    session.params = {"api_key": tmdb_api_key}

    movies_df = pd.read_csv(movies_csv)
    links_df = pd.read_csv(links_csv)

    merged = movies_df.merge(links_df, left_on='movieId', right_on='movieId', how='inner')
    merged = merged.dropna(subset=['tmdbId'])
    merged['tmdbId'] = merged['tmdbId'].astype(int)

    total = len(merged)
    print(f"Seeding up to {total} movies (will skip missing TMDb results)")

    insert_sql = '''
        INSERT INTO movies (id, movielens_id, title, genres, poster_url, overview, release_year, tmdb_rating, tmdb_data)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (id) DO NOTHING
    '''

    # Establish DB connection (helper will be used to reconnect when needed)
    conn = get_conn()
    cur = conn.cursor()

    inserted_count = 0
    for idx, row in merged.iterrows():
        tmdb_id = int(row['tmdbId'])

        # Fetch TMDb with request-level retries
        try:
            res = session.get(f"https://api.themoviedb.org/3/movie/{tmdb_id}", timeout=10)
        except (requests.RequestException, socket.gaierror) as e:
            print(f"Request error for TMDb id {tmdb_id}: {e}")
            time.sleep(pause)
            continue

        if res.status_code != 200:
            print(f"Skipping tmdbId {tmdb_id} — status {res.status_code}")
            time.sleep(pause)
            continue

        data = res.json()
        title = data.get('title') or row.get('title')
        genres = [g['name'] for g in data.get('genres', [])]
        poster_url = f"https://image.tmdb.org/t/p/w300{data['poster_path']}" if data.get('poster_path') else None
        overview = data.get('overview')
        release_year = None
        if data.get('release_date'):
            try:
                release_year = int(data['release_date'][:4])
            except Exception:
                release_year = None
        tmdb_rating = data.get('vote_average')

        # Try inserting; if DB connection drops, reconnect and retry a few times
        attempts = 0
        max_attempts = 5
        while attempts < max_attempts:
            try:
                cur.execute(insert_sql, (
                    tmdb_id,
                    int(row['movieId']),
                    title,
                    genres,
                    poster_url,
                    overview,
                    release_year,
                    tmdb_rating,
                    psycopg2.extras.Json(data),
                ))
                conn.commit()
                if cur.rowcount > 0:
                    inserted_count += 1
                    print(f"Inserted TMDb {tmdb_id}: {title}")
                else:
                    print(f"TMDb {tmdb_id} already exists; skipped")
                break
            except (psycopg2.OperationalError, psycopg2.InterfaceError) as e:
                print(f"DB connection error during insert of {tmdb_id}: {e} — attempting reconnect ({attempts+1}/{max_attempts})")
                attempts += 1
                try:
                    conn.close()
                except Exception:
                    pass
                time.sleep(2 ** attempts)
                try:
                    conn = get_conn()
                    cur = conn.cursor()
                except Exception as e2:
                    print(f"Reconnect attempt failed: {e2}")
                    continue
            except Exception as e:
                # Non-connection DB error for this row — log and move on
                try:
                    conn.rollback()
                except Exception:
                    pass
                print(f"DB error inserting {tmdb_id}: {e}")
                break

        time.sleep(pause)

        if limit is not None and inserted_count >= limit:
            print(f"Reached user-specified limit of {limit}; stopping early.")
            break

    try:
        cur.close()
        conn.close()
    except Exception:
        pass

    print("Seeding complete.")


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--movies', required=False,
                   default=r"C:\Users\USER\Desktop\projects\Certificates for data analysis\ml-latest-small\ml-latest-small\movies.csv",
                   help='Path to MovieLens movies.csv')
    p.add_argument('--links', required=False,
                   default=r"C:\Users\USER\Desktop\projects\Certificates for data analysis\ml-latest-small\ml-latest-small\links.csv",
                   help='Path to MovieLens links.csv')
    p.add_argument('--pause', required=False, type=float, default=0.25,
                   help='Pause between TMDb requests (seconds)')
    p.add_argument('--limit', required=False, type=int, default=None,
                   help='Optional: stop after inserting this many new movies')
    args = p.parse_args()

    tmdb_key = os.getenv('TMDB_API_KEY')
    if not tmdb_key:
        print("Error: TMDB_API_KEY not set in environment.")
        return

    seed(args.movies, args.links, tmdb_key, pause=args.pause, limit=args.limit)


if __name__ == '__main__':
    main()
