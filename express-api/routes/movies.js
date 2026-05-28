const router = require('express').Router();
const db     = require('../db');
const { auth } = require('./auth');

// ── GET /api/movies ─────────────────────────────────────
// Query params: page, per_page, genre, year, search
router.get('/', async (req, res, next) => {
  try {
    const page     = Math.max(1, parseInt(req.query.page || '1'));
    const perPage  = Math.min(100, parseInt(req.query.per_page || '20'));
    const offset   = (page - 1) * perPage;
    const { genre, year, search } = req.query;

    const conditions = [];
    const params     = [];

    if (search) {
      params.push(`%${search}%`);
      conditions.push(`title ILIKE $${params.length}`);
    }
    if (genre) {
      params.push(genre);
      conditions.push(`$${params.length} = ANY(genres)`);
    }
    if (year) {
      params.push(parseInt(year));
      conditions.push(`release_year = $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    // Total count
    const countRes = await db.query(
      `SELECT COUNT(*) FROM movies ${where}`,
      params
    );
    const total = parseInt(countRes.rows[0].count);

    // Data
    params.push(perPage, offset);
    const { rows } = await db.query(
      `SELECT id, movielens_id, title, genres, poster_url,
              overview, release_year, tmdb_rating
       FROM movies ${where}
       ORDER BY release_year DESC NULLS LAST, title ASC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({
      page,
      per_page: perPage,
      total,
      total_pages: Math.ceil(total / perPage),
      movies: rows,
    });
  } catch (err) { next(err); }
});

// ── GET /api/movies/:id ─────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT id, movielens_id, title, genres, poster_url,
              overview, release_year, tmdb_rating, tmdb_data, created_at
       FROM movies WHERE id = $1`,
      [parseInt(req.params.id)]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Movie not found.' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// ── GET /api/movies/:id/similar ─────────────────────────
// Returns movies sharing at least one genre, ordered by tmdb_rating
router.get('/:id/similar', async (req, res, next) => {
  try {
    const { rows: [movie] } = await db.query(
      'SELECT genres FROM movies WHERE id = $1',
      [parseInt(req.params.id)]
    );
    if (!movie) return res.status(404).json({ error: 'Movie not found.' });

    const limit = Math.min(20, parseInt(req.query.limit || '10'));

    const { rows } = await db.query(
      `SELECT id, movielens_id, title, genres, poster_url, release_year, tmdb_rating
       FROM movies
       WHERE id != $1
         AND genres && $2
       ORDER BY tmdb_rating DESC NULLS LAST
       LIMIT $3`,
      [parseInt(req.params.id), movie.genres, limit]
    );

    res.json({ count: rows.length, movies: rows });
  } catch (err) { next(err); }
});

module.exports = router;
