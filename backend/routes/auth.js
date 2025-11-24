const express = require('express');
const router = express.Router();
const db = require('../db');
const { signToken } = require('../helpers/auth');
const { body, validationResult } = require('express-validator');
const dotenv = require('dotenv');
dotenv.config();

const OTP_EXPIRY_MINUTES = parseInt(process.env.OTP_EXPIRY_MINUTES || '10', 10);

/**
 * Helper to validate request (returns early if validation errors)
 */
function sendValidationErrors(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  return null;
}
// Add this function to check mobile number conflicts
async function checkMobileNumberConflict(mobile_number, current_user_id = null) {
  try {
    let query = 'SELECT id, mobile_number, role FROM users WHERE mobile_number = $1';
    const params = [mobile_number];

    if (current_user_id) {
      query += ' AND id != $2';
      params.push(current_user_id);
    }

    const result = await db.query(query, params);

    if (result.rowCount > 0) {
      const existingUsers = result.rows;
      const roles = existingUsers.map(user => user.role);

      return {
        conflict: true,
        existing_users: existingUsers,
        roles: roles,
        message: `Mobile number already registered as: ${roles.join(', ')}`
      };
    }

    return { conflict: false };
  } catch (error) {
    console.error('Error checking mobile number conflict:', error);
    throw error;
  }
}
/**
 * Send OTP (mock)
 * Body: { mobile_number }
 */
