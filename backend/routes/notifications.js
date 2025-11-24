const express = require('express');
const router = express.Router();
const db = require('../db');
const { authMiddleware } = require('../helpers/auth');

router.get('/:userId', authMiddleware, async (req, res) => {
  const r = await db.query('SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC', [req.params.userId]);
  res.json({ notifications: r.rows });
});

router.get('/:userId/unread', authMiddleware, async (req, res) => {
  const r = await db.query('SELECT COUNT(*) FROM notifications WHERE user_id=$1 AND read=false', [req.params.userId]);
  res.json({ unread: parseInt(r.rows[0].count) });
});

router.post('/read', authMiddleware, async (req, res) => {
  const { id } = req.body;
  await db.query('UPDATE notifications SET read=true WHERE id=$1', [id]);
  res.json({ ok: true });
});

router.post('/read-all', authMiddleware, async (req, res) => {
  const { userId } = req.body;
  await db.query('UPDATE notifications SET read=true WHERE user_id=$1', [userId]);
  res.json({ ok: true });
});

module.exports = router;
