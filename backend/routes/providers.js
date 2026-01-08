// backend/routes/providers.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const { authMiddleware, permit } = require('../helpers/auth');

// Search providers by location (hierarchy) and optional skill
// router.get('/search', async (req, res) => {
//   try {
//     const { locationId, skill, page = 1, limit = 20 } = req.query;
//     const offset = (page - 1) * limit;

//     // Build base query - INCLUDING LATITUDE AND LONGITUDE
//     let baseSql = `SELECT u.id, u.name, u.mobile_number, u.location_id, u.meta,
//       u.latitude, u.longitude, u.is_verified,
//       json_agg(s.name) FILTER (WHERE s.name IS NOT NULL) as skills
//       FROM users u
//       LEFT JOIN provider_skills ps ON ps.user_id = u.id
//       LEFT JOIN skills s ON s.id = ps.skill_id
//       WHERE u.role='provider' AND u.is_verified = true`;

//     const params = [];
//     if (locationId) {
//       params.push(locationId);
//       baseSql += ` AND (u.location_id = $${params.length} OR u.location_id IN (SELECT id FROM locations WHERE parent_id = $${params.length}))`;
//     }
//     if (skill) {
//       params.push(`%${skill}%`);
//       baseSql += ` AND u.id IN (SELECT user_id FROM provider_skills ps2 JOIN skills sk ON sk.id = ps2.skill_id WHERE sk.name ILIKE $${params.length})`;
//     }

//     baseSql += ` GROUP BY u.id ORDER BY u.created_at DESC LIMIT ${limit} OFFSET ${offset}`;

//     const r = await db.query(baseSql, params);

//     // Add ratings and booking counts
//     const providersWithStats = await Promise.all(
//       r.rows.map(async (provider) => {
//         try {
//           // Get rating
//           const ratingResult = await db.query(
//             `SELECT COALESCE(AVG(br.rating), 0) as rating
//              FROM bookings b 
//              LEFT JOIN booking_ratings br ON b.id = br.booking_id 
//              WHERE b.provider_id = $1`,
//             [provider.id]
//           );

//           // Get booking count
//           const bookingResult = await db.query(
//             `SELECT COUNT(*) as total_bookings FROM bookings WHERE provider_id = $1`,
//             [provider.id]
//           );

//           return {
//             ...provider,
//             rating: parseFloat(ratingResult.rows[0].rating),
//             total_bookings: parseInt(bookingResult.rows[0].total_bookings),
//             skills: provider.skills || []
//           };
//         } catch (error) {
//           console.error(`Error fetching stats for provider ${provider.id}:`, error);
//           return {
//             ...provider,
//             rating: 0,
//             total_bookings: 0,
//             skills: provider.skills || []
//           };
//         }
//       })
//     );

//     res.json({ providers: providersWithStats });
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: 'Server error' });
//   }
// });
// Search providers (fallback) - EXCLUDES BROKER-MANAGED PROVIDERS
router.get('/search', authMiddleware, permit('customer'), async (req, res) => {
  try {
    const { limit = 50, skill } = req.query;

    let query = `
      SELECT 
        u.id,
        u.name,
        u.mobile_number,
        u.latitude,
        u.longitude,
        u.is_verified,
        u.registered_by_broker,
        COALESCE(
          ARRAY_AGG(DISTINCT s.name) FILTER (WHERE s.name IS NOT NULL),
          ARRAY[]::varchar[]
        ) as skills,
        COUNT(b.id) as total_bookings,
        AVG(br.rating) as rating
      FROM users u
      LEFT JOIN provider_skills ps ON u.id = ps.user_id
      LEFT JOIN skills s ON ps.skill_id = s.id
      LEFT JOIN bookings b ON u.id = b.provider_id
      LEFT JOIN booking_ratings br ON b.id = br.booking_id
      WHERE u.role = 'provider'
        AND u.is_verified = true
        AND u.registered_by_broker IS NULL  -- EXCLUDE BROKER-MANAGED PROVIDERS
    `;

    const params = [];

    if (skill) {
      params.push(skill);
      query += ` AND EXISTS (
        SELECT 1 FROM provider_skills ps2 
        WHERE ps2.user_id = u.id AND ps2.skill_id = $${params.length}
      )`;
    }

    query += `
      GROUP BY u.id
      ORDER BY COUNT(b.id) DESC, u.created_at DESC
      LIMIT $${params.length + 1}
    `;

    params.push(parseInt(limit));

    const providers = await db.query(query, params);

    console.log(`Found ${providers.rows.length} providers in search`);

    res.json({
      success: true,
      providers: providers.rows
    });
  } catch (error) {
    console.error('Error searching providers:', error);
    res.status(500).json({ error: 'Failed to search providers: ' + error.message });
  }
});
// 🔍 GET nearby providers based on lat/lon and optional radius (in km)
// router.get("/nearby", async (req, res) => {
//   try {
//     const { lat, lon, radius = 5 } = req.query;
//     if (!lat || !lon) {
//       return res.status(400).json({ error: "Latitude and longitude are required" });
//     }

