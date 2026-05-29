const router   = require('express').Router();
const { Pool } = require('pg');
const auth     = require('../middleware/auth');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// GET /api/watchlist
router.get('/', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT w.id, w.added_at,
              m.id AS movie_id, m.title, m.poster_url,
              m.release_year, m.tmdb_rating, m.genres
         FROM watchlist w
         JOIN movies    m ON m.id = w.movie_id
        WHERE w.user_id = $1
        ORDER BY w.added_at DESC`,
      [req.user.id]
    );
    return res.json({ watchlist: rows });
  } catch (err) {
    console.error('[watchlist/GET]', err.message);
    return res.status(500).json({ error: 'Failed to fetch watchlist.' });
  }
});

// POST /api/watchlist
router.post('/', auth, async (req, res) => {
  const { movie_id } = req.body || {};
  if (!movie_id) return res.status(400).json({ error: 'movie_id is required.' });

  try {
    await pool.query(
      `INSERT INTO watchlist (user_id, movie_id) VALUES ($1, $2)
       ON CONFLICT (user_id, movie_id) DO NOTHING`,
      [req.user.id, movie_id]
    );
    return res.status(201).json({ ok: true });
  } catch (err) {
    console.error('[watchlist/POST]', err.message);
    return res.status(500).json({ error: 'Failed to add to watchlist.' });
  }
});

// DELETE /api/watchlist/:movie_id
router.delete('/:movie_id', auth, async (req, res) => {
  try {
    await pool.query(
      `DELETE FROM watchlist WHERE user_id = $1 AND movie_id = $2`,
      [req.user.id, req.params.movie_id]
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error('[watchlist/DELETE]', err.message);
    return res.status(500).json({ error: 'Failed to remove from watchlist.' });
  }
});

module.exports = router;
