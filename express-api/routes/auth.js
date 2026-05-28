const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const db      = require('../db');

const JWT_SECRET  = process.env.JWT_SECRET || 'dev-secret-change-me';
const JWT_EXPIRES = '7d';

// ── Middleware: verify JWT ──────────────────────────────
function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid token.' });
  }
  try {
    req.user = jwt.verify(header.slice(7), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token expired or invalid.' });
  }
}

// ── POST /api/auth/register ─────────────────────────────
router.post('/register', async (req, res, next) => {
  try {
    const { email, password, username } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required.' });
    }

    const hash = await bcrypt.hash(password, 12);
    const { rows } = await db.query(
      `INSERT INTO users (email, password_hash, username)
       VALUES ($1, $2, $3)
       RETURNING id, email, username, created_at`,
      [email.toLowerCase().trim(), hash, username || null]
    );

    const user  = rows[0];
    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: JWT_EXPIRES });

    res.status(201).json({ user, token });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Email or username already in use.' });
    }
    next(err);
  }
});

// ── POST /api/auth/login ────────────────────────────────
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required.' });
    }

    const { rows } = await db.query(
      'SELECT * FROM users WHERE email = $1',
      [email.toLowerCase().trim()]
    );

    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
    const { password_hash, ...safe } = user;

    res.json({ user: safe, token });
  } catch (err) { next(err); }
});

// ── GET /api/auth/me ────────────────────────────────────
router.get('/me', auth, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      'SELECT id, email, username, created_at FROM users WHERE id = $1',
      [req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found.' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// ── PATCH /api/auth/me ──────────────────────────────────
router.patch('/me', auth, async (req, res, next) => {
  try {
    const { username } = req.body;
    const { rows } = await db.query(
      `UPDATE users SET username = COALESCE($1, username)
       WHERE id = $2
       RETURNING id, email, username, created_at`,
      [username || null, req.user.id]
    );
    res.json(rows[0]);
  } catch (err) { next(err); }
});

module.exports = router;
module.exports.auth = auth;   // re-export for other routes
