import express from 'express';
import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';

dotenv.config();
const router = express.Router();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// POST /api/ratings
// body: { user_id, movie_id, rating }
router.post('/ratings', async (req, res)=>{
  const { user_id, movie_id, rating } = req.body;
  if(!user_id || !movie_id || !rating) return res.status(400).json({ error:'user_id, movie_id and rating are required' });
  try{
    await pool.query('INSERT INTO ratings (user_id, movie_id, rating) VALUES ($1,$2,$3) ON CONFLICT (user_id,movie_id) DO UPDATE SET rating = EXCLUDED.rating, created_at = NOW()', [user_id, movie_id, rating]);

    // Call Flask recompute endpoint to regenerate recommendations
    const flask = process.env.FLASK_URL || 'http://flask:5000';
    try{
      // Use global fetch available in Node 18+
      await global.fetch(`${flask}/api/recompute/${user_id}`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ top_n: 10 }) });
    }catch(e){ console.warn('Flask recompute failed', e); }

    // create notification for SSE
    const payload = { type: 'rating', user_id, movie_id, rating };
    await pool.query('INSERT INTO notifications (user_id, type, payload) VALUES ($1,$2,$3)', [user_id, 'rating', payload]);

    res.json({ ok:true });
  }catch(err){console.error(err); res.status(500).json({ error:'DB error' })}
});

// GET /api/recommendations/latest?user_id=1
router.get('/recommendations/latest', async (req,res)=>{
  const user_id = parseInt(req.query.user_id || 1);
  try{
    const { rows } = await pool.query('SELECT id, generated_at, payload FROM recommendations WHERE user_id=$1 ORDER BY generated_at DESC LIMIT 1', [user_id]);
    if(rows.length===0) return res.status(404).json({ error:'No recs' });
    res.json({ id: rows[0].id, generated_at: rows[0].generated_at, payload: rows[0].payload });
  }catch(err){console.error(err); res.status(500).json({ error:'DB error' })}
});

// SSE: /sse/notifications?user_id=1
router.get('/sse/notifications', async (req, res)=>{
  const user_id = req.query.user_id ? parseInt(req.query.user_id) : null;
  res.setHeader('Content-Type','text/event-stream');
  res.setHeader('Cache-Control','no-cache');
  res.setHeader('Connection','keep-alive');
  res.flushHeaders?.();

  let lastId = 0;
  const sendNotifications = async ()=>{
    try{
      const q = user_id ? 'SELECT id, user_id, type, payload FROM notifications WHERE id > $1 AND (user_id=$2 OR user_id IS NULL) ORDER BY id ASC' : 'SELECT id, user_id, type, payload FROM notifications WHERE id > $1 ORDER BY id ASC';
      const params = user_id ? [lastId, user_id] : [lastId];
      const { rows } = await pool.query(q, params);
      for(const r of rows){
        const data = JSON.stringify(r.payload);
        res.write(`event: notification\ndata: ${data}\n\n`);
        lastId = r.id;
        // mark delivered
        await pool.query('UPDATE notifications SET delivered = TRUE WHERE id = $1', [r.id]);
      }
    }catch(err){ console.warn('SSE poll error', err); }
  };

  const interval = setInterval(sendNotifications, 2000);
  req.on('close', ()=>{ clearInterval(interval); res.end(); });
});

export default router;
