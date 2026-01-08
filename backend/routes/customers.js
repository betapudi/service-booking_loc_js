// backend/routes/customers.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const { authMiddleware, permit } = require('../helpers/auth');
// Add to backend/routes/customers.js or bookings.js
router.get('/me/bookings', authMiddleware, async (req, res) => {
  try {
    const customerId = req.user.id;
    
    const bookings = await db.query(`
      SELECT 
        b.*,
        u.name as provider_name,
        u.mobile_number as provider_mobile,
        u.is_verified as provider_verified,
        COALESCE(
          ARRAY_AGG(DISTINCT s.name) FILTER (WHERE s.name IS NOT NULL),
          ARRAY[]::varchar[]
        ) as provider_skills,
        COUNT(br.rating) as total_ratings,
        AVG(br.rating) as provider_rating
      FROM bookings b
      LEFT JOIN users u ON b.provider_id = u.id
      LEFT JOIN provider_skills ps ON u.id = ps.user_id
      LEFT JOIN skills s ON ps.skill_id = s.id
      LEFT JOIN booking_ratings br ON b.id = br.booking_id
      WHERE b.customer_id = $1 
        AND b.status IN ('PENDING', 'ACCEPTED', 'IN_PROGRESS')
      GROUP BY b.id, u.id
      ORDER BY b.created_at DESC
    `, [customerId]);

    res.json({
      success: true,
      bookings: bookings.rows
    });
  } catch (error) {
    console.error('Error fetching customer bookings:', error);
    res.status(500).json({ error: 'Failed to fetch bookings' });
  }
});
// Add to backend/routes/bookings.js or customers.js
router.post('/:id/cancel', authMiddleware, async (req, res) => {
  try {
    const bookingId = req.params.id;
    const userId = req.user.id;

    // Check if booking exists and belongs to customer
    const bookingCheck = await db.query(
      `SELECT * FROM bookings WHERE id = $1 AND customer_id = $2 AND status = 'PENDING'`,
      [bookingId, userId]
    );

    if (bookingCheck.rowCount === 0) {
      return res.status(404).json({ 
        error: 'Booking not found or cannot be cancelled' 
      });
    }

    // Update booking status to CANCELLED
    const result = await db.query(
      `UPDATE bookings 
       SET status = 'CANCELLED', updated_at = NOW() 
       WHERE id = $1 
       RETURNING *`,
      [bookingId]
    );

    const booking = result.rows[0];
    const io = req.app.locals.io;

    // Notify provider
    if (booking.provider_id) {
      io.to(`user_${booking.provider_id}`).emit('booking_cancelled', { booking });
      
      await db.query(
        'INSERT INTO notifications (user_id, message, type, reference_id) VALUES ($1,$2,$3,$4)',
        [booking.provider_id, `Booking #${bookingId} was cancelled by customer`, 'booking_cancelled', bookingId]
      );
    }

    res.json({
      success: true,
      booking: booking,
      message: 'Booking cancelled successfully'
    });

  } catch (error) {
    console.error('Error cancelling booking:', error);
    res.status(500).json({ error: 'Failed to cancel booking' });
  }
});
// Create customer_requests table if it doesn't exist - UPDATED with group_request_id
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

    // ADD group_request_id to bookings table
    await db.query(`
      ALTER TABLE bookings 
      ADD COLUMN IF NOT EXISTS group_request_id INTEGER REFERENCES customer_requests(id)
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

    // Add index for group_request_id in bookings
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_bookings_group_request 
      ON bookings(group_request_id)
    `);

    res.json({
      success: true,
      message: 'Customer requests table created successfully with group_request_id support'
    });
  } catch (error) {
    console.error('Error creating customer_requests table:', error);
    res.status(500).json({ error: 'Failed to create table: ' + error.message });
  }
});

