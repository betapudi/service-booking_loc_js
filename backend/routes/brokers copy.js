const express = require('express');
const router = express.Router();
const db = require('../db');
const { authMiddleware, permit } = require('../helpers/auth');

// Create customer_requests table if it doesn't exist (matching actual schema)
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
      CREATE INDEX IF NOT EXISTS idx_group_requests_broker 
      ON customer_requests(broker_id)
    `);

    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_group_requests_customer 
      ON customer_requests(customer_id)
    `);

    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_group_requests_skill 
      ON customer_requests(skill_id)
    `);

    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_group_requests_status 
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

// Broker: register provider
// router.post('/register-provider', authMiddleware, permit('broker'), async (req, res) => {
//   try {
//     const brokerId = req.user.id;
//     const { mobile, name, location_id, skills } = req.body;

//     if (!mobile || !/^\d{10}$/.test(String(mobile))) {
//       return res.status(400).json({ error: 'Invalid mobile number (expected 10 digits)' });
//     }

//     const exists = await db.query('SELECT id FROM users WHERE mobile_number=$1', [mobile]);
//     if (exists.rowCount > 0) return res.status(400).json({ error: 'Provider already exists' });

//     const r = await db.query(
//       `INSERT INTO users (mobile_number, role, name, location_id, registered_by_broker, is_verified)
//        VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
//       [mobile, 'provider', name || null, location_id || null, brokerId, false]
//     );
//     const provider = r.rows[0];

//     // insert skills (support skill ids, names, or objects)
//     if (Array.isArray(skills) && skills.length > 0) {
//       for (const s of skills) {
//         try {
//           let skillId = null;

//           // if skill is numeric or numeric-string treat as id
//           if (typeof s === 'number' || (typeof s === 'string' && /^\d+$/.test(s))) {
//             const sk = await db.query('SELECT id FROM skills WHERE id = $1', [Number(s)]);
//             if (sk.rowCount > 0) skillId = sk.rows[0].id;
//             // if id doesn't exist, skip (can't create from id)
//             if (!skillId) continue;
//           } else if (typeof s === 'object' && s !== null) {
//             // object may be { id, name }
//             if (s.id) {
//               const sk = await db.query('SELECT id FROM skills WHERE id = $1', [s.id]);
//               if (sk.rowCount > 0) skillId = sk.rows[0].id;
//             }
//             if (!skillId && s.name) {
//               const nameVal = String(s.name).trim();
//               const sk = await db.query('SELECT id FROM skills WHERE lower(name) = lower($1)', [nameVal]);
//               if (sk.rowCount === 0) {
//                 const ins = await db.query('INSERT INTO skills (name) VALUES ($1) RETURNING id', [nameVal]);
//                 skillId = ins.rows[0].id;
//               } else {
//                 skillId = sk.rows[0].id;
//               }
//             }
//           } else if (typeof s === 'string') {
//             const nameVal = s.trim();
//             if (!nameVal) continue;
//             const sk = await db.query('SELECT id FROM skills WHERE lower(name) = lower($1)', [nameVal]);
//             if (sk.rowCount === 0) {
//               const ins = await db.query('INSERT INTO skills (name) VALUES ($1) RETURNING id', [nameVal]);
//               skillId = ins.rows[0].id;
//             } else {
//               skillId = sk.rows[0].id;
//             }
//           }

//           if (skillId) {
//             await db.query(
//               'INSERT INTO provider_skills (user_id, skill_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
//               [provider.id, skillId]
//             );
//           }
//         } catch (innerErr) {
//           console.error('Error processing skill for provider registration:', innerErr);
//           // continue with other skills
//         }
//       }
//     }

//     // send OTP (mock)
//     const otp = Math.floor(100000 + Math.random() * 900000).toString();
//     const expiresAt = new Date(Date.now() + 10 * 60000);
//     await db.query('INSERT INTO otps (mobile_number, otp, expires_at) VALUES ($1,$2,$3)', [mobile, otp, expiresAt]);

