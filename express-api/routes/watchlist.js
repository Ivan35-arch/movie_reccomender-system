const router = require('express').Router();
const db     = require('../db');
const { auth } = require('./auth');

// ── GET /api/watchlist ──────────────────────────────────
router.get('/', auth, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT w.added_at,
              m.id, m.title, m.genres, m.poster_url,
              m.overview, m.release_year, m.tmdb_rating
       FROM watchlist w
       JOIN movies m ON m.id = w.movie_id
       WHERE w.user_id = $1
       ORDER BY w.added_at DESC`,
      [req.user.id]
    );
    res.json({ count: rows.length, watchlist: rows });
  } catch (err) { next(err); }
});

// ── POST /api/watchlist ─────────────────────────────────
router.post('/', auth, async (req, res, next) => {
  try {
    const { movie_id } = req.body;
    if (!movie_id) return res.status(400).json({ error: 'movie_id is required.' });

    // Verify movie exists
    const { rows: [movie] } = await db.query(
      'SELECT id, title FROM movies WHERE id = $1',
      [movie_id]
    );
    if (!movie) return res.status(404).json({ error: 'Movie not found.' });

    await db.query(
      `INSERT INTO watchlist (user_id, movie_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [req.user.id, movie_id]
    );

    res.status(201).json({ message: `"${movie.title}" added to watchlist.` });
  } catch (err) { next(err); }
});

// ── DELETE /api/watchlist/:movie_id ────────────────────
router.delete('/:movie_id', auth, async (req, res, next) => {
  try {
    const { rowCount } = await db.query(
      'DELETE FROM watchlist WHERE user_id = $1 AND movie_id = $2',
      [req.user.id, parseInt(req.params.movie_id)]
    );
    if (!rowCount) return res.status(404).json({ error: 'Item not in watchlist.' });
    res.json({ message: 'Removed from watchlist.' });
  } catch (err) { next(err); }
});

// ── GET /api/watchlist/check/:movie_id ─────────────────
router.get('/check/:movie_id', auth, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      'SELECT 1 FROM watchlist WHERE user_id = $1 AND movie_id = $2',
      [req.user.id, parseInt(req.params.movie_id)]
    );
    res.json({ in_watchlist: rows.length > 0 });
  } catch (err) { next(err); }
});

module.exports = router;
