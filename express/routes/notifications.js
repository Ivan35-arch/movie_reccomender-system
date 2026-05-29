/**
 * GET /api/notifications/stream  — Server-Sent Events
 * GET /api/notifications          — list (paginated)
 * PATCH /api/notifications/:id/read
 */

const router   = require('express').Router();
const { Pool } = require('pg');
const jwt      = require('jsonwebtoken');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ── SSE stream ─────────────────────────────────────────────
// EventSource can't send headers, so we accept token via query param.
router.get('/stream', async (req, res) => {
  const token = req.query.token;
  if (!token) return res.status(401).json({ error: 'No token provided.' });

  let user;
  try {
    user = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Invalid token.' });
  }

  // SSE headers
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');   // disable Nginx buffering
  res.flushHeaders();

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  // Track last seen notification time per connection
  let lastChecked = new Date().toISOString();

  // Send a keep-alive comment every 20 s
  const keepAlive = setInterval(() => res.write(': ping\n\n'), 20_000);

  // Poll the notifications table every 3 s for new rows
  const poll = setInterval(async () => {
    try {
      const { rows } = await pool.query(
        `SELECT id, message, type, created_at
           FROM notifications
          WHERE user_id = $1 AND read = FALSE AND created_at > $2
          ORDER BY created_at ASC`,
        [user.id, lastChecked]
      );
      if (rows.length > 0) {
        lastChecked = rows[rows.length - 1].created_at;
        rows.forEach(n => send({ type: n.type, message: n.message, id: n.id }));
      }
    } catch (err) {
      console.error('[SSE poll]', err.message);
    }
  }, 3_000);

  // Cleanup on disconnect
  req.on('close', () => {
    clearInterval(keepAlive);
    clearInterval(poll);
  });
});

// ── GET /api/notifications ─────────────────────────────────
const authMw = require('../middleware/auth');

router.get('/', authMw, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '20', 10), 100);
  try {
    const { rows } = await pool.query(
      `SELECT id, message, type, read, created_at
         FROM notifications
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT $2`,
      [req.user.id, limit]
    );
    const unread = rows.filter(n => !n.read).length;
    return res.json({ notifications: rows, unread });
  } catch (err) {
    console.error('[notifications/GET]', err.message);
    return res.status(500).json({ error: 'Failed to fetch notifications.' });
  }
});

// ── PATCH /api/notifications/:id/read ─────────────────────
router.patch('/:id/read', authMw, async (req, res) => {
  try {
    await pool.query(
      `UPDATE notifications SET read = TRUE
        WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id]
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error('[notifications/read]', err.message);
    return res.status(500).json({ error: 'Failed to mark as read.' });
  }
});

// ── PATCH /api/notifications/read-all ─────────────────────
router.patch('/read-all', authMw, async (req, res) => {
  try {
    await pool.query(
      `UPDATE notifications SET read = TRUE WHERE user_id = $1`,
      [req.user.id]
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error('[notifications/read-all]', err.message);
    return res.status(500).json({ error: 'Failed to mark all as read.' });
  }
});

module.exports = router;