//     res.json({ provider, otp });
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: 'Server error' });
//   }
// });
// Broker: register provider - FIXED skills handling
router.post('/register-provider', authMiddleware, permit('broker'), async (req, res) => {
  try {
    const brokerId = req.user.id;
    const { name, mobile_number, location_id, skills } = req.body;

    console.log('Registering provider with data:', { name, mobile_number, location_id, skills });

    if (!mobile_number || !/^\d{10}$/.test(String(mobile_number))) {
      return res.status(400).json({ error: 'Invalid mobile number (expected 10 digits)' });
    }

    // Check if provider already exists
    const exists = await db.query('SELECT id FROM users WHERE mobile_number=$1', [mobile_number]);
    if (exists.rowCount > 0) {
      return res.status(400).json({ error: 'Provider already exists with this mobile number' });
    }

    // Insert provider
    const providerResult = await db.query(
      `INSERT INTO users (mobile_number, role, name, location_id, registered_by_broker, is_verified)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [mobile_number, 'provider', name || null, location_id || null, brokerId, false]
    );
    const provider = providerResult.rows[0];

    console.log('Provider registered, ID:', provider.id);

    // Insert skills - FIXED
    if (Array.isArray(skills) && skills.length > 0) {
      console.log('Processing skills:', skills);

      for (const skillId of skills) {
        try {
          // Validate skill exists
          const skillCheck = await db.query('SELECT id, name FROM skills WHERE id = $1', [skillId]);

          if (skillCheck.rowCount > 0) {
            // Insert into provider_skills
            await db.query(
              'INSERT INTO provider_skills (user_id, skill_id) VALUES ($1, $2) ON CONFLICT (user_id, skill_id) DO NOTHING',
              [provider.id, skillId]
            );
            console.log(`Added skill ${skillId} to provider ${provider.id}`);
          } else {
            console.warn(`Skill ID ${skillId} not found, skipping`);
          }
        } catch (innerErr) {
          console.error('Error processing skill:', innerErr);
        }
      }
    } else {
      console.log('No skills provided for provider');
    }

    // Get the complete provider data with skills
    const completeProvider = await db.query(`
      SELECT 
        u.*,
        COALESCE(
          ARRAY_AGG(DISTINCT s.name) FILTER (WHERE s.name IS NOT NULL),
          ARRAY[]::varchar[]
        ) as skills,
        l.name as location_name
      FROM users u
      LEFT JOIN provider_skills ps ON u.id = ps.user_id
      LEFT JOIN skills s ON ps.skill_id = s.id
      LEFT JOIN locations l ON u.location_id = l.id
      WHERE u.id = $1
      GROUP BY u.id, l.name
    `, [provider.id]);

    // Send OTP (mock)
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60000);
    await db.query('INSERT INTO otps (mobile_number, otp, expires_at) VALUES ($1,$2,$3)', [mobile_number, otp, expiresAt]);

    res.json({
      success: true,
      provider: completeProvider.rows[0],
      otp
    });
  } catch (err) {
    console.error('Provider registration failed:', err);
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});
// Broker: verify provider OTP (mark provider as verified)
router.post('/verify-provider-otp', authMiddleware, permit('broker'), async (req, res) => {
  try {
    const { mobile, otp } = req.body;
    const r = await db.query('SELECT * FROM otps WHERE mobile_number=$1 AND otp=$2 AND used=false AND expires_at > now() ORDER BY id DESC LIMIT 1', [mobile, otp]);
    if (r.rowCount === 0) return res.status(400).json({ error: 'Invalid or expired OTP' });
    const otpRow = r.rows[0];
    await db.query('UPDATE otps SET used=true WHERE id=$1', [otpRow.id]);
    await db.query('UPDATE users SET is_verified=true WHERE mobile_number=$1', [mobile]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Broker: create group booking (one customer, multiple providers)
router.post('/group-booking', authMiddleware, permit('broker'), async (req, res) => {
  try {
    const { customer_id, provider_ids, location_id, total_amount, metadata } = req.body;
    if (!Array.isArray(provider_ids) || provider_ids.length === 0) return res.status(400).json({ error: 'provider_ids required' });
    // Create bookings per provider
    const created = [];
    for (const pid of provider_ids) {
      const r = await db.query('INSERT INTO bookings (customer_id, provider_id, location_id, total_amount, metadata, broker_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', [customer_id, pid, location_id, total_amount || 0, metadata || {}, req.user.id]);
      const booking = r.rows[0];
      created.push(booking);
      // notify provider
      const io = req.app.locals.io;
      io.to(`user_${pid}`).emit('new_booking', { booking });
      await db.query('INSERT INTO notifications (user_id, message) VALUES ($1,$2)', [pid, `New group booking #${booking.id}`]);
    }
    res.json({ bookings: created });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Broker: list registered providers
// router.get('/providers', authMiddleware, permit('broker'), async (req, res) => {
//   try {
//     const brokerId = req.user.id;
//     const r = await db.query('SELECT * FROM users WHERE registered_by_broker=$1', [brokerId]);
//     res.json({ providers: r.rows });
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: 'Server error' });
//   }
// });
// Broker: list registered providers - FIXED skills retrieval
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

// Create customer request (for customers) - FIXED to match actual schema
router.post('/customer-request', async (req, res) => {
  try {
    const { customer_id, broker_id, skill_id, provider_count, description, location_details, preferred_date, budget_range } = req.body;

    const request = await db.query(`
      INSERT INTO customer_requests 
        (customer_id, broker_id, skill_id, provider_count, description, location_details, preferred_date, budget_range, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
      RETURNING *
    `, [customer_id, broker_id, skill_id, provider_count, description, location_details, preferred_date, budget_range]);

    res.json({
      success: true,
      request: request.rows[0]
    });
  } catch (error) {
    console.error('Error creating customer request:', error);
    res.status(500).json({ error: 'Failed to create request' });
  }
});

// Get providers by skills
router.get('/providers-by-skills', authMiddleware, permit('broker'), async (req, res) => {
  try {
    const brokerId = req.user.id;

    console.log(`Fetching providers for broker: ${brokerId}`);

    const providersResult = await db.query(`
      SELECT 
        u.id,
        u.name,
        u.mobile_number,
        u.is_verified,
        COALESCE(
          ARRAY_AGG(DISTINCT s.name) FILTER (WHERE s.name IS NOT NULL),
          ARRAY[]::varchar[]
        ) as skills,
        COUNT(b.id) as total_bookings,
        u.created_at
      FROM users u
      LEFT JOIN provider_skills ps ON u.id = ps.user_id
      LEFT JOIN skills s ON ps.skill_id = s.id
      LEFT JOIN bookings b ON u.id = b.provider_id
      WHERE u.registered_by_broker = $1
        AND u.role = 'provider'
      GROUP BY u.id, u.name, u.mobile_number
      ORDER BY u.name
    `, [brokerId]);

    console.log(`Found ${providersResult.rows.length} providers for broker ${brokerId}`);

    // Group providers by skill
    const providersBySkill = {};
    providersResult.rows.forEach(provider => {
      const skills = provider.skills || [];
      if (skills.length === 0) {
        // Add to "General" category if no skills
        if (!providersBySkill['General']) {
          providersBySkill['General'] = [];
        }
        providersBySkill['General'].push(provider);
      } else {
        skills.forEach(skill => {
          if (!providersBySkill[skill]) {
            providersBySkill[skill] = [];
          }
          providersBySkill[skill].push(provider);
        });
      }
    });

    res.json({
      success: true,
      providers_by_skill: providersBySkill
    });

  } catch (error) {
    console.error('Error fetching providers by skills:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch providers: ' + error.message
    });
  }
});

