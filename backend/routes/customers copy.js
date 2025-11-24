// backend/routes/customers.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const { authMiddleware, permit } = require('../helpers/auth');

// Create customer_requests table if it doesn't exist
router.post('/setup-customer-requests-table', async (req, res) => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS customer_requests (
        id SERIAL PRIMARY KEY,
        customer_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        skill_id INTEGER REFERENCES skills(id),
        provider_count INTEGER NOT NULL DEFAULT 1,
        broker_id INTEGER REFERENCES users(id),
        description TEXT NOT NULL,
        location_details TEXT,
        preferred_date DATE,
        budget_range VARCHAR(50),
        status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW(),
        accepted_at TIMESTAMP,
        completed_at TIMESTAMP
      )
    `);

    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_customer_requests_customer 
      ON customer_requests(customer_id)
    `);

    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_customer_requests_broker 
      ON customer_requests(broker_id)
    `);

    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_customer_requests_status 
      ON customer_requests(status)
    `);

    res.json({
      success: true,
      message: 'Customer requests table created successfully'
    });
  } catch (error) {
    console.error('Error creating customer_requests table:', error);
    res.status(500).json({ error: 'Failed to create table: ' + error.message });
  }
});
// Customer group request endpoints - FIXED TO USE customer_requests TABLE CONSISTENTLY

// Create group request - FIXED to use customer_requests table
router.post('/group-requests', authMiddleware, permit('customer'), async (req, res) => {
  try {
    const customerId = req.user.id;
    const {

      skill_id,
      provider_count,
      broker_id,
      description,
      location_details,
      preferred_date,
      budget_range
    } = req.body;

    console.log('Received group request:', req.body);
    // Validate required fields
    if (!skill_id || !provider_count || !description) {
      return res.status(400).json({ error: 'Skill, provider count, and description are required' });
    }

    // Create group request
    const request = await db.query(`
      INSERT INTO customer_requests 
      (customer_id, skill_id, provider_count, broker_id, description, 
       location_details, preferred_date, budget_range, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
      RETURNING *
    `, [customerId, skill_id, provider_count, broker_id, description,
      location_details, preferred_date, budget_range]);

    // Notify brokers (all or specific broker)
    const io = req.app.locals.io;
    if (broker_id) {
      // Notify specific broker
      io.to(`user_${broker_id}`).emit('new_group_request', {
        request: request.rows[0],
        customer_name: req.user.name
      });
    } else {
      // Notify all available brokers
      const brokers = await db.query(`
        SELECT id FROM users WHERE role = 'broker' AND is_verified = true
      `);

      brokers.rows.forEach(broker => {
        io.to(`user_${broker.id}`).emit('new_group_request_broadcast', {
          request: request.rows[0],
          customer_name: req.user.name
        });
      });
    }

    res.json({
      success: true,
      request: request.rows[0],
      message: 'Group request submitted successfully'
    });

  } catch (error) {
    console.error('Error creating group request:', error);
    res.status(500).json({ error: 'Failed to create group request: ' + error.message });
  }
});

// Get customer group requests - FIXED to use customer_requests table
router.get('/group-requests', authMiddleware, permit('customer'), async (req, res) => {
  try {
    const customerId = req.user.id;

    const requests = await db.query(`
      SELECT 
        cr.*,
        s.name as skill_name,
        b.name as broker_name,
        b.mobile_number as broker_mobile
      FROM customer_requests cr
      LEFT JOIN skills s ON cr.skill_id = s.id
      LEFT JOIN users b ON cr.broker_id = b.id
      WHERE cr.customer_id = $1
      ORDER BY cr.created_at DESC
    `, [customerId]);

    console.log(`Found ${requests.rows.length} group requests for customer ${customerId}`);

    res.json({
      success: true,
      requests: requests.rows
    });

  } catch (error) {
    console.error('Error fetching group requests:', error);
    res.status(500).json({ error: 'Failed to fetch group requests: ' + error.message });
  }
});


// ✅ FIXED: Complete group request
router.post('/group-requests/:id/complete', authMiddleware, permit('customer'), async (req, res) => {
  try {
    const requestId = req.params.id;
    const customerId = req.user.id;

    console.log(`Completing group request ${requestId} for customer ${customerId}`);

    const result = await db.query(`
      UPDATE customer_requests 
      SET status = 'completed', completed_at = NOW()
      WHERE id = $1 AND customer_id = $2 AND status IN ('accepted', 'pending', 'accepted')
      RETURNING *
    `, [requestId, customerId]);

    if (result.rowCount === 0) {
      return res.status(404).json({
        error: 'Group request not found or cannot be completed'
      });
    }

    res.json({
      success: true,
      message: 'Group request marked as completed',
      request: result.rows[0]
    });
  } catch (err) {
    console.error('Error completing group request:', err);
    res.status(500).json({ error: 'Failed to complete group request: ' + err.message });
  }
});