//     console.log("Nearby providers request:", { lat, lon, radius }); // Debug log

//     // Use Haversine formula for distance calculation
//     const query = `
//       SELECT 
//         u.id, 
//         u.name, 
//         u.role, 
//         u.latitude, 
//         u.longitude,
//         u.mobile_number,
//         u.is_verified,
//         (
//           6371 * acos(
//             cos(radians($1)) * cos(radians(u.latitude)) *
//             cos(radians(u.longitude) - radians($2)) +
//             sin(radians($1)) * sin(radians(u.latitude))
//           )
//         ) AS distance_km,
//         ARRAY_AGG(DISTINCT s.name) AS skills,
//         COALESCE(AVG(br.rating), 0) AS rating,
//         COUNT(DISTINCT b.id) AS total_bookings
//       FROM users u
//       LEFT JOIN provider_skills ps ON u.id = ps.user_id
//       LEFT JOIN skills s ON ps.skill_id = s.id
//       LEFT JOIN bookings b ON u.id = b.provider_id
//       LEFT JOIN booking_ratings br ON b.id = br.booking_id
//       WHERE u.role = 'provider'
//         AND u.latitude IS NOT NULL
//         AND u.longitude IS NOT NULL
//         AND u.is_verified = true
//         AND u.registered_by_broker IS NULL  // EXCLUDE BROKER-MANAGED PROVIDERS
//         AND (
//           6371 * acos(
//             cos(radians($1)) * cos(radians(u.latitude)) *
//             cos(radians(u.longitude) - radians($2)) +
//             sin(radians($1)) * sin(radians(u.latitude))
//           )
//         ) <= $3 
//       GROUP BY u.id, u.name, u.role, u.latitude, u.longitude, u.mobile_number, u.is_verified
//       ORDER BY distance_km ASC
//       LIMIT 50;
//     `;

//     const result = await db.query(query, [parseFloat(lat), parseFloat(lon), parseFloat(radius)]);

//     // Format the response
//     const providers = result.rows.map(row => ({
//       id: row.id,
//       name: row.name,
//       mobile_number: row.mobile_number,
//       role: row.role,
//       latitude: parseFloat(row.latitude),
//       longitude: parseFloat(row.longitude),
//       distance_km: parseFloat(row.distance_km) || 0,
//       skills: row.skills ? row.skills.filter(skill => skill !== null) : [],
//       rating: parseFloat(row.rating),
//       total_bookings: parseInt(row.total_bookings),
//       is_verified: row.is_verified
//     }));

//     res.json({
//       success: true,
//       providers,
//       count: providers.length
//     });
//   } catch (err) {
//     console.error("Error fetching nearby providers:", err);
//     res.status(500).json({ error: "Internal server error", details: err.message });
//   }
// });

// Get nearby providers - EXCLUDES BROKER-MANAGED PROVIDERS
// router.get('/nearby', authMiddleware, permit('customer'), async (req, res) => {
//   try {
//     const { lat, lon, radius = 15 } = req.query;

//     if (!lat || !lon) {
//       return res.status(400).json({ error: 'Latitude and longitude are required' });
//     }

