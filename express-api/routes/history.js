const router = require('express').Router();
const db     = require('../db');
const { auth } = require('./auth');

// ── GET /api/history ────────────────────────────────────
router.get('/', auth, async (req, res, next) => {
  try {
    const page    = Math.max(1, parseInt(req.query.page || '1'));
    const perPage = Math.min(50, parseInt(req.query.per_page || '20'));
    const offset  = (page - 1) * perPage;

    const { rows } = await db.query(
      `SELECT h.watched_at,
              m.id, m.title, m.genres, m.poster_url,
              m.release_year, m.tmdb_rating
       FROM watch_history h
       JOIN movies m ON m.id = h.movie_id
       WHERE h.user_id = $1
       ORDER BY h.watched_at DESC
       LIMIT $2 OFFSET $3`,
      [req.user.id, perPage, offset]
    );

    const { rows: [{ count }] } = await db.query(
      'SELECT COUNT(*) FROM watch_history WHERE user_id = $1',
      [req.user.id]
    );

    res.json({
      page,
      per_page: perPage,
      total: parseInt(count),
      history: rows,
    });
  } catch (err) { next(err); }
});

// ── POST /api/history ───────────────────────────────────
// Mark a movie as watched
router.post('/', auth, async (req, res, next) => {
  try {
    const { movie_id } = req.body;
    if (!movie_id) return res.status(400).json({ error: 'movie_id is required.' });

    const { rows: [movie] } = await db.query(
      'SELECT id, title FROM movies WHERE id = $1',
      [movie_id]
    );
    if (!movie) return res.status(404).json({ error: 'Movie not found.' });

    await db.query(
      `INSERT INTO watch_history (user_id, movie_id, watched_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id, movie_id) DO UPDATE SET watched_at = NOW()`,
      [req.user.id, movie_id]
    );

    // Also remove from watchlist if present
    await db.query(
      'DELETE FROM watchlist WHERE user_id = $1 AND movie_id = $2',
      [req.user.id, movie_id]
    );

    res.status(201).json({ message: `"${movie.title}" added to watch history.` });
  } catch (err) { next(err); }
});

// ── DELETE /api/history/:movie_id ───────────────────────
router.delete('/:movie_id', auth, async (req, res, next) => {
  try {
    const { rowCount } = await db.query(
      'DELETE FROM watch_history WHERE user_id = $1 AND movie_id = $2',
      [req.user.id, parseInt(req.params.movie_id)]
    );
    if (!rowCount) return res.status(404).json({ error: 'Entry not found in history.' });
    res.json({ message: 'Removed from history.' });
  } catch (err) { next(err); }
});

module.exports = router;
