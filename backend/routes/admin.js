const express = require('express');
const router = express.Router();
const db = require('../db');
const { authMiddleware, permit } = require('../helpers/auth');

// Admin: basic user list with filters
router.get('/users', authMiddleware, permit('admin'), async (req, res) => {
  try {
    const { role, q, page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;
    const where = [];
    const params = [];
    if (role) { params.push(role); where.push(`role = $${params.length}`); }
    if (q) { params.push(`%${q}%`); where.push(`(name ILIKE $${params.length} OR mobile_number ILIKE $${params.length})`); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const r = await db.query(`SELECT id, name, mobile_number, role, is_verified, created_at FROM users ${whereSql} ORDER BY created_at DESC LIMIT $${params.length+1} OFFSET $${params.length+2}`, [...params, limit, offset]);
    res.json({ users: r.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin: delete user with safety checks
router.delete('/user/:id', authMiddleware, permit('admin'), async (req, res) => {
  try {
    const id = req.params.id;
    // Don't delete admins
    const u = await db.query('SELECT role FROM users WHERE id=$1', [id]);
    if (u.rowCount === 0) return res.status(404).json({ error: 'User not found' });
    if (u.rows[0].role === 'admin') return res.status(403).json({ error: 'Cannot delete admin' });
    // soft-delete pattern could be used; here we'll remove the user
    await db.query('DELETE FROM users WHERE id=$1', [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin: booking analytics (counts & revenue)
router.get('/analytics/summary', authMiddleware, permit('admin'), async (req, res) => {
  try {
    const bookingsCount = (await db.query('SELECT status, count(*) FROM bookings GROUP BY status')).rows;
    const revenue = (await db.query('SELECT SUM(amount) as total_revenue FROM payments WHERE status=$1', ['SUCCESS'])).rows[0].total_revenue || 0;
    res.json({ bookingsCount, revenue });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
