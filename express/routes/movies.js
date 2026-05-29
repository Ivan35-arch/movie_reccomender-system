const router   = require('express').Router();
const { Pool } = require('pg');
const auth     = require('../middleware/auth');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// GET /api/movies  — paginated list from DB (falls back to empty if not seeded)
router.get('/', async (req, res) => {
  const page     = Math.max(1, parseInt(req.query.page  || '1',   10));
  const perPage  = Math.min(100, parseInt(req.query.per_page || '20', 10));
  const offset   = (page - 1) * perPage;
  const search   = req.query.q || '';

  try {
    const countQ = search
      ? `SELECT COUNT(*) FROM movies WHERE title ILIKE $1`
      : `SELECT COUNT(*) FROM movies`;
    const listQ  = search
      ? `SELECT id, movielens_id, title, genres, poster_url, release_year, tmdb_rating
           FROM movies WHERE title ILIKE $1 ORDER BY tmdb_rating DESC NULLS LAST
           LIMIT $2 OFFSET $3`
      : `SELECT id, movielens_id, title, genres, poster_url, release_year, tmdb_rating
           FROM movies ORDER BY tmdb_rating DESC NULLS LAST
           LIMIT $1 OFFSET $2`;

    const param = search ? [`%${search}%`] : [];
    const [countRes, listRes] = await Promise.all([
      pool.query(countQ, [...param]),
      pool.query(listQ,  [...param, perPage, offset]),
    ]);

    return res.json({
      page, per_page: perPage,
      total: parseInt(countRes.rows[0].count, 10),
      movies: listRes.rows,
    });
  } catch (err) {
    console.error('[movies]', err.message);
    return res.status(500).json({ error: 'Failed to fetch movies.' });
  }
});

// GET /api/movies/:id
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, movielens_id, title, genres, poster_url, overview,
              release_year, tmdb_rating FROM movies WHERE id = $1`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Movie not found.' });
    return res.json(rows[0]);
  } catch (err) {
    console.error('[movies/:id]', err.message);
    return res.status(500).json({ error: 'Failed to fetch movie.' });
  }
});

module.exports = router;
