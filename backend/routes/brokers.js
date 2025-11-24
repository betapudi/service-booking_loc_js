// backend/routes/brokers.js
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

    await db.query(`CREATE INDEX IF NOT EXISTS idx_group_requests_broker ON customer_requests(broker_id)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_group_requests_customer ON customer_requests(customer_id)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_group_requests_skill ON customer_requests(skill_id)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_group_requests_status ON customer_requests(status)`);

    res.json({ success: true, message: 'Customer requests table created successfully' });
  } catch (error) {
    console.error('Error creating customer_requests table:', error);
    res.status(500).json({ error: 'Failed to create table: ' + error.message });
  }
});
// Broker: register provider with skill validation
router.post('/register-provider', authMiddleware, permit('broker'), async (req, res) => {
  try {
    const brokerId = req.user.id;
    const { name, mobile_number, location_id, skills } = req.body;

    if (!mobile_number || !/^\d{10}$/.test(String(mobile_number))) {
      return res.status(400).json({ error: 'Invalid mobile number (expected 10 digits)' });
    }

    const exists = await db.query('SELECT id FROM users WHERE mobile_number=$1', [mobile_number]);
    if (exists.rowCount > 0) {
      return res.status(400).json({ error: 'Provider already exists with this mobile number' });
    }

    const providerResult = await db.query(
      `INSERT INTO users (mobile_number, role, name, location_id, registered_by_broker, is_verified)
       VALUES ($1, 'provider', $2, $3, $4, false) RETURNING *`,
      [mobile_number, name || null, location_id || null, brokerId]
    );
    const provider = providerResult.rows[0];
    
    const io = req.app.locals.io;

    // ✅ Emit standardized event
    io.emit("user_registered", {
      id: provider.id,
      name: provider.name,
      role: "provider",
      mobile_number: provider.mobile_number,
      is_verified: provider.is_verified,
      registered_by_broker: brokerId
    });

    if (Array.isArray(skills) && skills.length > 0) {
      for (const skillId of skills) {
        try {
          const skillCheck = await db.query('SELECT id FROM skills WHERE id = $1', [skillId]);
          if (skillCheck.rowCount > 0) {
            await db.query(
              'INSERT INTO provider_skills (user_id, skill_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
              [provider.id, skillId]
            );
          }
        } catch (err) {
          console.error('Skill insert error:', err);
        }
      }
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60000);
    await db.query(
      'INSERT INTO otps (mobile_number, otp, expires_at) VALUES ($1, $2, $3)',
      [mobile_number, otp, expiresAt]
    );

    const fullProvider = await db.query(`
      SELECT 
        u.*, 
        COALESCE(ARRAY_AGG(DISTINCT s.name) FILTER (WHERE s.name IS NOT NULL), ARRAY[]::varchar[]) AS skills,
        l.name AS location_name
      FROM users u
      LEFT JOIN provider_skills ps ON u.id = ps.user_id
      LEFT JOIN skills s ON ps.skill_id = s.id
      LEFT JOIN locations l ON u.location_id = l.id
      WHERE u.id = $1
      GROUP BY u.id, l.name
    `, [provider.id]);

    res.json({ success: true, provider: fullProvider.rows[0], otp });
  } catch (err) {
    console.error('Provider registration failed:', err);
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

// Broker: verify provider OTP
router.post('/verify-provider-otp', authMiddleware, permit('broker'), async (req, res) => {
  try {
    const { mobile, otp } = req.body;
    const r = await db.query(`
      SELECT * FROM otps 
      WHERE mobile_number=$1 AND otp=$2 AND used=false AND expires_at > now()
      ORDER BY id DESC LIMIT 1
    `, [mobile, otp]);

    if (r.rowCount === 0) {
      return res.status(400).json({ error: 'Invalid or expired OTP' });
    }

    const otpRow = r.rows[0];
    await db.query('UPDATE otps SET used=true WHERE id=$1', [otpRow.id]);
    await db.query('UPDATE users SET is_verified=true WHERE mobile_number=$1', [mobile]);
    const provider = updated.rows[0];

    // ✅ Emit socket events
    const io = req.app.locals.io;
    // ✅ Emit standardized event
    io.emit("user_registered", {
      id: provider.id,
      name: provider.name,
      role: "provider",
      mobile_number: provider.mobile_number,
      is_verified: provider.is_verified,
      verified_by_broker: req.user.id
    });
    res.json({ success: true, message: 'Provider verified successfully' });
  } catch (err) {
    console.error('OTP verification failed:', err);
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

router.get('/providers', authMiddleware, permit('broker'), async (req, res) => {
  try {
    const brokerId = req.user.id;

    console.log(`Fetching providers for broker: ${brokerId}`);

    const providersResult = await db.query(`
      SELECT 
        u.id,
        u.name,
        u.mobile_number,
        u.is_verified,
        u.location_id,
        u.created_at,
        COALESCE(
          ARRAY_AGG(DISTINCT s.name) FILTER (WHERE s.name IS NOT NULL),
          ARRAY[]::varchar[]
        ) as skills,
        l.name as location_name,
        COUNT(b.id) as total_bookings
      FROM users u
      LEFT JOIN provider_skills ps ON u.id = ps.user_id
      LEFT JOIN skills s ON ps.skill_id = s.id
      LEFT JOIN locations l ON u.location_id = l.id
      LEFT JOIN bookings b ON u.id = b.provider_id
      WHERE u.registered_by_broker = $1
        AND u.role = 'provider'
      GROUP BY u.id, u.name, u.mobile_number, l.name
      ORDER BY u.name
    `, [brokerId]);

    console.log(`Found ${providersResult.rows.length} providers for broker ${brokerId}`);

    // Log skills for debugging
    providersResult.rows.forEach(provider => {
      console.log(`Provider ${provider.name}: Skills =`, provider.skills);
    });

    res.json({
      success: true,
      providers: providersResult.rows
    });
  } catch (err) {
    console.error('Error fetching providers:', err);
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});
// Customer: create a group request
router.post('/customer-request', async (req, res) => {
  try {
    const {
      customer_id,
      broker_id,
      skill_id,
      provider_count,
      description,
      location_details,
      preferred_date,
      budget_range
    } = req.body;

    const request = await db.query(`
      INSERT INTO customer_requests (
        customer_id, broker_id, skill_id, provider_count, description,
        location_details, preferred_date, budget_range, status
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending')
      RETURNING *
    `, [
      customer_id,
      broker_id,
      skill_id,
      provider_count,
      description,
      location_details,
      preferred_date,
      budget_range
    ]);

    res.json({ success: true, request: request.rows[0] });
  } catch (error) {
    console.error('Error creating customer request:', error);
    res.status(500).json({ error: 'Failed to create request' });
  }
});

// Customer: fetch available brokers
router.get('/available', async (req, res) => {
  try {
    const brokers = await db.query(`
      SELECT id, name, mobile_number, is_verified, created_at
      FROM users
      WHERE role = 'broker' AND is_verified = true
      ORDER BY name
    `);

    res.json({ success: true, brokers: brokers.rows });
  } catch (error) {
    console.error('Error fetching brokers:', error);
    res.status(500).json({ error: 'Failed to fetch brokers' });
  }
});

// Broker: fetch group requests with matching providers
router.get('/group-requests', authMiddleware, permit('broker'), async (req, res) => {
  try {
    const brokerId = req.user.id;

    const requests = await db.query(`
      SELECT 
        cr.*,
        c.name AS customer_name,
        c.mobile_number AS customer_mobile,
        s.name AS skill_name,
        s.id AS skill_id,
        cr.created_at,
        CASE 
          WHEN cr.broker_id = $1 THEN 'assigned'
          WHEN cr.broker_id IS NULL THEN 'available'
          ELSE 'taken'
        END AS request_status
      FROM customer_requests cr
      LEFT JOIN users c ON cr.customer_id = c.id
      LEFT JOIN skills s ON cr.skill_id = s.id
      WHERE (cr.broker_id = $1 OR cr.broker_id IS NULL)
        AND cr.status = 'pending'
      ORDER BY 
        CASE WHEN cr.broker_id = $1 THEN 0 ELSE 1 END,
        cr.created_at DESC
    `, [brokerId]);

    const requestsWithProviders = await Promise.all(
      requests.rows.map(async (request) => {
        if (!request.skill_id) {
          console.warn(`Request ${request.id} missing skill_id`);
          return { ...request, matching_providers: [], matching_provider_count: 0 };
        }

        try {
          const matchingProviders = await db.query(`
            SELECT 
              u.id, u.name, u.mobile_number,
              COALESCE(
                ARRAY_AGG(DISTINCT s.name) FILTER (WHERE s.name IS NOT NULL),
                ARRAY[]::varchar[]
              ) AS skills
            FROM users u
            LEFT JOIN provider_skills ps ON u.id = ps.user_id
            LEFT JOIN skills s ON ps.skill_id = s.id
            WHERE u.registered_by_broker = $1
              AND u.role = 'provider'
              AND ps.skill_id = $2
            GROUP BY u.id
          `, [brokerId, request.skill_id]);

          return {
            ...request,
            matching_providers: matchingProviders.rows,
            matching_provider_count: matchingProviders.rowCount
          };
        } catch (err) {
          console.error(`Error matching providers for request ${request.id}:`, err);
          return { ...request, matching_providers: [], matching_provider_count: 0 };
        }
      })
    );

    res.json({ success: true, requests: requestsWithProviders });
  } catch (error) {
    console.error('Error fetching group requests:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch group requests: ' + error.message });
  }
});

// Broker: accept a customer request and create bookings
router.post('/customer-requests/:id/accept', authMiddleware, permit('broker'), async (req, res) => {
  const requestId = req.params.id;
  const brokerId = req.user.id;
  const { provider_ids, total_amount } = req.body;

  try {
    const reqResult = await db.query(`
      SELECT cr.*, s.name AS skill_name, u.name AS customer_name
      FROM customer_requests cr
      LEFT JOIN users u ON cr.customer_id = u.id
      LEFT JOIN skills s ON cr.skill_id = s.id
      WHERE cr.id = $1 AND cr.status = 'pending'
    `, [requestId]);

    if (reqResult.rowCount === 0) {
      return res.status(404).json({ error: 'Request not available or already taken' });
    }

    const request = reqResult.rows[0];

    await db.query(`
      UPDATE customer_requests 
      SET broker_id = $1, status = 'accepted', accepted_at = NOW()
      WHERE id = $2
    `, [brokerId, requestId]);

    const amountPerProvider = total_amount && provider_ids.length > 0
      ? total_amount / provider_ids.length
      : 0;

    const createdBookings = [];
    for (const providerId of provider_ids) {
      const metadata = {
        group_booking: true,
        original_request_id: request.id,
        provider_count: provider_ids.length,
        skill_required: request.skill_name,
        description: request.description,
        location_details: request.location_details,
        budget_range: request.budget_range,
        broker_id: brokerId,
        is_group_booking: true,
        provider_id: providerId,
        customer_name: request.customer_name
      };

      const booking = await db.query(`
        INSERT INTO bookings (
          customer_id, provider_id, broker_id, total_amount, status, metadata, created_at,group_request_id
        ) VALUES ($1,$2,$3,$4,'ACCEPTED',$5,NOW(),$6)
        RETURNING *
      `, [request.customer_id, providerId, brokerId, amountPerProvider, JSON.stringify(metadata), request.id]);

      createdBookings.push(booking.rows[0]);
    }

    const io = req.app.locals.io;
    if (io) {
      io.to(`user_${request.customer_id}`).emit('group_request_accepted', {
        request_id: request.id,
        broker_name: req.user.name,
        booking_count: createdBookings.length,
        message: `Broker ${req.user.name} accepted your request and created ${createdBookings.length} bookings`
      });

      for (const b of createdBookings) {
        io.to(`user_${b.provider_id}`).emit('new_booking', {
          booking: b,
          is_group_booking: true
        });
      }
    }

    res.json({
      success: true,
      request,
      bookings: createdBookings,
      message: 'Group request accepted and bookings created successfully'
    });
  } catch (error) {
    console.error('Error accepting customer request:', error);
    res.status(500).json({ error: 'Failed to accept group request: ' + error.message });
  }
});

// Broker: manually create group booking from accepted request
router.post('/group-requests/:id/create-booking', authMiddleware, permit('broker'), async (req, res) => {
  try {
    const { id } = req.params;
    const { provider_ids, total_amount, additional_notes } = req.body;
    const brokerId = req.user.id;

    const requestRes = await db.query(`
      SELECT cr.*, s.name AS skill_name, u.name AS customer_name
      FROM customer_requests cr
      LEFT JOIN users u ON cr.customer_id = u.id
      LEFT JOIN skills s ON cr.skill_id = s.id
      WHERE cr.id = $1
    `, [id]);

    if (requestRes.rowCount === 0) {
      return res.status(404).json({ error: 'Group request not found' });
    }

    const request = requestRes.rows[0];
    const createdBookings = [];

    for (const providerId of provider_ids) {
      const meta = {
        group_booking: true,
        original_request_id: id,
        skill_required: request.skill_name,
        description: request.description,
        broker_id: brokerId,
        is_group_booking: true,
        customer_name: request.customer_name,
        additional_notes
      };

      const r = await db.query(`
        INSERT INTO bookings (
          customer_id, provider_id, broker_id, total_amount, status, metadata, created_at, group_request_id
        ) VALUES ($1,$2,$3,$4,'ACCEPTED',$5,NOW(),$6)
        RETURNING *
      `, [
        request.customer_id,
        providerId,
        brokerId,
        total_amount / provider_ids.length,
        JSON.stringify(meta),
        request.id || null
      ]);

      createdBookings.push(r.rows[0]);
    }

    await db.query(`UPDATE customer_requests SET status='accepted' WHERE id=$1`, [id]);

    const io = req.app.locals.io;
    if (io) {
      io.to(`user_${request.customer_id}`).emit('group_booking_created', {
        request_id: id,
        booking_count: createdBookings.length,
        message: `Group booking created with ${createdBookings.length} providers`
      });

      createdBookings.forEach(b => {
        io.to(`user_${b.provider_id}`).emit('new_booking', { booking: b });
      });
    }

    res.json({
      success: true,
      message: `Created ${createdBookings.length} bookings`,
      bookings: createdBookings
    });
  } catch (err) {
    console.error('Error creating group booking:', err);
    res.status(500).json({ error: 'Failed to create group booking: ' + err.message });
  }
});

// Broker or Customer: cancel group booking and related bookings
router.post('/group-bookings/:id/cancel', authMiddleware, permit('broker', 'customer'), async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    const requestUpdate = await db.query(`
      UPDATE customer_requests 
      SET status = 'cancelled', updated_at = NOW()
      WHERE id = $1 
      AND (customer_id = $2 OR broker_id = $2 OR $3 = 'admin')
      RETURNING *
    `, [id, userId, userRole]);

    if (requestUpdate.rowCount === 0) {
      return res.status(404).json({ error: 'Request not found or access denied' });
    }

    const customerRequest = requestUpdate.rows[0];

    const bookingsUpdate = await db.query(`
      UPDATE bookings 
      SET status = 'CANCELLED', updated_at = NOW()
      WHERE group_request_id = $1
      RETURNING *
    `, [id, customerRequest.broker_id, customerRequest.customer_id]);

    const io = req.app.locals.io;
    if (io) {
      io.to(`user_${customerRequest.customer_id}`).emit('group_request_cancelled', {
        request_id: id,
        message: 'Group booking has been cancelled',
        cancelled_bookings: bookingsUpdate.rowCount
      });

      if (customerRequest.broker_id) {
        io.to(`user_${customerRequest.broker_id}`).emit('group_request_cancelled', {
          request_id: id,
          message: 'Group booking has been cancelled by customer',
          cancelled_bookings: bookingsUpdate.rowCount
        });
      }

      bookingsUpdate.rows.forEach(booking => {
        if (booking.provider_id) {
          io.to(`user_${booking.provider_id}`).emit('booking_cancelled', {
            booking_id: booking.id,
            message: 'Booking has been cancelled'
          });
        }
      });
    }

    res.json({
      success: true,
      message: `Group booking cancelled successfully. ${bookingsUpdate.rowCount} bookings cancelled.`,
      cancelled_request: customerRequest,
      cancelled_bookings: bookingsUpdate.rows
    });
  } catch (error) {
    console.error('Error cancelling group booking:', error);
    res.status(500).json({ error: 'Failed to cancel group booking: ' + error.message });
  }
});

// Broker: list all group bookings created by this broker
// router.get('/group-bookings', authMiddleware, permit('broker'), async (req, res) => {
//   try {
//     const brokerId = req.user.id;

//     const bookings = await db.query(`
//       SELECT 
//         b.*,
//         c.name AS customer_name,
//         c.mobile_number AS customer_mobile,
//         p.name AS provider_name,
//         p.mobile_number AS provider_mobile,
//         b.metadata->>'group_booking' AS is_group_booking,
//         b.metadata->>'original_request_id' AS original_request_id,
//         b.metadata->>'provider_count' AS provider_count,
//         b.metadata->>'skill_required' AS skill_required,
//         b.metadata->>'description' AS job_description,
//         b.created_at
//       FROM bookings b
//       JOIN users c ON b.customer_id = c.id
//       JOIN users p ON b.provider_id = p.id
//       WHERE b.broker_id = $1 
//         AND b.metadata->>'group_booking' = 'true'
//       ORDER BY b.created_at DESC
//     `, [brokerId]);

//     const groupedBookings = {};
//     bookings.rows.forEach(booking => {
//       const requestId = booking.original_request_id || `manual_${booking.id}`;
//       if (!groupedBookings[requestId]) {
//         groupedBookings[requestId] = {
//           request_id: requestId,
//           customer_name: booking.customer_name,
//           provider_count: booking.provider_count,
//           skill_required: booking.skill_required,
//           description: booking.job_description,
//           created_at: booking.created_at,
//           bookings: []
//         };
//       }
//       groupedBookings[requestId].bookings.push({
//         booking_id: booking.id,
//         provider_name: booking.provider_name,
//         provider_mobile: booking.provider_mobile,
//         total_amount: booking.total_amount,
//         status: booking.status
//       });
//     });

//     res.json({
//       success: true,
//       grouped_bookings: Object.values(groupedBookings)
//     });
//   } catch (error) {
//     console.error('Error fetching group bookings:', error);
//     res.status(500).json({ error: 'Failed to fetch group bookings: ' + error.message });
//   }
// });
// backend/routes/brokers.js (or wherever your broker routes live)
router.get('/group-bookings', authMiddleware, permit('broker'), async (req, res) => {
  try {
    const brokerId = req.user.id;

    const bookings = await db.query(`
      SELECT 
        b.id,
        b.group_request_id,
        b.customer_id,
        b.provider_id,
        b.total_amount,
        b.status,
        b.created_at,
        c.name AS customer_name,
        c.mobile_number AS customer_mobile,
        p.name AS provider_name,
        p.mobile_number AS provider_mobile,
        b.metadata->>'provider_count' AS provider_count,
        b.metadata->>'skill_required' AS skill_required,
        b.metadata->>'description' AS job_description
      FROM bookings b
      JOIN users c ON b.customer_id = c.id
      JOIN users p ON b.provider_id = p.id
      WHERE b.broker_id = $1 
        AND b.group_request_id IS NOT NULL
      ORDER BY b.created_at DESC
    `, [brokerId]);

    const groupedBookings = {};
    bookings.rows.forEach(booking => {
      const requestId = booking.group_request_id || `manual_${booking.id}`;
      if (!groupedBookings[requestId]) {
        groupedBookings[requestId] = {
          request_id: requestId,
          customer_name: booking.customer_name,
          provider_count: booking.provider_count,
          skill_required: booking.skill_required,
          description: booking.job_description,
          created_at: booking.created_at,
          bookings: []
        };
      }
      groupedBookings[requestId].bookings.push({
        booking_id: booking.id,
        provider_name: booking.provider_name,
        provider_mobile: booking.provider_mobile,
        total_amount: booking.total_amount,
        status: booking.status
      });
    });

    res.json({
      success: true,
      grouped_bookings: Object.values(groupedBookings)
    });
  } catch (error) {
    console.error('Error fetching group bookings:', error);
    res.status(500).json({ error: 'Failed to fetch group bookings: ' + error.message });
  }
});

module.exports = router