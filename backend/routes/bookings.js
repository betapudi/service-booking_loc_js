const express = require('express');
const router = express.Router();
const db = require('../db');
const { authMiddleware } = require('../helpers/auth');

// Create booking
router.post('/', authMiddleware, async (req, res) => {
  const { provider_id, location_id, total_amount, metadata, broker_id } = req.body;
  const customer_id = req.user.id;

  try {
    // Get customer location
    const customerRes = await db.query(
      'SELECT name, mobile_number, latitude, longitude, meta FROM users WHERE id=$1',
      [customer_id]
    );
    const customer = customerRes.rows[0];
    const customer_lat = customer.latitude || customer.meta?.location?.lat || null;
    const customer_lng = customer.longitude || customer.meta?.location?.lng || null;

    // Create booking
    const bookingRes = await db.query(
      `INSERT INTO bookings 
       (customer_id, provider_id, location_id, total_amount, metadata, broker_id, customer_latitude, customer_longitude) 
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [customer_id, provider_id, location_id, total_amount || 0, metadata || {}, broker_id || null, customer_lat, customer_lng]
    );
    const booking = bookingRes.rows[0];

    const bookingWithCustomer = {
      ...booking,
      customer_name: customer.name || 'Customer',
      customer_mobile: customer.mobile_number || 'N/A'
    };

    const io = req.app.locals.io;

    // Notify provider
    if (provider_id) {
      io.to(`user_${provider_id}`).emit('new_booking', { booking: bookingWithCustomer });
      await db.query(
        'INSERT INTO notifications (user_id, message) VALUES ($1,$2)',
        [provider_id, `New booking #${booking.id} from ${bookingWithCustomer.customer_name}`]
      );
    }

    // Notify broker if involved
    if (broker_id) {
      io.to(`user_${broker_id}`).emit('new_group_request', { booking: bookingWithCustomer });
      await db.query(
        'INSERT INTO notifications (user_id, message) VALUES ($1,$2)',
        [broker_id, `New group booking #${booking.id} from ${bookingWithCustomer.customer_name}`]
      );
    }

    res.json({ booking: bookingWithCustomer });
  } catch (err) {
    console.error('Error creating booking:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get booking history
router.get('/history', authMiddleware, async (req, res) => {
  const uid = req.user.id;

  try {
    const r = await db.query(`
      SELECT 
        b.*, 
        c.name AS customer_name,
        c.mobile_number AS customer_mobile,
        p.name AS provider_name
      FROM bookings b
      LEFT JOIN users c ON b.customer_id = c.id
      LEFT JOIN users p ON b.provider_id = p.id
      WHERE b.customer_id = $1 OR b.provider_id = $1 OR b.broker_id = $1
      ORDER BY b.created_at DESC
    `, [uid]);

    res.json({ bookings: r.rows });
  } catch (err) {
    console.error('Error fetching booking history:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get single booking by ID
router.get('/:id', authMiddleware, async (req, res) => {
  const id = req.params.id;

  try {
    const r = await db.query(`
      SELECT 
        b.*, 
        c.name AS customer_name,
        c.mobile_number AS customer_mobile,
        c.latitude AS customer_latitude,
        c.longitude AS customer_longitude,
        p.name AS provider_name,
        p.latitude AS provider_latitude,
        p.longitude AS provider_longitude
      FROM bookings b
      LEFT JOIN users c ON b.customer_id = c.id
      LEFT JOIN users p ON b.provider_id = p.id
      WHERE b.id = $1
    `, [id]);

    if (r.rows.length === 0) {
      return res.status(404).json({ error: "Booking not found" });
    }

    res.json({ booking: r.rows[0] });
  } catch (err) {
    console.error("Error fetching booking:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Update booking status - FIXED VERSION
// Update the existing status endpoint
// router.post('/:id/status', async (req, res) => {
//   try {
//     const bookingId = req.params.id;
//     const { status } = req.body;

//     // For regular bookings
//     const updateBooking = await db.query(
//       `UPDATE customer_requests 
//        SET status = ?, 
//            ${status === 'completed' ? 'completed_at = NOW(),' : ''}
//            updated_at = NOW()
//        WHERE id = ?`,
//       [status, bookingId]
//     );

//     // If this is a provider assignment (not main customer request)
//     const isProviderAssignment = await db.query(
//       `SELECT * FROM provider_assignments WHERE id = ?`,
//       [bookingId]
//     );

//     if (isProviderAssignment.length > 0) {
//       // Update provider assignment
//       await db.query(
//         `UPDATE provider_assignments 
//          SET status = ?,
//              ${status === 'completed' ? 'completed_at = NOW(),' : ''}
//              updated_at = NOW()
//          WHERE id = ?`,
//         [status, bookingId]
//       );

//       // If completing, free up the provider
//       if (status === 'completed') {
//         await db.query(
//           `UPDATE providers SET is_available = true 
//            WHERE id = (SELECT provider_id FROM provider_assignments WHERE id = ?)`,
//           [bookingId]
//         );
//       }
//     }

//     res.json({
//       success: true,
//       message: `Booking ${status} successfully`,
//       booking: { id: bookingId, status }
//     });

//   } catch (error) {
//     console.error('Status update error:', error);
//     res.status(500).json({ error: 'Failed to update booking status' });
//   }
// });
// backend/routes/bookings.js
router.post('/:id/status', authMiddleware, async (req, res) => {
  const bookingId = req.params.id;
  const { status } = req.body;

  try {
    const r = await db.query(
      `UPDATE bookings SET status=$1, updated_at=NOW() WHERE id=$2 RETURNING *`,
      [status.toUpperCase(), bookingId]
    );

    if (r.rowCount === 0) return res.status(404).json({ error: 'Booking not found' });

    const booking = r.rows[0];
    const io = req.app.locals.io;

    // Notify booking room + users
    io.to(`booking_${booking.id}`).emit('booking_status_update', { booking_id: booking.id, status: booking.status });
    if (booking.customer_id) io.to(`user_${booking.customer_id}`).emit('booking_status_update', { booking_id: booking.id, status: booking.status });
    if (booking.provider_id) io.to(`user_${booking.provider_id}`).emit('booking_status_update', { booking_id: booking.id, status: booking.status });

    res.json({ success: true, booking });
  } catch (error) {
    console.error('Status update error:', error);
    res.status(500).json({ error: 'Failed to update booking status' });
  }
});

// New endpoint to get only provider assignments (not main group bookings)
router.get('/provider-bookings', async (req, res) => {
  try {
    const providerId = req.user.id;
    
    const providerBookings = await db.query(`
      SELECT b.*, 
             cr.customer_name,
             cr.customer_mobile,
             cr.customer_latitude,
             cr.customer_longitude,
             cr.service_type,
             cr.description,
             cr.group_id,
             b.group_request_id,
             (SELECT COUNT(*) FROM bookings b2 
              WHERE b2.customer_request_id = b.customer_request_id 
              AND b2.group_request_id IS NOT NULL) as provider_count
      FROM bookings b
      LEFT JOIN customer_requests cr ON b.customer_request_id = cr.id
      WHERE b.provider_id = ?
      ORDER BY b.created_at DESC
    `, [providerId]);

    res.json({ bookings: providerBookings });
    
  } catch (error) {
    console.error('Provider bookings error:', error);
    res.status(500).json({ error: 'Failed to fetch provider bookings' });
  }
});
module.exports = router;