// Get customer requests - FIXED to match actual schema
router.get('/customer-requests', authMiddleware, permit('broker'), async (req, res) => {
  try {
    const brokerId = req.user.id;

    const requests = await db.query(`
      SELECT 
        cr.*,
        c.name as customer_name,
        c.mobile_number as customer_mobile,
        s.name as skill_name,
        cr.created_at
      FROM customer_requests cr
      JOIN users c ON cr.customer_id = c.id
      JOIN skills s ON cr.skill_id = s.id
      WHERE (cr.broker_id = $1 OR cr.broker_id IS NULL)
      AND cr.status = 'pending'
      ORDER BY cr.created_at DESC
    `, [brokerId]);

    console.log(`Found ${requests.rows.length} customer requests for broker ${brokerId}`);

    res.json({
      success: true,
      requests: requests.rows
    });

  } catch (error) {
    console.error('Error fetching customer requests:', error);
    res.status(500).json({ error: 'Failed to fetch customer requests: ' + error.message });
  }
});

// Get available brokers for customers
router.get('/available', async (req, res) => {
  try {
    const brokers = await db.query(`
      SELECT id, name, mobile_number, is_verified, created_at
      FROM users 
      WHERE role = 'broker' AND is_verified = true
      ORDER BY name
    `);

    res.json({
      success: true,
      brokers: brokers.rows
    });

  } catch (error) {
    console.error('Error fetching brokers:', error);
    res.status(500).json({ error: 'Failed to fetch brokers' });
  }
});

