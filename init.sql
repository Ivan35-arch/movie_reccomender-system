-- ============================================================
-- Movie Recommender — Azure PostgreSQL schema
-- Run: psql $DATABASE_URL -f init.sql
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── Users ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username      VARCHAR(50)  UNIQUE NOT NULL,
    email         VARCHAR(255) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    TIMESTAMP DEFAULT NOW()
);

-- ── Movies (seeded from TMDb + MovieLens) ──────────────────
CREATE TABLE IF NOT EXISTS movies (
    id            INTEGER PRIMARY KEY,       -- TMDb movie ID
    movielens_id  INTEGER UNIQUE,            -- MovieLens movieId
    title         TEXT NOT NULL,
    genres        TEXT[],
    poster_url    TEXT,
    overview      TEXT,
    release_year  INTEGER,
    tmdb_rating   NUMERIC(3,1),
    tmdb_data     JSONB,
    created_at    TIMESTAMP DEFAULT NOW()
);

-- ── Ratings ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ratings (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id    UUID    NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
    movie_id   INTEGER NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
    rating     NUMERIC(3,1) NOT NULL CHECK (rating >= 0.5 AND rating <= 5.0),
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE (user_id, movie_id)
);

-- ── Recommendations (cached from Flask) ───────────────────
CREATE TABLE IF NOT EXISTS recommendations (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id          UUID    NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
    movie_id         INTEGER NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
    predicted_rating NUMERIC(6,4),
    rank             INTEGER,
    generated_at     TIMESTAMP DEFAULT NOW(),
    UNIQUE (user_id, movie_id)
);

-- ── Notifications ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message    TEXT NOT NULL,
    type       VARCHAR(50) DEFAULT 'recommendation',
    read       BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW()
);

-- ── Watchlist ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS watchlist (
    id       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id  UUID    NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
    movie_id INTEGER NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
    added_at TIMESTAMP DEFAULT NOW(),
    UNIQUE (user_id, movie_id)
);

-- ── Watch history ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS watch_history (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id    UUID    NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
    movie_id   INTEGER NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
    watched_at TIMESTAMP DEFAULT NOW()
);

-- ── Indexes ────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_ratings_user_id          ON ratings(user_id);
CREATE INDEX IF NOT EXISTS idx_ratings_movie_id         ON ratings(movie_id);
CREATE INDEX IF NOT EXISTS idx_recommendations_user_id  ON recommendations(user_id);
CREATE INDEX IF NOT EXISTS idx_recommendations_rank     ON recommendations(user_id, rank);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id    ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_unread     ON notifications(user_id, read) WHERE read = FALSE;
CREATE INDEX IF NOT EXISTS idx_watchlist_user_id        ON watchlist(user_id);
CREATE INDEX IF NOT EXISTS idx_movies_title             ON movies USING gin(to_tsvector('english', title));