// Cancel group request - FIXED for customer_requests table
router.post('/group-requests/:id/cancel', authMiddleware, permit('customer'), async (req, res) => {
  try {
    const requestId = req.params.id;
    const customerId = req.user.id;

    // Verify ownership and update status
    const result = await db.query(`
      UPDATE customer_requests 
      SET status = 'cancelled' 
      WHERE id = $1 AND customer_id = $2 AND status = 'pending'
      RETURNING *
    `, [requestId, customerId]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Request not found or cannot be cancelled' });
    }

    res.json({
      success: true,
      message: 'Group request cancelled successfully'
    });

  } catch (error) {
    console.error('Error cancelling group request:', error);
    res.status(500).json({ error: 'Failed to cancel group request: ' + error.message });
  }
});

// Customer: search providers (wrapper) - keeps future place for caching / filters
router.get('/providers', authMiddleware, permit('customer'), async (req, res) => {
  // delegate to providers route SQL but we keep a simple wrapper
  const { locationId, skill, page, limit } = req.query;
  try {
    const r = await db.query(`SELECT u.id, u.name, u.mobile_number, u.location_id, u.meta,
      json_agg(s.name) FILTER (WHERE s.name IS NOT NULL) as skills
      FROM users u
      LEFT JOIN provider_skills ps ON ps.user_id = u.id
      LEFT JOIN skills s ON s.id = ps.skill_id
      WHERE u.role='provider' AND ($1::int IS NULL OR u.location_id=$1)
      GROUP BY u.id ORDER BY u.created_at DESC LIMIT $2 OFFSET $3`, [locationId || null, limit || 20, ((page || 1) - 1) * (limit || 20)]);
    res.json({ providers: r.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});
// Customer: update current location (FIXED - properly updating all location columns)
router.put('/location', authMiddleware, permit('customer'), async (req, res) => {
  try {
    const userId = req.user.id;
    const { latitude, longitude } = req.body;

    if (!latitude || !longitude) {
      return res.status(400).json({ error: 'Latitude and longitude are required' });
    }

    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);

    // Update customer's location in ALL location columns
    await db.query(
      `UPDATE users 
       SET latitude = $1, 
           longitude = $2,
           geom = ST_SetSRID(ST_MakePoint($2, $1), 4326),
           meta = jsonb_set(
             COALESCE(meta, '{}'::jsonb), 
             '{location}', 
             $3::jsonb
           )
       WHERE id = $4 AND role = 'customer'`,
      [lat, lng, JSON.stringify({
        lat: lat,
        lng: lng,
        updated_at: new Date().toISOString()
      }), userId]
    );

    res.json({
      success: true,
      message: 'Location updated successfully',
      location: { latitude: lat, longitude: lng }
    });
  } catch (err) {
    console.error('Error updating customer location:', err);
    res.status(500).json({ error: 'Failed to update location' });
  }
});

// Customer: get current location
router.get('/me/location', authMiddleware, permit('customer'), async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await db.query(
      'SELECT latitude, longitude, meta FROM users WHERE id = $1 AND role = $2',
      [userId, 'customer']
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    const user = result.rows[0];
    res.json({
      latitude: user.latitude,
      longitude: user.longitude,
      meta: user.meta
    });
  } catch (err) {
    console.error('Error fetching customer location:', err);
    res.status(500).json({ error: 'Failed to fetch location' });
  }
});

// Customer: mark booking complete (then provider can confirm)
// Fix the booking completion endpoint - make sure the path matches
router.post('/bookings/:id/complete', authMiddleware, permit('customer'), async (req, res) => {
  const bookingId = req.params.id;
  const userId = req.user.id;
  try {
    // sanity: ensure booking belongs to customer
    const b = await db.query('SELECT * FROM bookings WHERE id=$1 AND customer_id=$2', [bookingId, userId]);
    if (b.rowCount === 0) return res.status(404).json({ error: 'Booking not found' });
    await db.query("UPDATE bookings SET status='COMPLETED' WHERE id=$1", [bookingId]);
    const booking = (await db.query('SELECT * FROM bookings WHERE id=$1', [bookingId])).rows[0];
    // notify provider
    const io = req.app.locals.io;
    if (booking.provider_id) io.to(`user_${booking.provider_id}`).emit('booking_status', { booking });
    await db.query('INSERT INTO notifications (user_id, message) VALUES ($1,$2)', [booking.provider_id, `Customer marked booking #${bookingId} as completed.`]);
    res.json({ ok: true, booking });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// router.post('/bookings/:id/complete', authMiddleware, permit('customer'), async (req, res) => {
//   try {
//     const bookingId = req.params.id;
//     const userId = req.user.id;

//     console.log(`Completing booking ${bookingId} for customer ${userId}`);

//     // Verify booking belongs to customer
//     const bookingCheck = await db.query(
//       `SELECT b.*, p.id as provider_id, p.name as provider_name 
//        FROM bookings b 
//        LEFT JOIN users p ON b.provider_id = p.id 
//        WHERE b.id = $1 AND b.customer_id = $2`,
//       [bookingId, userId]
//     );

//     if (bookingCheck.rowCount === 0) {
//       return res.status(404).json({ error: 'Booking not found or access denied' });
//     }

//     const booking = bookingCheck.rows[0];
//     const metadata = booking.metadata || {};
//     const io = req.app.locals.io;

//     // ✅ If group booking, complete all related bookings
//     if (metadata.original_request_id) {
//       const groupId = metadata.original_request_id;

//       await db.query(
//         `UPDATE bookings 
//          SET status='COMPLETED' 
//          WHERE metadata->>'original_request_id' = $1 AND customer_id = $2`,
//         [groupId.toString(), userId]
//       );

//       const updatedGroupBookings = await db.query(
//         `SELECT * FROM bookings 
//          WHERE metadata->>'original_request_id' = $1 AND customer_id = $2`,
//         [groupId.toString(), userId]
//       );

//       // Notify all providers
//       for (const b of updatedGroupBookings.rows) {
//         if (b.provider_id) {
//           io.to(`user_${b.provider_id}`).emit('booking_status', { booking: b });
//           await db.query(
//             'INSERT INTO notifications (user_id, message) VALUES ($1,$2)',
//             [b.provider_id, `Customer marked group booking #${groupId} as completed.`]
//           );
//         }
//       }

//       return res.json({
//         success: true,
//         group_completed: true,
//         bookings: updatedGroupBookings.rows
//       });
//     }

//     // ✅ Else, complete single booking
//     await db.query("UPDATE bookings SET status='COMPLETED' WHERE id=$1", [bookingId]);

//     const updatedBooking = await db.query('SELECT * FROM bookings WHERE id=$1', [bookingId]);
//     const finalBooking = updatedBooking.rows[0];

//     if (finalBooking.provider_id) {
//       io.to(`user_${finalBooking.provider_id}`).emit('booking_status', { booking: finalBooking });
//       await db.query(
//         'INSERT INTO notifications (user_id, message) VALUES ($1,$2)',
//         [finalBooking.provider_id, `Customer marked booking #${bookingId} as completed.`]
//       );
//     }

//     res.json({
//       success: true,
//       group_completed: false,
//       booking: finalBooking
//     });
//   } catch (err) {
//     console.error('Error completing booking:', err);
//     res.status(500).json({ error: 'Server error: ' + err.message });
//   }
// });

// Provider: get customer location (NEW ENDPOINT)
router.get('/:customerId/location', authMiddleware, permit('provider'), async (req, res) => {
  try {
    const { customerId } = req.params;

    const result = await db.query(
      'SELECT id, name, latitude, longitude, meta FROM users WHERE id = $1 AND role = $2',
      [customerId, 'customer']
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    const customer = result.rows[0];
    res.json({
      id: customer.id,
      name: customer.name,
      latitude: customer.latitude,
      longitude: customer.longitude,
      meta: customer.meta
    });
  } catch (err) {
    console.error('Error fetching customer location:', err);
    res.status(500).json({ error: 'Failed to fetch customer location' });
  }
});

// Add this endpoint to get customer details
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const customerId = req.params.id;

    const result = await db.query(
      'SELECT id, name, mobile_number, latitude, longitude, meta FROM users WHERE id = $1',
      [customerId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error('Error fetching customer:', err);
    res.status(500).json({ error: 'Server error' });
  }
});



module.exports = router;