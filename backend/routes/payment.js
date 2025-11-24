const express = require('express');
const router = express.Router();
const db = require('../db');
const { authMiddleware } = require('../helpers/auth');

// create mock payment
router.post('/', authMiddleware, async (req, res) => {
  const { booking_id, amount } = req.body;
  const user_id = req.user.id;
  try {
    const r = await db.query('INSERT INTO payments (booking_id, user_id, status, upi_txn_id, amount) VALUES ($1,$2,$3,$4,$5) RETURNING *', [booking_id, user_id, 'SUCCESS', `MOCKUPI-${Date.now()}`, amount || 0]);
    // mark booking as PAID
    await db.query("UPDATE bookings SET status='PAID' WHERE id=$1", [booking_id]);
    // notify provider
    const b = await db.query('SELECT provider_id FROM bookings WHERE id=$1', [booking_id]);
    const providerId = b.rows[0].provider_id;
    const io = req.app.locals.io;
    io.to(`user_${providerId}`).emit('payment_received', { booking_id });
    await db.query('INSERT INTO notifications (user_id, message) VALUES ($1,$2)', [providerId, `Payment received for booking #${booking_id}`]);
    res.json({ payment: r.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/booking/:id', authMiddleware, async (req, res) => {
  const r = await db.query('SELECT * FROM payments WHERE booking_id=$1', [req.params.id]);
  res.json({ payments: r.rows });
});

module.exports = router;