//     const providers = await db.query(`
//       SELECT 
//         u.id,
//         u.name,
//         u.mobile_number,
//         u.latitude,
//         u.longitude,
//         u.is_verified,
//         u.registered_by_broker,
//         COALESCE(
//           ARRAY_AGG(DISTINCT s.name) FILTER (WHERE s.name IS NOT NULL),
//           ARRAY[]::varchar[]
//         ) as skills,
//         COUNT(b.id) as total_bookings,
//         AVG(br.rating) as rating,
//         ST_Distance(
//           u.geom,
//           ST_SetSRID(ST_MakePoint($1, $2), 4326)
//         ) / 1000 as distance_km
//       FROM users u
//       LEFT JOIN provider_skills ps ON u.id = ps.user_id
//       LEFT JOIN skills s ON ps.skill_id = s.id
//       LEFT JOIN bookings b ON u.id = b.provider_id
//       LEFT JOIN booking_ratings br ON b.id = br.booking_id
//       WHERE u.role = 'provider'
//         AND u.is_verified = true
//         AND u.registered_by_broker IS NULL  -- EXCLUDE BROKER-MANAGED PROVIDERS
//         AND u.latitude IS NOT NULL
//         AND u.longitude IS NOT NULL
//         AND ST_DWithin(
//           u.geom,
//           ST_SetSRID(ST_MakePoint($1, $2), 4326),
//           $3 * 1000
//         )
//       GROUP BY u.id
//       HAVING COUNT(b.id) >= 0
//       ORDER BY distance_km
//       LIMIT 50
//     `, [lon, lat, radius]);

//     console.log(`Found ${providers.rows.length} nearby providers`);

//     res.json({
//       success: true,
//       providers: providers.rows
//     });
//   } catch (error) {
//     console.error('Error fetching nearby providers:', error);
//     res.status(500).json({ error: 'Failed to fetch providers: ' + error.message });
//   }
// });
// backend/routes/providers.js
router.get('/nearby', authMiddleware, permit('customer'), async (req, res) => {
  try {
    const { lat, lon, radius = 15 } = req.query;
    if (!lat || !lon) return res.status(400).json({ error: 'Latitude and longitude are required' });

    const providers = await db.query(
      `SELECT
         u.id, u.name, u.mobile_number, u.latitude, u.longitude, u.is_verified, u.registered_by_broker,
         COALESCE(ARRAY_AGG(DISTINCT s.name) FILTER (WHERE s.name IS NOT NULL), ARRAY[]::varchar[]) AS skills,
         COUNT(b.id) AS total_bookings,
         AVG(br.rating) AS rating,
         ST_Distance(
           u.geom::geography,
           ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
         ) / 1000 AS distance_km
       FROM users u
       LEFT JOIN provider_skills ps ON u.id = ps.user_id
       LEFT JOIN skills s ON ps.skill_id = s.id
       LEFT JOIN bookings b ON u.id = b.provider_id
       LEFT JOIN booking_ratings br ON b.id = br.booking_id
       WHERE u.role = 'provider'
         AND u.is_verified = true
         AND u.registered_by_broker IS NULL
         AND u.geom IS NOT NULL
         AND ST_DWithin(
           u.geom::geography,
           ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
           $3 * 1000
         )
       GROUP BY u.id
       ORDER BY distance_km
       LIMIT 50`,
      [parseFloat(lon), parseFloat(lat), parseFloat(radius)]
    );

    res.json({ success: true, providers: providers.rows });
  } catch (error) {
    console.error('Error fetching nearby providers:', error);
    res.status(500).json({ error: 'Failed to fetch providers: ' + error.message });
  }
});

// ✅ Update provider location (FIXED - without updated_at column)
// router.put("/:id/location", async (req, res) => {
//   try {
//     const { id } = req.params;
//     const { latitude, longitude, accuracy } = req.body;

//     console.log(`Updating location for provider ${id}:`, { latitude, longitude, accuracy });

//     if (!latitude || !longitude) {
//       return res.status(400).json({ error: "Latitude and longitude required" });
//     }

//     // Update provider's location in users table
//     const result = await db.query(
//       `UPDATE users 
//        SET latitude = $1, longitude = $2, 
//            meta = jsonb_set(
//              COALESCE(meta, '{}'::jsonb), 
//              '{location}', 
//              $3::jsonb
//            )
//        WHERE id = $4 AND role = 'provider'
//        RETURNING id, name, latitude, longitude, meta`,
//       [
//         parseFloat(latitude), 
//         parseFloat(longitude), 
//         JSON.stringify({ 
//           lat: parseFloat(latitude), 
//           lng: parseFloat(longitude),
//           accuracy: accuracy || null
//         }), 
//         parseInt(id)
//       ]
//     );

//     if (result.rowCount === 0) {
//       return res.status(404).json({ error: "Provider not found" });
//     }

//     console.log(`✅ Location updated for provider ${id}`);
//     res.json({ 
//       success: true, 
//       message: "Location updated successfully",
//       provider: result.rows[0]
//     });

