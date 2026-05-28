const router = require('express').Router();
const db     = require('../db');
const { auth } = require('./auth');

const FLASK_URL = process.env.FLASK_ML_URL || 'http://localhost:5000';

// ── GET /api/recommendations ────────────────────────────
// Returns cached recs from DB; triggers Flask refresh if stale (>1h)
router.get('/', auth, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT movie_ids, updated_at FROM recommendations WHERE user_id = $1`,
      [req.user.id]
    );

    const cached = rows[0];
    const isStale = !cached || (Date.now() - new Date(cached.updated_at).getTime()) > 3_600_000;

    // If stale, fire off a background refresh (don't block the response)
    if (isStale) {
      refreshRecsInBackground(req.user.id).catch((e) =>
        console.error('[Recs] Background refresh failed:', e.message)
      );
    }

    if (!cached || !cached.movie_ids?.length) {
      return res.json({
        source: 'none',
        message: 'No recommendations yet. They are being generated — check back shortly.',
        recommendations: [],
      });
    }

    // Fetch full movie details for cached movie_ids
    const { rows: movies } = await db.query(
      `SELECT id, title, genres, poster_url, overview, release_year, tmdb_rating
       FROM movies WHERE id = ANY($1)`,
      [cached.movie_ids]
    );

    res.json({
      source: isStale ? 'cache_refreshing' : 'cache',
      updated_at: cached.updated_at,
      count: movies.length,
      recommendations: movies,
    });
  } catch (err) { next(err); }
});

// ── POST /api/recommendations/refresh ──────────────────
// Manually trigger a fresh Flask ML call
router.post('/refresh', auth, async (req, res, next) => {
  try {
    const movieIds = await callFlaskML(req.user.id);
    res.json({
      message: 'Recommendations refreshed.',
      count: movieIds.length,
    });
  } catch (err) {
    res.status(502).json({
      error: 'Flask ML service unavailable.',
      detail: err.message,
    });
  }
});

// ── Helpers ─────────────────────────────────────────────
async function callFlaskML(userId) {
  const flaskRes = await fetch(`${FLASK_URL}/api/recommend/${userId}?top_n=20`);
  if (!flaskRes.ok) throw new Error(`Flask returned ${flaskRes.status}`);

  const data = await flaskRes.json();
  const recs  = data.recommendations || [];

  // Resolve movie titles → DB ids
  const titles = recs.map((r) => r.title);
  if (!titles.length) return [];

  const { rows } = await db.query(
    `SELECT id, title FROM movies WHERE title = ANY($1)`,
    [titles]
  );

  const movieIds = rows.map((r) => r.id);

  // Upsert into recommendations cache
  await db.query(
    `INSERT INTO recommendations (user_id, movie_ids, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (user_id) DO UPDATE
       SET movie_ids = EXCLUDED.movie_ids, updated_at = NOW()`,
    [userId, movieIds]
  );

  return movieIds;
}

async function refreshRecsInBackground(userId) {
  await callFlaskML(userId);
}

module.exports = router;