// Create group request - UPDATED to handle group_request_id linking
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

    const groupRequest = request.rows[0];

    // Notify brokers (all or specific broker)
    const io = req.app.locals.io;
    if (broker_id) {
      // Notify specific broker
      io.to(`user_${broker_id}`).emit('new_group_request', {
        request: groupRequest,
        customer_name: req.user.name
      });
    } else {
      // Notify all available brokers
      const brokers = await db.query(`
        SELECT id FROM users WHERE role = 'broker' AND is_verified = true
      `);

      brokers.rows.forEach(broker => {
        io.to(`user_${broker.id}`).emit('new_group_request_broadcast', {
          request: groupRequest,
          customer_name: req.user.name
        });
      });
    }

    res.json({
      success: true,
      request: groupRequest,
      message: 'Group request submitted successfully'
    });

  } catch (error) {
    console.error('Error creating group request:', error);
    res.status(500).json({ error: 'Failed to create group request: ' + error.message });
  }
});

// Get customer group requests - ENHANCED with booking counts
router.get('/group-requests', authMiddleware, permit('customer'), async (req, res) => {
  try {
    const customerId = req.user.id;

    const requests = await db.query(`
      SELECT 
        cr.*,
        s.name as skill_name,
        b.name as broker_name,
        b.mobile_number as broker_mobile,
        COUNT(bk.id) as assigned_providers_count
      FROM customer_requests cr
      LEFT JOIN skills s ON cr.skill_id = s.id
      LEFT JOIN users b ON cr.broker_id = b.id
      LEFT JOIN bookings bk ON bk.group_request_id = cr.id
      WHERE cr.customer_id = $1
      GROUP BY cr.id, s.name, b.name, b.mobile_number
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

// ✅ ENHANCED: Complete group request - UPDATES ALL RELATED BOOKINGS
router.post('/group-requests/:id/complete', authMiddleware, permit('customer'), async (req, res) => {
  try {
    const requestId = req.params.id;
    const customerId = req.user.id;

    console.log(`Completing group request ${requestId} for customer ${customerId}`);

    // Verify ownership
    const requestCheck = await db.query(
      `SELECT * FROM customer_requests WHERE id = $1 AND customer_id = $2`,
      [requestId, customerId]
    );

    if (requestCheck.rowCount === 0) {
      return res.status(404).json({
        error: 'Group request not found or access denied'
      });
    }

    // Start transaction to update both customer_requests and bookings
    const client = await db.connect();

    try {
      await client.query('BEGIN');

      // 1. Update group request status
      const result = await client.query(`
        UPDATE customer_requests 
        SET status = 'completed', completed_at = NOW()
        WHERE id = $1 AND customer_id = $2
        RETURNING *
      `, [requestId, customerId]);

      // 2. Update ALL related bookings
      const bookingsUpdate = await client.query(`
        UPDATE bookings 
        SET status = 'COMPLETED'
        WHERE group_request_id = $1 AND customer_id = $2
        RETURNING *
      `, [requestId, customerId]);

      await client.query('COMMIT');

      const io = req.app.locals.io;

      // Notify all providers in the group
      for (const booking of bookingsUpdate.rows) {
        if (booking.provider_id) {
          io.to(`user_${booking.provider_id}`).emit('booking_status', { booking });
          await db.query(
            'INSERT INTO notifications (user_id, message) VALUES ($1, $2)',
            [booking.provider_id, `Customer marked group booking #${requestId} as completed.`]
          );
        }
      }

      res.json({
        success: true,
        message: 'Group request and all related bookings marked as completed',
        request: result.rows[0],
        updated_bookings_count: bookingsUpdate.rowCount
      });

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

  } catch (err) {
    console.error('Error completing group request:', err);
    res.status(500).json({ error: 'Failed to complete group request: ' + err.message });
  }
});