// MAIN ENDPOINT: Get group requests - FIXED to match actual schema
// MAIN ENDPOINT: Get group requests - FIXED VERSION
// In /brokers/group-requests endpoint, add skill-based provider filtering
router.get('/group-requests', authMiddleware, permit('broker'), async (req, res) => {
  try {
    const brokerId = req.user.id;

    const requests = await db.query(`
      SELECT 
        cr.*,
        c.name as customer_name,
        c.mobile_number as customer_mobile,
        s.name as skill_name,
        s.id as skill_id,
        cr.created_at,
        CASE 
          WHEN cr.broker_id = $1 THEN 'assigned'
          WHEN cr.broker_id IS NULL THEN 'available'
          ELSE 'taken'
        END as request_status
      FROM customer_requests cr
      LEFT JOIN users c ON cr.customer_id = c.id
      LEFT JOIN skills s ON cr.skill_id = s.id
      WHERE (cr.broker_id = $1 OR cr.broker_id IS NULL)
        AND cr.status = 'pending'
      ORDER BY 
        CASE WHEN cr.broker_id = $1 THEN 0 ELSE 1 END,
        cr.created_at DESC
    `, [brokerId]);

    // Get matching providers for each request
    const requestsWithProviders = await Promise.all(
      requests.rows.map(async (request) => {
        const matchingProviders = await db.query(`
          SELECT 
            u.id, u.name, u.mobile_number,
            COALESCE(
              ARRAY_AGG(DISTINCT s.name) FILTER (WHERE s.name IS NOT NULL),
              ARRAY[]::varchar[]
            ) as skills
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
      })
    );

    res.json({
      success: true,
      requests: requestsWithProviders
    });
  } catch (error) {
    console.error('Error fetching group requests:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch group requests: ' + error.message 
    });
  }
});
// MAIN ENDPOINT: Accept customer request - FIXED to use customer_requests table
// MAIN ENDPOINT: Accept customer request - FIXED to create bookings instantly
router.post('/customer-requests/:id/accept', authMiddleware, permit('broker'), async (req, res) => {
  const requestId = req.params.id;
  const brokerId = req.user.id;
  const { provider_ids, total_amount } = req.body;

  try {
    console.log(`Broker ${brokerId} accepting customer request ${requestId}`);

    // 1️⃣ Fetch the pending request
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

    // 2️⃣ Mark the request as accepted
    await db.query(`
      UPDATE customer_requests 
      SET broker_id = $1, status = 'accepted', accepted_at = NOW()
      WHERE id = $2
    `, [brokerId, requestId]);

    // 3️⃣ Create linked bookings for each provider
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
          customer_id, provider_id, broker_id, total_amount, status, metadata, created_at
        ) VALUES ($1,$2,$3,$4,'ACCEPTED',$5,NOW())
        RETURNING *
      `, [request.customer_id, providerId, brokerId, amountPerProvider, JSON.stringify(metadata)]);

      createdBookings.push(booking.rows[0]);
    }

    // 4️⃣ Notify both customer and providers
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


// MAIN ENDPOINT: Create group booking from accepted request - FIXED version
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
        INSERT INTO bookings (customer_id, provider_id, broker_id, total_amount, status, metadata, created_at)
        VALUES ($1,$2,$3,$4,'ACCEPTED',$5,NOW())
        RETURNING *
      `, [
        request.customer_id,
        providerId,
        brokerId,
        total_amount / provider_ids.length,
        JSON.stringify(meta)
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
      createdBookings.forEach(b => io.to(`user_${b.provider_id}`).emit('new_booking', { booking: b }));
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

// NEW ENDPOINT: Cancel group booking and all related bookings
router.post('/group-bookings/:id/cancel', authMiddleware, permit('broker', 'customer'), async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    console.log(`Cancelling group booking request ${id} for ${userRole} ${userId}`);

    // Update customer request status to cancelled
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

    // Cancel all related bookings
    const bookingsUpdate = await db.query(`
      UPDATE bookings 
      SET status = 'CANCELLED', updated_at = NOW()
      WHERE metadata->>'original_request_id' = $1 
         OR metadata->>'customer_request_id' = $1
         OR (broker_id = $2 AND customer_id = $3)
      RETURNING *
    `, [id, customerRequest.broker_id, customerRequest.customer_id]);

    console.log(`Cancelled ${bookingsUpdate.rowCount} related bookings`);

    // Notify all parties
    const io = req.app.locals.io;
    if (io) {
      // Notify customer
      io.to(`user_${customerRequest.customer_id}`).emit('group_request_cancelled', {
        request_id: id,
        message: 'Group booking has been cancelled',
        cancelled_bookings: bookingsUpdate.rowCount
      });

      // Notify broker
      if (customerRequest.broker_id) {
        io.to(`user_${customerRequest.broker_id}`).emit('group_request_cancelled', {
          request_id: id,
          message: 'Group booking has been cancelled by customer',
          cancelled_bookings: bookingsUpdate.rowCount
        });
      }

      // Notify all providers
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
// MAIN ENDPOINT: Get broker's group bookings - NEW ENDPOINT
// In your backend, update the group-bookings endpoint:
// MAIN ENDPOINT: Get broker's group bookings - UPDATED to use metadata
router.get('/group-bookings', authMiddleware, permit('broker'), async (req, res) => {
  try {
    const brokerId = req.user.id;

    console.log(`Fetching group bookings for broker: ${brokerId}`);

    // Get bookings that have group_booking metadata
    const bookings = await db.query(`
      SELECT 
        b.*,
        c.name as customer_name,
        c.mobile_number as customer_mobile,
        p.name as provider_name,
        p.mobile_number as provider_mobile,
        b.metadata->>'group_booking' as is_group_booking,
        b.metadata->>'original_request_id' as original_request_id,
        b.metadata->>'provider_count' as provider_count,
        b.metadata->>'skill_required' as skill_required,
        b.metadata->>'description' as job_description,
        b.created_at
        
      FROM bookings b
      JOIN users c ON b.customer_id = c.id
      JOIN users p ON b.provider_id = p.id
      WHERE b.broker_id = $1 
        AND b.metadata->>'group_booking' = 'true'
      ORDER BY b.created_at DESC
    `, [brokerId]);

    console.log(`Found ${bookings.rows.length} group bookings for broker ${brokerId}`);

    // Group by original request to show as single group bookings
    const groupedBookings = {};
    bookings.rows.forEach(booking => {
      const requestId = booking.original_request_id || `manual_${booking.id}`;
      if (!groupedBookings[requestId]) {
        groupedBookings[requestId] = {
          id: requestId.startsWith('manual_') ? booking.id : requestId,
          customer_name: booking.customer_name,
          customer_mobile: booking.customer_mobile,
          skill_name: booking.skill_required || 'Manual Booking',
          provider_count: parseInt(booking.provider_count) || 1,
          total_amount: 0,
          status: booking.status,
          created_at: booking.created_at,
          is_manual: requestId.startsWith('manual_'),
          bookings: []
        };
      }
      groupedBookings[requestId].bookings.push(booking);
      groupedBookings[requestId].total_amount += parseFloat(booking.total_amount) || 0;
    });

    const result = Object.values(groupedBookings);

    res.json({
      success: true,
      bookings: result,
      total_count: result.length
    });

  } catch (error) {
    console.error('Error fetching group bookings:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch group bookings: ' + error.message
    });
  }
});

// NEW ENDPOINT: Update group booking status
router.put('/group-bookings/:id/status', authMiddleware, permit('broker'), async (req, res) => {
  try {
    const bookingId = req.params.id;
    const brokerId = req.user.id;
    const { status } = req.body;

    const validStatuses = ['pending', 'confirmed', 'in_progress', 'completed', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const result = await db.query(`
      UPDATE bookings 
      SET status = $1, updated_at = NOW()
      WHERE id = $2 AND broker_id = $3
      RETURNING *
    `, [status.toUpperCase(), bookingId, brokerId]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Booking not found or access denied' });
    }

    res.json({
      success: true,
      booking: result.rows[0],
      message: `Booking status updated to ${status}`
    });

  } catch (error) {
    console.error('Error updating booking status:', error);
    res.status(500).json({ error: 'Failed to update booking status: ' + error.message });
  }
});

// NEW ENDPOINT: Decline group request
router.post('/customer-requests/:id/decline', authMiddleware, permit('broker'), async (req, res) => {
  try {
    const requestId = req.params.id;
    const brokerId = req.user.id;

    const result = await db.query(`
      UPDATE customer_requests 
      SET status = 'declined', updated_at = NOW()
      WHERE id = $1 AND (broker_id IS NULL OR broker_id = $2) AND status = 'pending'
      RETURNING *
    `, [requestId, brokerId]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Request not available or already processed' });
    }

    res.json({
      success: true,
      message: 'Group request declined successfully'
    });

  } catch (error) {
    console.error('Error declining group request:', error);
    res.status(500).json({ error: 'Failed to decline group request: ' + error.message });
  }
});

//New endpoint for customers to mark complete
router.post('/customer-requests/:id/complete', authMiddleware, permit('customer'), async (req, res) => {
  const requestId = req.params.id;
  await db.query(`
    UPDATE customer_requests SET status='completed', completed_at=NOW()
    WHERE id=$1 RETURNING *`, [requestId]);
  await db.query(`UPDATE bookings SET status='COMPLETED' WHERE metadata->>'original_request_id'=$1`, [requestId]);
  res.json({ success: true });

  const io = req.app.locals.io;
  if (io) {
    io.to(`user_${res.broker_id}`).emit('booking_completed', { requestId });
  }

});

// NEW ENDPOINT: Create manual group booking
// NEW ENDPOINT: Create manual group booking - FIXED to insert metadata
router.post('/manual-group-booking', authMiddleware, permit('broker'), async (req, res) => {
  try {
    const brokerId = req.user.id;
    const { provider_ids, skill_name, total_amount, description, customer_request_id } = req.body;

    // If customer_request_id is provided, use that customer and update request status
    if (customer_request_id) {
      const requestResult = await db.query(`
        SELECT customer_id FROM customer_requests WHERE id = $1 AND broker_id = $2
      `, [customer_request_id, brokerId]);

      if (requestResult.rowCount === 0) {
        return res.status(404).json({ error: 'Customer request not found' });
      }

      customerId = requestResult.rows[0].customer_id;

      // Update customer request status to 'accepted'
      await db.query(`
        UPDATE customer_requests 
        SET status = 'accepted', accepted_at = NOW() 
        WHERE id = $1
      `, [customer_request_id]);

    } else {
      // For standalone manual booking, get any customer
      const customerResult = await db.query(`
        SELECT id FROM users WHERE role = 'customer' LIMIT 1
      `);
      if (customerResult.rowCount === 0) {
        return res.status(400).json({ error: 'No customer found for manual booking' });
      }
      customerId = customerResult.rows[0].id;
    }

    const individualAmount = total_amount / provider_ids.length;


    // Get provider details for metadata
    const providerDetails = [];
    for (const providerId of provider_ids) {
      const providerResult = await db.query(`
        SELECT u.name, u.mobile_number, 
               ARRAY_AGG(s.name) as skills
        FROM users u
        LEFT JOIN provider_skills ps ON u.id = ps.user_id
        LEFT JOIN skills s ON ps.skill_id = s.id
        WHERE u.id = $1
        GROUP BY u.id, u.name, u.mobile_number
      `, [providerId]);

      if (providerResult.rows.length > 0) {
        providerDetails.push(providerResult.rows[0]);
      }
    }

    const bookings = [];
    for (let i = 0; i < provider_ids.length; i++) {
      const providerId = provider_ids[i];
      const provider = providerDetails[i];

      const metadata = {
        group_booking: true,
        manual_booking: true,
        provider_count: provider_ids.length,
        skill_required: skill_name,
        description: description,
        broker_id: brokerId,
        is_group_booking: true,
        customer_request_id: customer_request_id || null,

        // Standard fields
        provider_name: provider?.name || 'Unknown Provider',
        provider_skills: provider?.skills || ['General Service'],
        group_booking_details: {
          total_providers: provider_ids.length,
          individual_amount: individualAmount,
          skill: skill_name,
          manual_booking: true
        }
      };

      const booking = await db.query(`
        INSERT INTO bookings 
        (customer_id, provider_id, broker_id, total_amount, status, metadata)
        VALUES ($1, $2, $3, $4, 'ACCEPTED', $5)
        RETURNING *
      `, [
        customerId,
        providerId,
        brokerId,
        individualAmount,
        JSON.stringify(metadata)
      ]);

      bookings.push(booking.rows[0]);

      // Notify provider
      const io = req.app.locals.io;
      if (io) {
        io.to(`user_${providerId}`).emit('new_booking', {
          booking: booking.rows[0],
          is_group_booking: true,
          skill_required: skill_name
        });
      }
    }

    // Notify customer if this was from a customer request
    if (customer_request_id && io) {
      io.to(`user_${customerId}`).emit('group_request_accepted', {
        request_id: customer_request_id,
        broker_name: req.user.name,
        skill_name: skill_name,
        booking_count: bookings.length,
        message: `Broker ${req.user.name} accepted your group request and created ${bookings.length} bookings`
      });
    }
    res.json({
      success: true,
      message: `Manual group booking created with ${bookings.length} providers`,
      bookings: bookings
    });

  } catch (error) {
    console.error('Error creating manual group booking:', error);
    res.status(500).json({ error: 'Failed to create manual group booking: ' + error.message });
  }
});

module.exports = router;