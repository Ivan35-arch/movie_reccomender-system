require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const path       = require('path');

const authRouter    = require('./routes/auth');
const moviesRouter  = require('./routes/movies');
const recsRouter    = require('./routes/recommendations');
const ratingsRouter = require('./routes/ratings');
const watchlistRouter = require('./routes/watchlist');
const historyRouter = require('./routes/history');
const notifRouter   = require('./routes/notifications');
const mlProxy       = require('./routes/mlProxy');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ───────────────────────────────────────────
app.use(cors({ origin: process.env.ALLOWED_ORIGINS || '*' }));
app.use(express.json());

// ── Serve frontend static files ──────────────────────────
const FRONTEND = path.join(__dirname, '..', 'frontend');
app.use(express.static(FRONTEND));

// Request logger
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ── Routes ───────────────────────────────────────────────
app.use('/api/auth',            authRouter);
app.use('/api/movies',          moviesRouter);
app.use('/api/recommendations', recsRouter);
app.use('/api/ratings',         ratingsRouter);
app.use('/api/watchlist',       watchlistRouter);
app.use('/api/history',         historyRouter);
app.use('/api/notifications',   notifRouter);
// ML proxy — transparent bridge to the Flask ML service
app.use('/api/ml',              mlProxy);

// ── Health ───────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'seive-express-api', ts: new Date() });
});

// ── SPA fallback — serve index.html for non-API routes ──
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'Endpoint not found.' });
  }
  res.sendFile(path.join(FRONTEND, 'index.html'));
});

// ── Error Handler ─────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('[ERROR]', err.message);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error.' });
});

app.listen(PORT, () => {
  console.log(`[Seive API] Running on http://localhost:${PORT}`);
});
