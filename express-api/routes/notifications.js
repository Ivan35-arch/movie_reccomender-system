const router = require('express').Router();
const db     = require('../db');
const { auth } = require('./auth');

// ── GET /api/notifications ──────────────────────────────
router.get('/', auth, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT id, type, message, read, created_at
       FROM notifications
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [req.user.id]
    );

    const unread = rows.filter((n) => !n.read).length;

    res.json({ unread, count: rows.length, notifications: rows });
  } catch (err) { next(err); }
});

// ── PATCH /api/notifications/:id/read ──────────────────
router.patch('/:id/read', auth, async (req, res, next) => {
  try {
    const { rowCount } = await db.query(
      `UPDATE notifications SET read = TRUE
       WHERE id = $1 AND user_id = $2`,
      [parseInt(req.params.id), req.user.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Notification not found.' });
    res.json({ message: 'Marked as read.' });
  } catch (err) { next(err); }
});

// ── PATCH /api/notifications/read-all ──────────────────
router.patch('/read-all', auth, async (req, res, next) => {
  try {
    const { rowCount } = await db.query(
      `UPDATE notifications SET read = TRUE
       WHERE user_id = $1 AND read = FALSE`,
      [req.user.id]
    );
    res.json({ message: `${rowCount} notification(s) marked as read.` });
  } catch (err) { next(err); }
});

// ── DELETE /api/notifications/:id ──────────────────────
router.delete('/:id', auth, async (req, res, next) => {
  try {
    const { rowCount } = await db.query(
      'DELETE FROM notifications WHERE id = $1 AND user_id = $2',
      [parseInt(req.params.id), req.user.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Notification not found.' });
    res.json({ message: 'Notification deleted.' });
  } catch (err) { next(err); }
});

// ── Internal helper: create a notification ──────────────
// Used by other routes (not exposed as HTTP endpoint)
async function createNotification(userId, type, message) {
  await db.query(
    `INSERT INTO notifications (user_id, type, message) VALUES ($1, $2, $3)`,
    [userId, type, message]
  );
}

module.exports = router;
module.exports.createNotification = createNotification;
