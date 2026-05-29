/**
 * POST /api/ratings
 * Core flow:
 *   1. Write rating to DB
 *   2. Fetch ALL user ratings (title + score)
 *   3. Call Flask POST /api/recommend (cold-start + TMDb enrichment)
 *   4. Cache results in recommendations table
 *   5. Write notification (picked up by SSE stream)
 *
 * GET /api/ratings — return user's rating history
 */

const router   = require('express').Router();
const { Pool } = require('pg');
const fetch    = require('node-fetch');
const auth     = require('../middleware/auth');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const FLASK_URL = process.env.FLASK_URL || 'http://localhost:5000';

// ── POST /api/ratings ──────────────────────────────────────
router.post('/', auth, async (req, res) => {
  const { movie_id, rating } = req.body || {};
  const user_id = req.user.id;

  if (!movie_id || rating === undefined)
    return res.status(400).json({ error: 'movie_id and rating are required.' });
  if (rating < 0.5 || rating > 5.0)
    return res.status(400).json({ error: 'rating must be between 0.5 and 5.0.' });

  const client = await pool.connect();
  try {
    // 1. Upsert rating
    await client.query(
      `INSERT INTO ratings (user_id, movie_id, rating)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, movie_id) DO UPDATE SET rating = $3, created_at = NOW()`,
      [user_id, movie_id, rating]
    );

    // 2. Fetch ALL user ratings with movie titles for Flask
    const { rows: ratingRows } = await client.query(
      `SELECT m.title, r.rating
         FROM ratings r
         JOIN movies  m ON m.id = r.movie_id
        WHERE r.user_id = $1`,
      [user_id]
    );

    // Respond immediately — don't make the client wait for Flask
    res.json({ message: 'Rating saved. Generating recommendations…', movie_id, rating });

    // ── Background: call Flask → cache → notify ──────────
    if (ratingRows.length === 0) return;

    const userRatings = {};
    ratingRows.forEach(r => { userRatings[r.title] = parseFloat(r.rating); });

    let flaskRecs = [];
    try {
      const flaskRes = await fetch(`${FLASK_URL}/api/recommend`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ user_ratings: userRatings, top_n: 10 }),
      });

      if (flaskRes.ok) {
        const data = await flaskRes.json();
        flaskRecs  = data.recommendations || [];
      } else {
        console.error('[ratings] Flask returned', flaskRes.status);
      }
    } catch (flaskErr) {
      console.error('[ratings] Flask call failed:', flaskErr.message);
    }

    if (flaskRecs.length === 0) return;

    // 4. Cache in recommendations table
    for (let i = 0; i < flaskRecs.length; i++) {
      const rec = flaskRecs[i];
      if (!rec.tmdb_id) continue;

      // Ensure movie exists in DB (it may not be seeded yet — insert stub)
      await client.query(
        `INSERT INTO movies (id, title, poster_url, overview, release_year, tmdb_rating, genres)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO NOTHING`,
        [
          rec.tmdb_id, rec.title, rec.poster_url, rec.overview,
          rec.release_year, rec.tmdb_rating,
          rec.genres || [],
        ]
      );

      await client.query(
        `INSERT INTO recommendations (user_id, movie_id, predicted_rating, rank)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, movie_id)
         DO UPDATE SET predicted_rating = $3, rank = $4, generated_at = NOW()`,
        [user_id, rec.tmdb_id, rec.predicted_rating, i + 1]
      );
    }

    // 5. Write notification
    await client.query(
      `INSERT INTO notifications (user_id, message, type)
       VALUES ($1, $2, 'recommendation')`,
      [user_id, `✨ ${flaskRecs.length} new recommendations are ready for you!`]
    );

    console.log(`[ratings] Recommendations cached for user ${user_id} (${flaskRecs.length} items)`);
  } catch (err) {
    console.error('[ratings] Error:', err.message);
    if (!res.headersSent)
      res.status(500).json({ error: 'Failed to save rating.' });
  } finally {
    client.release();
  }
});

// ── GET /api/ratings ───────────────────────────────────────
router.get('/', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT r.id, r.movie_id, r.rating, r.created_at,
              m.title, m.poster_url, m.genres, m.release_year, m.tmdb_rating
         FROM ratings r
         JOIN movies  m ON m.id = r.movie_id
        WHERE r.user_id = $1
        ORDER BY r.created_at DESC`,
      [req.user.id]
    );
    return res.json({ ratings: rows });
  } catch (err) {
    console.error('[ratings/GET]', err.message);
    return res.status(500).json({ error: 'Failed to fetch ratings.' });
  }
});

module.exports = router;
