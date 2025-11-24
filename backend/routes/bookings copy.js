const express = require('express');
const router = express.Router();
const db = require('../db');
const { authMiddleware } = require('../helpers/auth');

// create booking (customer) - COMPLETE REWRITE
// Enhanced create booking endpoint
router.post('/', authMiddleware, async (req, res) => {
  const { provider_id, location_id, total_amount, metadata, broker_id } = req.body;
  const customer_id = req.user.id;
  
  try {
    // Get customer's current location
    const customer = await db.query(
      'SELECT latitude, longitude, meta FROM users WHERE id=$1', 
      [customer_id]
    );
    
    let customer_lat = null;
    let customer_lng = null;
    
    if (customer.rows[0]?.latitude && customer.rows[0]?.longitude) {
      customer_lat = customer.rows[0].latitude;
      customer_lng = customer.rows[0].longitude;
    } else if (customer.rows[0]?.meta?.location) {
      customer_lat = customer.rows[0].meta.location.lat;
      customer_lng = customer.rows[0].meta.location.lng;
    }

    // Create booking with customer location
    const r = await db.query(
      `INSERT INTO bookings 
       (customer_id, provider_id, location_id, total_amount, metadata, broker_id, customer_latitude, customer_longitude) 
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, 
      [customer_id, provider_id, location_id, total_amount || 0, metadata || {}, broker_id || null, customer_lat, customer_lng]
    );
    
    const booking = r.rows[0];
    
    // Get customer details for notification
    const customerDetails = await db.query(
      'SELECT name, mobile_number FROM users WHERE id=$1', 
      [customer_id]
    );
    
    const bookingWithCustomer = {
      ...booking,
      customer_name: customerDetails.rows[0]?.name || 'Customer',
      customer_mobile: customerDetails.rows[0]?.mobile_number || 'N/A'
    };

    // Notify provider via socket
    const io = req.app.locals.io;
    if (provider_id) {
      io.to(`user_${provider_id}`).emit('new_booking', { 
        booking: bookingWithCustomer 
      });
      await db.query(
    'INSERT INTO notifications (user_id, message) VALUES ($1,$2)',
    [provider_id, `New booking #${booking.id} from ${bookingWithCustomer.customer_name}`]
  );
    }
    
    // Add notification entry
    await db.query(
      'INSERT INTO notifications (user_id, message) VALUES ($1,$2)', 
      [provider_id, `New booking #${booking.id} from ${bookingWithCustomer.customer_name}`]
    );
    
    res.json({ booking: bookingWithCustomer });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});
// get booking history - COMPLETE REWRITE
router.get('/history', authMiddleware, async (req, res) => {
  const uid = req.user.id;
  
  try {
    const r = await db.query(`
      SELECT 
        b.*, 
        c.name as customer_name,
        c.mobile_number as customer_mobile,
        c.latitude as customer_latitude,
        c.longitude as customer_longitude,
        p.name as provider_name
      FROM bookings b
      LEFT JOIN users c ON b.customer_id = c.id
      LEFT JOIN users p ON b.provider_id = p.id
      WHERE b.customer_id = $1 OR b.provider_id = $1 
      ORDER BY b.created_at DESC
    `, [uid]);
    
    console.log(`Found ${r.rowCount} bookings for user ${uid}`); // Debug log
    
    res.json({ bookings: r.rows });
    
  } catch (err) {
    console.error('Error fetching bookings:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// change booking status - UPDATED
router.post('/:id/status', authMiddleware, async (req, res) => {
  const { status } = req.body;
  const id = req.params.id;
  
  try {
    const r = await db.query(
      'UPDATE bookings SET status=$1 WHERE id=$2 RETURNING *', 
      [status, id]
    );
    
    const booking = r.rows[0];
    
    // Get customer and provider details for notification
    const detailsResult = await db.query(`
      SELECT 
        c.name as customer_name,
        c.mobile_number as customer_mobile,
        c.latitude as customer_latitude,
        c.longitude as customer_longitude,
        p.name as provider_name
      FROM bookings b
      LEFT JOIN users c ON b.customer_id = c.id
      LEFT JOIN users p ON b.provider_id = p.id
      WHERE b.id = $1
    `, [id]);
    
    const details = detailsResult.rows[0];
    const bookingWithDetails = { ...booking, ...details };
    
    // Notify via socket
    const io = req.app.locals.io;
    if (booking.customer_id) {
      io.to(`user_${booking.customer_id}`).emit('booking_status', { 
        booking: bookingWithDetails 
      });
    }
    
    // Add notification
    await db.query(
      'INSERT INTO notifications (user_id, message) VALUES ($1,$2)', 
      [booking.customer_id, `Booking #${booking.id} ${status}`]
    );
    
    res.json({ booking: bookingWithDetails });
    
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;