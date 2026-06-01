import express from 'express';
const router = express.Router();
import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';
dotenv.config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// GET /api/movies?page=1&per_page=20
router.get('/movies', async (req, res)=>{
  const page = parseInt(req.query.page || 1);
  const per_page = Math.min(parseInt(req.query.per_page || 20), 200);
  const offset = (page-1)*per_page;
  try{
    const { rows } = await pool.query('SELECT id, movielens_id, title, poster_url, overview, release_year FROM movies ORDER BY title LIMIT $1 OFFSET $2', [per_page, offset]);
    res.json({ page, per_page, movies: rows });
  }catch(err){
    console.error(err); res.status(500).json({ error: 'DB error' });
  }
});

// GET /api/movie/:title
router.get('/movie/:title', async (req, res)=>{
  const title = req.params.title;
  try{
    const { rows } = await pool.query('SELECT id, movielens_id, title, poster_url, overview, release_year FROM movies WHERE title ILIKE $1 LIMIT 50', [`%${title}%`]);
    if(rows.length===0) return res.status(404).json({ error:'No movies found', results: [] });
    res.json({ query: title, count: rows.length, results: rows });
  }catch(err){console.error(err); res.status(500).json({ error: 'DB error' })}
});

export default router;
