const jwt = require('jsonwebtoken');

/**
 * JWT authentication middleware.
 * Reads Bearer token from Authorization header.
 * Attaches decoded payload to req.user.
 */
module.exports = function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided.' });
  }
  const token = header.slice(7);
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
};