//   } catch (err) {
//     console.error("Error updating provider location:", err);
//     res.status(500).json({ error: "Internal server error", details: err.message });
//   }
// });
// backend/routes/providers.js
router.put("/:id/location", async (req, res) => {
  try {
    const { id } = req.params;
    const { latitude, longitude, accuracy } = req.body;

    if (!latitude || !longitude) return res.status(400).json({ error: "Latitude and longitude required" });

    const lat = parseFloat(latitude);
    const lon = parseFloat(longitude);

    const result = await db.query(
      `UPDATE users
       SET latitude = $1,
           longitude = $2,
           geom = ST_SetSRID(ST_MakePoint($2, $1), 4326),
           meta = jsonb_set(COALESCE(meta, '{}'::jsonb), '{location}', $3::jsonb)
       WHERE id = $4 AND role = 'provider'
       RETURNING id, name, latitude, longitude, meta`,
      [lat,
        lon,
        JSON.stringify({
          lat, lng: lon, accuracy: accuracy || null,
          updated_at: new Date().toISOString()
        }),
        parseInt(id)]
    );

    if (result.rowCount === 0) return res.status(404).json({ error: "Provider not found" });

    res.json({ success: true, message: "Location updated successfully", provider: result.rows[0] });
  } catch (err) {
    console.error("Error updating provider location:", err);
    res.status(500).json({ error: "Internal server error", details: err.message });
  }
});

// ✅ Get provider's current location
router.get("/:id/location", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.query(
      `SELECT id, name, latitude, longitude, meta
       FROM users WHERE id = $1 AND role = 'provider'`,
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Provider not found" });
    }

    const provider = result.rows[0];
    res.json({
      id: provider.id,
      name: provider.name,
      latitude: provider.latitude,
      longitude: provider.longitude,
      meta: provider.meta
    });
  } catch (err) {
    console.error("Error fetching provider location:", err);
    res.status(500).json({ error: "Failed to fetch location" });
  }
});

// ✅ Get all providers with their locations
router.get("/locations/all", authMiddleware, async (req, res) => {
  try {
    const { updated_within } = req.query; // in minutes, e.g., 30 for last 30 minutes

    let query = `
      SELECT id, name, latitude, longitude, meta
      FROM users 
      WHERE role = 'provider' AND latitude IS NOT NULL AND longitude IS NOT NULL
    `;

    const params = [];

    if (updated_within) {
      // Use meta->location->updated_at for filtering
      query += ` AND meta->'location'->>'updated_at' > NOW() - INTERVAL '${parseInt(updated_within)} minutes'`;
    }

    query += " ORDER BY created_at DESC";

    const result = await db.query(query, params);

    res.json({
      success: true,
      providers: result.rows,
      count: result.rowCount
    });
  } catch (err) {
    console.error("Error fetching provider locations:", err);
    res.status(500).json({ error: "Failed to fetch provider locations" });
  }
});

// Provider: update profile & skills
router.post('/me', authMiddleware, permit('provider'), async (req, res) => {
  const userId = req.user.id;
  const { name, location_id, skills, meta } = req.body;
  try {
    await db.query('UPDATE users SET name=$1, location_id=$2, meta=$3 WHERE id=$4', [name, location_id, meta || {}, userId]);
    if (Array.isArray(skills)) {
      for (const s of skills) {
        const sk = await db.query('SELECT id FROM skills WHERE name=$1', [s]);
        let skillId;
        if (sk.rowCount === 0) {
          const ins = await db.query('INSERT INTO skills (name) VALUES ($1) RETURNING id', [s]);
          skillId = ins.rows[0].id;
        } else {
          skillId = sk.rows[0].id;
        }
        await db.query('INSERT INTO provider_skills (user_id, skill_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [userId, skillId]);
      }
    }
    const u = await db.query('SELECT * FROM users WHERE id=$1', [userId]);
    res.json({ user: u.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Provider: earnings and payments
router.get('/me/earnings', authMiddleware, permit('provider'), async (req, res) => {
  try {
    const userId = req.user.id;
    const r = await db.query(
      `SELECT p.*, b.total_amount, b.customer_id 
       FROM payments p 
       JOIN bookings b ON b.id = p.booking_id 
       WHERE b.provider_id=$1 
       ORDER BY p.created_at DESC`,
      [userId]
    );
    res.json({ payments: r.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;