// ✅ ENHANCED: Cancel group request - UPDATES ALL RELATED BOOKINGS
router.post('/group-requests/:id/cancel', authMiddleware, permit('customer'), async (req, res) => {
  try {
    const requestId = req.params.id;
    const customerId = req.user.id;

    // Verify ownership
    const requestCheck = await db.query(
      `SELECT * FROM customer_requests WHERE id = $1 AND customer_id = $2`,
      [requestId, customerId]
    );

    if (requestCheck.rowCount === 0) {
      return res.status(404).json({ error: 'Group request not found or access denied' });
    }

    // Start transaction
    const client = await db.connect();

    try {
      await client.query('BEGIN');

      // 1. Update group request status
      const result = await client.query(`
        UPDATE customer_requests 
        SET status = 'cancelled' 
        WHERE id = $1 AND customer_id = $2
        RETURNING *
      `, [requestId, customerId]);

      // 2. Update ALL related bookings
      const bookingsUpdate = await client.query(`
        UPDATE bookings 
        SET status = 'CANCELLED'
        WHERE group_request_id = $1 AND customer_id = $2
        RETURNING *
      `, [requestId, customerId]);

      await client.query('COMMIT');

      const io = req.app.locals.io;

      for (const booking of bookingsUpdate.rows) {
        if (booking.provider_id) {
          io.to(`user_${booking.provider_id}`).emit('booking_status', { booking });
          await db.query(
            'INSERT INTO notifications (user_id, message) VALUES ($1, $2)',
            [booking.provider_id, `Customer cancelled group booking #${requestId}.`]
          );
        }
      }

      res.json({
        success: true,
        message: 'Group request and all related bookings cancelled successfully',
        request: result.rows[0],
        cancelled_bookings_count: bookingsUpdate.rowCount
      });

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

  } catch (error) {
    console.error('Error cancelling group request:', error);
    res.status(500).json({ error: 'Failed to cancel group request: ' + error.message });
  }
});

// ✅ ENHANCED: Get group request details with related bookings
router.get('/group-requests/:id', authMiddleware, permit('customer'), async (req, res) => {
  try {
    const requestId = req.params.id;
    const customerId = req.user.id;

    const request = await db.query(`
      SELECT 
        cr.*,
        s.name as skill_name,
        b.name as broker_name,
        b.mobile_number as broker_mobile
      FROM customer_requests cr
      LEFT JOIN skills s ON cr.skill_id = s.id
      LEFT JOIN users b ON cr.broker_id = b.id
      WHERE cr.id = $1 AND cr.customer_id = $2
    `, [requestId, customerId]);

    if (request.rowCount === 0) {
      return res.status(404).json({ error: 'Group request not found' });
    }

    // Get all related bookings
    const bookings = await db.query(`
      SELECT 
        bk.*,
        p.name as provider_name,
        p.mobile_number as provider_mobile
      FROM bookings bk
      LEFT JOIN users p ON bk.provider_id = p.id
      WHERE bk.group_request_id = $1
      ORDER BY bk.created_at DESC
    `, [requestId]);

    res.json({
      success: true,
      request: request.rows[0],
      bookings: bookings.rows
    });

  } catch (error) {
    console.error('Error fetching group request details:', error);
    res.status(500).json({ error: 'Failed to fetch group request details: ' + error.message });
  }
});

// Customer: search providers (wrapper) - keeps future place for caching / filters
router.get('/providers', authMiddleware, permit('customer'), async (req, res) => {
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
    const { latitude, longitude, accuracy } = req.body;

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
      [lat,
        lng,
        JSON.stringify({
          lat: lat, lng: lng, accuracy: accuracy || null,
          updated_at: new Date().toISOString()
        }),
        parseInt(userId)]
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

// Customer: mark booking complete - UPDATED to handle group_request_id
router.post('/bookings/:id/complete', authMiddleware, permit('customer'), async (req, res) => {
  const bookingId = req.params.id;
  const userId = req.user.id;
  try {
    // Get booking details including group_request_id
    const b = await db.query(
      `SELECT * FROM bookings WHERE id=$1 AND customer_id=$2`,
      [bookingId, userId]
    );

    if (b.rowCount === 0) return res.status(404).json({ error: 'Booking not found' });

    const booking = b.rows[0];
    const io = req.app.locals.io;

    // If this is a group booking, complete the entire group
    if (booking.group_request_id) {
      // Use the enhanced group completion endpoint
      const groupResult = await db.query(`
        UPDATE customer_requests 
        SET status = 'completed', completed_at = NOW()
        WHERE id = $1 AND customer_id = $2
        RETURNING *
      `, [booking.group_request_id, userId]);

      if (groupResult.rowCount === 0) {
        return res.status(404).json({ error: 'Group request not found' });
      }

      // Update all bookings in the group
      const bookingsUpdate = await db.query(`
        UPDATE bookings 
        SET status = 'COMPLETED'
        WHERE group_request_id = $1 AND customer_id = $2
        RETURNING *
      `, [booking.group_request_id, userId]);

      // Notify all providers
      for (const groupBooking of bookingsUpdate.rows) {
        if (groupBooking.provider_id) {
          io.to(`user_${groupBooking.provider_id}`).emit('booking_status', { booking: groupBooking });
          await db.query(
            'INSERT INTO notifications (user_id, message) VALUES ($1,$2)',
            [groupBooking.provider_id, `Customer marked group booking #${booking.group_request_id} as completed.`]
          );
        }
      }

      return res.json({
        success: true,
        group_completed: true,
        updated_bookings_count: bookingsUpdate.rowCount,
        booking: booking
      });
    }

    // Individual booking completion
    await db.query("UPDATE bookings SET status='COMPLETED' WHERE id=$1", [bookingId]);
    const updatedBooking = (await db.query('SELECT * FROM bookings WHERE id=$1', [bookingId])).rows[0];

    // Notify provider
    if (updatedBooking.provider_id) {
      io.to(`user_${updatedBooking.provider_id}`).emit('booking_status', { booking: updatedBooking });
      await db.query(
        'INSERT INTO notifications (user_id, message) VALUES ($1,$2)',
        [updatedBooking.provider_id, `Customer marked booking #${bookingId} as completed.`]
      );
    }

    res.json({
      success: true,
      group_completed: false,
      booking: updatedBooking
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});
// Fix the group completion endpoint to update provider bookings
// Fix the group completion endpoint to update provider bookings
// router.post('/bookings/:id/group-complete', async (req, res) => {
//   try {
//     const bookingId = req.params.id;

//     // 1. Get the main group booking details from customer_requests
//     const mainBooking = await db.query(
//       `SELECT * FROM customer_requests WHERE id = ?`,
//       [bookingId]
//     );

//     if (!mainBooking.length) {
//       return res.status(404).json({ error: 'Booking not found' });
//     }

//     const groupId = mainBooking[0].group_id;

//     if (!groupId) {
//       return res.status(400).json({ error: 'This is not a group booking' });
//     }

//     // 2. Update ALL provider bookings in the bookings table for this group
//     const updateProviderBookings = await db.query(
//       `UPDATE bookings 
//        SET status = 'COMPLETED', 
//            group_request_id = ?,
//            completed_at = NOW()
//        WHERE customer_request_id = ? 
//        AND status IN ('PENDING', 'ACCEPTED', 'IN_PROGRESS')`,
//       [bookingId, bookingId]  // Set group_request_id to main booking ID
//     );

//     // 3. Also update the main customer request if not already completed
//     const updateMainBooking = await db.query(
//       `UPDATE customer_requests 
//        SET status = 'completed', 
//            completed_at = NOW()
//        WHERE id = ? AND status != 'completed'`,
//       [bookingId]
//     );

//     // 4. Update provider availability
//     const providers = await db.query(
//       `SELECT provider_id FROM bookings WHERE customer_request_id = ? AND provider_id IS NOT NULL`,
//       [bookingId]
//     );

//     for (const provider of providers) {
//       await db.query(
//         `UPDATE providers SET is_available = true WHERE id = ?`,
//         [provider.provider_id]
//       );
//     }

//     res.json({
//       success: true,
//       message: 'Group booking completed successfully',
//       updated_provider_bookings: updateProviderBookings.affectedRows,
//       providers_freed: providers.length
//     });

//   } catch (error) {
//     console.error('Group completion error:', error);
//     res.status(500).json({ error: 'Failed to complete group booking' });
//   }
// });
// Provider: get customer location
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

// Get customer details
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