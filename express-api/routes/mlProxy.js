const router  = require('express').Router();
const FLASK_URL = process.env.FLASK_ML_URL || 'http://localhost:5000';

/**
 * Transparent proxy from Express → Flask ML.
 * The frontend calls these routes on the Express API so it only ever
 * needs one base URL (the Express API) and never talks to Flask directly.
 *
 * Routes proxied:
 *   GET  /api/ml/health
 *   GET  /api/ml/users
 *   GET  /api/ml/movies
 *   GET  /api/ml/movie/:title
 *   GET  /api/ml/recommend/:user_id
 *   POST /api/ml/recommend/new-user
 *   GET  /api/ml/similar-users/:user_id
 */

async function proxy(flaskPath, req, res, method = 'GET', body = null) {
  const url = `${FLASK_URL}${flaskPath}`;
  try {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (body) opts.body = JSON.stringify(body);

    const flaskRes = await fetch(url, opts);
    const data = await flaskRes.json().catch(() => ({}));
    res.status(flaskRes.status).json(data);
  } catch (err) {
    console.error('[ML Proxy] Error reaching Flask:', err.message);
    res.status(502).json({ error: 'ML service is unavailable.', detail: err.message });
  }
}

// Health
router.get('/health', (req, res) => proxy('/health', req, res));

// Users
router.get('/users', (req, res) => proxy('/api/users', req, res));

// Movies (paginated)
router.get('/movies', (req, res) => {
  const qs = new URLSearchParams(req.query).toString();
  proxy(`/api/movies${qs ? '?' + qs : ''}`, req, res);
});

// Movie search
router.get('/movie/*', (req, res) => {
  const title = req.params[0];
  proxy(`/api/movie/${encodeURIComponent(title)}`, req, res);
});

// Recommend for known user
router.get('/recommend/:userId', (req, res) => {
  const qs = new URLSearchParams(req.query).toString();
  proxy(`/api/recommend/${req.params.userId}${qs ? '?' + qs : ''}`, req, res);
});

// Cold-start (new user)
router.post('/recommend/new-user', (req, res) =>
  proxy('/api/recommend/new-user', req, res, 'POST', req.body)
);

// Similar users
router.get('/similar-users/:userId', (req, res) =>
  proxy(`/api/similar-users/${req.params.userId}`, req, res)
);

module.exports = router;
