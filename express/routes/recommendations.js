const router   = require('express').Router();
const { Pool } = require('pg');
const auth     = require('../middleware/auth');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// GET /api/recommendations — cached recs for the logged-in user
router.get('/', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT r.rank, r.predicted_rating, r.generated_at,
              m.id AS movie_id, m.title, m.poster_url, m.overview,
              m.release_year, m.tmdb_rating, m.genres
         FROM recommendations r
         JOIN movies           m ON m.id = r.movie_id
        WHERE r.user_id = $1
        ORDER BY r.rank ASC
        LIMIT 50`,
      [req.user.id]
    );
    return res.json({ recommendations: rows });
  } catch (err) {
    console.error('[recommendations]', err.message);
    return res.status(500).json({ error: 'Failed to fetch recommendations.' });
  }
});

module.exports = router;
