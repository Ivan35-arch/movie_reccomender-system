-- ══════════════════════════════════════════════════════════
-- Seive Movie Recommender — Database Init
-- Run against: movie_db
-- ══════════════════════════════════════════════════════════

-- 1. Users
CREATE TABLE IF NOT EXISTS users (
    id            SERIAL PRIMARY KEY,
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    username      TEXT UNIQUE,
    created_at    TIMESTAMP DEFAULT NOW()
);

-- 2. Movies (merged MovieLens + TMDb)
CREATE TABLE IF NOT EXISTS movies (
    id           INTEGER PRIMARY KEY,   -- TMDb ID
    movielens_id INTEGER UNIQUE,        -- MovieLens movieId
    title        TEXT NOT NULL,
    genres       TEXT[],
    poster_url   TEXT,
    overview     TEXT,
    release_year INTEGER,
    tmdb_rating  NUMERIC(3,1),
    tmdb_data    JSONB,
    created_at   TIMESTAMP DEFAULT NOW()
);

-- 3. Ratings (training data + live user ratings)
CREATE TABLE IF NOT EXISTS ratings (
    user_id      INTEGER REFERENCES users(id) ON DELETE CASCADE,
    movielens_id INTEGER REFERENCES movies(movielens_id) ON DELETE CASCADE,
    rating       NUMERIC(2,1) CHECK (rating >= 0.5 AND rating <= 5.0),
    rated_at     TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY  (user_id, movielens_id)
);

-- 4. Recommendations (cached by Flask ML)
CREATE TABLE IF NOT EXISTS recommendations (
    user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    movie_ids  INTEGER[],
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 5. Watchlist
CREATE TABLE IF NOT EXISTS watchlist (
    user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
    movie_id   INTEGER REFERENCES movies(id) ON DELETE CASCADE,
    added_at   TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (user_id, movie_id)
);

-- 6. Watch History
CREATE TABLE IF NOT EXISTS watch_history (
    user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
    movie_id   INTEGER REFERENCES movies(id) ON DELETE CASCADE,
    watched_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (user_id, movie_id)
);

-- 7. Notifications (in-app, no external service required)
CREATE TABLE IF NOT EXISTS notifications (
    id         SERIAL PRIMARY KEY,
    user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
    type       TEXT NOT NULL,           -- e.g. 'new_recs', 'rating_reminder'
    message    TEXT NOT NULL,
    read       BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW()
);

-- ── Indexes for common queries ─────────────────────────────
CREATE INDEX IF NOT EXISTS idx_ratings_user       ON ratings(user_id);
CREATE INDEX IF NOT EXISTS idx_watchlist_user     ON watchlist(user_id);
CREATE INDEX IF NOT EXISTS idx_history_user       ON watch_history(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_movies_title       ON movies USING GIN (to_tsvector('english', title));
