require('dotenv').config();
const express = require('express');
const cors    = require('cors');

const authRoutes            = require('./routes/auth');
const moviesRoutes          = require('./routes/movies');
const ratingsRoutes         = require('./routes/ratings');
const recommendationsRoutes = require('./routes/recommendations');
const notificationsRoutes   = require('./routes/notifications');
const watchlistRoutes       = require('./routes/watchlist');

const app = express();

// ── Middleware ─────────────────────────────────────────────
app.use(cors({
  origin: (process.env.FRONTEND_URL || '*').split(','),
  credentials: true,
}));
app.use(express.json());

// ── Routes ─────────────────────────────────────────────────
app.use('/api/auth',            authRoutes);
app.use('/api/movies',          moviesRoutes);
app.use('/api/ratings',         ratingsRoutes);
app.use('/api/recommendations', recommendationsRoutes);
app.use('/api/notifications',   notificationsRoutes);
app.use('/api/watchlist',       watchlistRoutes);

// ── Health ─────────────────────────────────────────────────
app.get('/health', (_req, res) =>
  res.json({ status: 'ok', service: 'express', ts: new Date().toISOString() })
);

// ── 404 fallback ───────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Not found.' }));

// ── Start ──────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '3000', 10);
app.listen(PORT, () => console.log(`[Express] Listening on port ${PORT}`));

module.exports = app;