router.post(
  '/sendOtp',
  [body('mobile_number').isMobilePhone('any')],
  async (req, res) => {
    // validation
    const validationError = sendValidationErrors(req, res);
    if (validationError) return;

    try {
      const { mobile_number, role } = req.body;
      if (!mobile_number) return res.status(400).json({ error: 'mobile_number required' });

      // Check if mobile number exists with different role
      const existingUser = await db.query(
        'SELECT id, role FROM users WHERE mobile_number = $1',
        [mobile_number]
      );

      if (existingUser.rowCount > 0) {
        const existingRole = existingUser.rows[0].role;
        
        // If role is provided and doesn't match existing role, return error
        if (role && role !== existingRole) {
          return res.status(409).json({ 
            error: `Mobile number already registered as ${existingRole}`,
            existing_role: existingRole,
            message: `This number is already registered as a ${existingRole}. Please login as ${existingRole} or use a different number.`
          });
        }
        
        // If no role provided but user exists, allow OTP for login
        console.log(`Mobile number exists as ${existingRole}, sending OTP for login`);
      } else if (role) {
        // New registration - mobile number doesn't exist, proceed with registration
        console.log(`New registration for ${role} with mobile: ${mobile_number}`);
      } else {
        // No role provided and mobile doesn't exist - this is invalid
        return res.status(404).json({
          error: 'Mobile number not registered',
          message: 'This mobile number is not registered. Please sign up first.'
        });
      }

      // const otp = Math.floor(100000 + Math.random() * 900000).toString();
      const otp = '123456'; // fixed OTP for development/testing
      const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60000);

      // Clean up old OTPs for this mobile number
      await db.query(
        `DELETE FROM otps WHERE mobile_number=$1 AND (used=true OR expires_at <= NOW())`,
        [mobile_number]
      );
      await db.query(
        `INSERT INTO otps (mobile_number, otp, expires_at, used, created_at) VALUES ($1, $2, $3, $4, now())`,
        [mobile_number, otp, expiresAt, false]
      );

      // In production: send SMS via provider here.
      console.log(`OTP (dev) for ${mobile_number}: ${otp} (expires: ${expiresAt.toISOString()})`);

      // Return OTP in response for development convenience. Remove in production.
      res.json({ 
        success: true, 
        message: 'OTP sent successfully',
        otp:otp,
        existing_user: existingUser.rowCount > 0,
        existing_role: existingUser.rowCount > 0 ? existingUser.rows[0].role : null
      });
    } catch (err) {
      console.error('Error in /auth/sendOtp:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);
/**
 * Resend OTP (same as sendOtp but can contain rate-limit logic)
 * Body: { mobile_number }
 */
router.post(
  '/resendOtp',
  [body('mobile_number').isMobilePhone('any')],
  async (req, res) => {
    const validationError = sendValidationErrors(req, res);
    if (validationError) return;

    try {
      const { mobile_number } = req.body;
      // const otp = Math.floor(100000 + Math.random() * 900000).toString();
      const otp = 123456; // fixed OTP for development/testing
      const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60000);

      await db.query(
        `INSERT INTO otps (mobile_number, otp, expires_at, used, created_at) VALUES ($1, $2, $3, $4, now())`,
        [mobile_number, otp, expiresAt, false]
      );

      console.log(`Resent OTP (dev) for ${mobile_number}: ${otp}`);
      res.json({ success: true, message: 'OTP resent', otp });
    } catch (err) {
      console.error('Error in /auth/resendOtp:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/**
 * Verify OTP and issue token
 * Body: { mobile_number, otp }
 */
/**
 * Verify OTP and issue token - FIXED role validation
 * Body: { mobile_number, otp }
 */
router.post(
  '/verify-otp',
  [body('mobile_number').isMobilePhone('any'), body('otp').notEmpty()],
  async (req, res) => {
    const validationError = sendValidationErrors(req, res);
    if (validationError) return;

    try {
      const { mobile_number, otp } = req.body;

      // Find valid OTP
      const otpRowRes = await db.query(
        `SELECT * FROM otps WHERE mobile_number=$1 AND otp=$2 AND used=false AND expires_at > now() ORDER BY id DESC LIMIT 1`,
        [mobile_number, otp]
      );

      if (otpRowRes.rowCount === 0) {
        return res.status(400).json({ error: 'Invalid or expired OTP' });
      }

      const otpRow = otpRowRes.rows[0];

      // Mark OTP used
      await db.query(`UPDATE otps SET used=true WHERE id=$1`, [otpRow.id]);

      // Fetch user
      let userRes = await db.query(`SELECT * FROM users WHERE mobile_number=$1`, [mobile_number]);
      if (userRes.rowCount === 0) {
        return res.status(404).json({ error: 'User not found. Please sign up first.' });
      }

      let user = userRes.rows[0];

      // Verify user
      if (!user.is_verified) {
        await db.query(`UPDATE users SET is_verified=true WHERE id=$1`, [user.id]);
        const refreshed = await db.query(`SELECT * FROM users WHERE id=$1`, [user.id]);
        user = refreshed.rows[0];
      }

      // Issue JWT
      const token = signToken({
        id: user.id,
        mobile_number: user.mobile_number,
        role: user.role,
      });

      res.json({
        token,
        user: {
          id: user.id,
          mobile_number: user.mobile_number,
          role: user.role,
          name: user.name,
          is_verified: user.is_verified,
          location_id: user.location_id,
        },
      });
    } catch (err) {
      console.error('Error in /auth/verify-otp:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);


/**
 * Check user - body: { mobile_number }
 * returns: { exists: boolean, user?: object }
 */
router.post('/checkUser', async (req, res) => {
  try {
    const { mobile_number } = req.body;
    if (!mobile_number) return res.status(400).json({ error: 'mobile_number required' });

    const r = await db.query('SELECT id, mobile_number, role, is_verified, name FROM users WHERE mobile_number=$1', [mobile_number]);
    res.json({ exists: r.rowCount > 0, user: r.rows[0] || null });
  } catch (err) {
    console.error('Error in /auth/checkUser:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Register (creates user record). Expects mobile_number, name, role, registered_by_broker(optional)
 * Body: { mobile_number, name, role, registered_by_broker }
 */
router.post(
  '/register',
  [body('mobile_number').isMobilePhone('any'), body('role').isIn(['customer', 'provider', 'broker'])],
  async (req, res) => {
    const validationError = sendValidationErrors(req, res);
    if (validationError) return;

    try {
      console.log('Incoming registration:', req.body);
      const { mobile_number, name, role, registered_by_broker } = req.body;

      if (!mobile_number || !role) {
        return res.status(400).json({ error: 'Mobile number and role are required.' });
      }

      // Check for mobile number conflict
      const conflictCheck = await checkMobileNumberConflict(mobile_number);
      if (conflictCheck.conflict) {
        return res.status(409).json({
          error: 'Mobile number already registered',
          details: conflictCheck.message,
          existing_roles: conflictCheck.roles
        });
      }

      // Continue with registration...
      const exists = await db.query('SELECT id FROM users WHERE mobile_number=$1', [mobile_number]);
      if (exists.rowCount > 0) {
        return res.status(400).json({ error: 'User already exists.' });
      }

      const result = await db.query(
        `INSERT INTO users (mobile_number, name, role, registered_by_broker, is_verified, created_at)
         VALUES ($1, $2, $3, $4, $5, now()) RETURNING *`,
        [mobile_number, name || null, role, registered_by_broker || null, false]
      );

      console.log('User inserted:', result.rows[0]);
      res.status(201).json({ user: result.rows[0] });
    } catch (err) {
      console.error('Register error:', err);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }
);
// Add endpoint to check mobile number availability
router.post(
  '/check-mobile',
  [body('mobile_number').isMobilePhone('any')],
  async (req, res) => {
    const validationError = sendValidationErrors(req, res);
    if (validationError) return;

    try {
      const { mobile_number, user_id } = req.body; // user_id for update scenarios

      const conflictCheck = await checkMobileNumberConflict(mobile_number, user_id || null);

      res.json({
        available: !conflictCheck.conflict,
        ...conflictCheck
      });
    } catch (err) {
      console.error('Error checking mobile:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);
/**
 * Complete profile
 * Body: { userId, name, locationId, skills }
 */
// Update profile endpoint with mobile conflict check
router.post('/completeProfile', async (req, res) => {
  try {
    const { userId, name, locationId, skills, mobile_number } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId required' });

    // Check mobile number conflict if mobile_number is provided
    if (mobile_number) {
      const conflictCheck = await checkMobileNumberConflict(mobile_number, userId);
      if (conflictCheck.conflict) {
        return res.status(409).json({
          error: 'Mobile number already registered to another user',
          details: conflictCheck.message
        });
      }
    }

    // Update user with optional mobile number
    const updateQuery = mobile_number
      ? 'UPDATE users SET name=$1, location_id=$2, mobile_number=$3, is_verified=true WHERE id=$4'
      : 'UPDATE users SET name=$1, location_id=$2, is_verified=true WHERE id=$3';

    const updateParams = mobile_number
      ? [name, locationId || null, mobile_number, userId]
      : [name, locationId || null, userId];

    await db.query(updateQuery, updateParams);

    if (Array.isArray(skills)) {
      for (const s of skills) {
        const skill = await db.query('SELECT id FROM skills WHERE name=$1', [s]);
        let skillId;
        if (skill.rowCount === 0) {
          const ins = await db.query('INSERT INTO skills (name) VALUES ($1) RETURNING id', [s]);
          skillId = ins.rows[0].id;
        } else skillId = skill.rows[0].id;
        await db.query('INSERT INTO provider_skills (user_id, skill_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [userId, skillId]);
      }
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('Error in /auth/completeProfile:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Clean up expired OTPs from database
 */
async function cleanupExpiredOTPs() {
  try {
    const result = await db.query(
      `DELETE FROM otps WHERE expires_at <= NOW() - INTERVAL '1 day' OR used = true`
    );
    console.log(`Cleaned up ${result.rowCount} expired/used OTPs`);
  } catch (error) {
    console.error('Error cleaning up OTPs:', error);
  }
}

// Run cleanup every hour (3600000 ms = 1 hour)
setInterval(cleanupExpiredOTPs, 60 * 60 * 1000);

// Run immediately on server startup
setTimeout(cleanupExpiredOTPs, 5000); // Wait 5 seconds after server starts

// Optional: Also run cleanup when new OTPs are created to keep table clean
async function sendOtpWithCleanup(mobile_number, otp, expiresAt) {
  // Clean up old OTPs first
  await db.query(
    `DELETE FROM otps WHERE mobile_number=$1 AND (used=true OR expires_at <= NOW())`,
    [mobile_number]
  );
  
  // Then insert new OTP
  await db.query(
    `INSERT INTO otps (mobile_number, otp, expires_at, used, created_at) VALUES ($1, $2, $3, $4, NOW())`,
    [mobile_number, otp, expiresAt, false]
  );
}

module.exports = router;
