const router = require('express').Router();
const db     = require('../db');
const { auth } = require('./auth');

// ── GET /api/ratings ────────────────────────────────────
// Returns current user's ratings
router.get('/', auth, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT r.movielens_id, r.rating, r.rated_at,
              m.title, m.poster_url, m.genres
       FROM ratings r
       JOIN movies m ON m.movielens_id = r.movielens_id
       WHERE r.user_id = $1
       ORDER BY r.rated_at DESC`,
      [req.user.id]
    );
    res.json({ count: rows.length, ratings: rows });
  } catch (err) { next(err); }
});

// ── POST /api/ratings ───────────────────────────────────
// Add or update a rating. Invalidates recommendations cache.
router.post('/', auth, async (req, res, next) => {
  try {
    const { movielens_id, rating } = req.body;

    if (!movielens_id || rating == null) {
      return res.status(400).json({ error: 'movielens_id and rating are required.' });
    }
    if (rating < 0.5 || rating > 5.0) {
      return res.status(400).json({ error: 'rating must be between 0.5 and 5.0.' });
    }

    // Check movie exists
    const { rows: [movie] } = await db.query(
      'SELECT movielens_id, title FROM movies WHERE movielens_id = $1',
      [movielens_id]
    );
    if (!movie) return res.status(404).json({ error: 'Movie not found.' });

    // Upsert rating
    const { rows: [saved] } = await db.query(
      `INSERT INTO ratings (user_id, movielens_id, rating, rated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (user_id, movielens_id) DO UPDATE
         SET rating = EXCLUDED.rating, rated_at = NOW()
       RETURNING *`,
      [req.user.id, movielens_id, rating]
    );

    // Expire recommendations cache so next GET triggers a refresh
    await db.query(
      `UPDATE recommendations SET updated_at = '1970-01-01' WHERE user_id = $1`,
      [req.user.id]
    );

    res.status(201).json({ rating: saved, movie: movie.title });
  } catch (err) { next(err); }
});

// ── DELETE /api/ratings/:movielens_id ───────────────────
router.delete('/:movielens_id', auth, async (req, res, next) => {
  try {
    const { rowCount } = await db.query(
      'DELETE FROM ratings WHERE user_id = $1 AND movielens_id = $2',
      [req.user.id, parseInt(req.params.movielens_id)]
    );
    if (!rowCount) return res.status(404).json({ error: 'Rating not found.' });
    res.json({ message: 'Rating deleted.' });
  } catch (err) { next(err); }
});

module.exports = router;
