const express = require('express');
const router = express.Router();
const db = require('../db');
const { authMiddleware } = require('../helpers/auth');

// Get user's complete location hierarchy
async function getLocationHierarchy(locationId) {
  if (!locationId) return null;

  const query = `
    WITH RECURSIVE location_tree AS (
      SELECT id, name, type, parent_id, 1 as level
      FROM locations 
      WHERE id = $1
      
      UNION ALL
      
      SELECT l.id, l.name, l.type, l.parent_id, lt.level + 1
      FROM locations l
      INNER JOIN location_tree lt ON l.id = lt.parent_id
    )
    SELECT * FROM location_tree ORDER BY level DESC;
  `;

  const result = await db.query(query, [locationId]);
  return result.rows;
}
// Get all available skills
router.get('/skills', async (req, res) => {
  try {
    const result = await db.query('SELECT id, name FROM skills ORDER BY name');
    res.json({ skills: result.rows });
    // console.log(`Fetched ${result.rowCount} skills`);
  } catch (err) {
    console.error('Error fetching skills:', err);
    res.status(500).json({ error: 'Failed to fetch skills' });
  }
});
// Get user's complete profile with location hierarchy
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get user basic info
    const userResult = await db.query(`
      SELECT u.*, 
             json_agg(DISTINCT s.name) FILTER (WHERE s.name IS NOT NULL) as skills
      FROM users u
      LEFT JOIN provider_skills ps ON u.id = ps.user_id
      LEFT JOIN skills s ON s.id = ps.skill_id
      WHERE u.id = $1
      GROUP BY u.id
    `, [userId]);

    if (userResult.rowCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];

    // Get location hierarchy if location_id exists
    let locationHierarchy = null;
    if (user.location_id) {
      locationHierarchy = await getLocationHierarchy(user.location_id);
    }

    // Format location data
    const locationData = locationHierarchy ? {
      village: locationHierarchy.find(loc => loc.type === 'village'),
      taluk: locationHierarchy.find(loc => loc.type === 'taluk'),
      district: locationHierarchy.find(loc => loc.type === 'district'),
      state: locationHierarchy.find(loc => loc.type === 'state'),
      full_hierarchy: locationHierarchy
    } : null;

    res.json({
      user: {
        id: user.id,
        mobile_number: user.mobile_number,
        role: user.role,
        name: user.name,
        location_id: user.location_id,
        location_data: locationData,
        skills: user.skills || [],
        experience_years: user.experience_years,
        literacy_level: user.literacy_level,
        education_level: user.education_level,
        date_of_birth: user.date_of_birth,
        gender: user.gender,
        profile_completed: user.profile_completed,
        is_verified: user.is_verified,
        meta: user.meta,
        latitude: user.latitude,
        longitude: user.longitude,
        created_at: user.created_at
      }
    });

  } catch (err) {
    console.error('Error fetching user profile:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update user profile with location, skills, experience, etc.
router.put('/me', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      name,
      location_id,
      skills,
      experience_years,
      literacy_level,
      education_level,
      date_of_birth,
      gender,
      meta
    } = req.body;

    // Start transaction
    await db.query('BEGIN');

    try {
      // Update user basic info
      const updateQuery = `
        UPDATE users 
        SET name = COALESCE($1, name),
            location_id = COALESCE($2, location_id),
            experience_years = COALESCE($3, experience_years),
            literacy_level = COALESCE($4, literacy_level),
            education_level = COALESCE($5, education_level),
            date_of_birth = COALESCE($6, date_of_birth),
            gender = COALESCE($7, gender),
            meta = COALESCE($8, meta),
            profile_completed = TRUE            
        WHERE id = $9
        RETURNING *
      `;

      const userResult = await db.query(updateQuery, [
        name, location_id, experience_years, literacy_level,
        education_level, date_of_birth, gender, meta, userId
      ]);

      if (userResult.rowCount === 0) {
        await db.query('ROLLBACK');
        return res.status(404).json({ error: 'User not found' });
      }

      // Update skills if provided
      if (Array.isArray(skills)) {
        // Remove existing skills
        await db.query('DELETE FROM provider_skills WHERE user_id = $1', [userId]);

        // Add new skills
        for (const skillName of skills) {
          if (skillName && skillName.trim()) {
            // Find or create skill
            let skillResult = await db.query(
              'SELECT id FROM skills WHERE name = $1',
              [skillName.trim()]
            );

            let skillId;
            if (skillResult.rowCount === 0) {
              const newSkill = await db.query(
                'INSERT INTO skills (name) VALUES ($1) RETURNING id',
                [skillName.trim()]
              );
              skillId = newSkill.rows[0].id;
            } else {
              skillId = skillResult.rows[0].id;
            }

            // Link skill to user
            await db.query(
              'INSERT INTO provider_skills (user_id, skill_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
              [userId, skillId]
            );
          }
        }
      }

      await db.query('COMMIT');

      // Get updated user profile with location hierarchy
      const updatedUser = await db.query(`
        SELECT u.*, 
               json_agg(DISTINCT s.name) FILTER (WHERE s.name IS NOT NULL) as skills
        FROM users u
        LEFT JOIN provider_skills ps ON u.id = ps.user_id
        LEFT JOIN skills s ON s.id = ps.skill_id
        WHERE u.id = $1
        GROUP BY u.id
      `, [userId]);

      // Get location hierarchy
      let locationHierarchy = null;
      if (updatedUser.rows[0].location_id) {
        locationHierarchy = await getLocationHierarchy(updatedUser.rows[0].location_id);
      }

      const locationData = locationHierarchy ? {
        village: locationHierarchy.find(loc => loc.type === 'village'),
        taluk: locationHierarchy.find(loc => loc.type === 'taluk'),
        district: locationHierarchy.find(loc => loc.type === 'district'),
        state: locationHierarchy.find(loc => loc.type === 'state'),
        full_hierarchy: locationHierarchy
      } : null;

      res.json({
        success: true,
        message: 'Profile updated successfully',
        user: {
          ...updatedUser.rows[0],
          location_data: locationData
        }
      });

    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }

  } catch (err) {
    console.error('Error updating user profile:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Check if profile needs completion
router.get('/me/status', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await db.query(`
      SELECT id, name, location_id, profile_completed,
             experience_years, literacy_level, education_level
      FROM users WHERE id = $1
    `, [userId]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = result.rows[0];
    const needsCompletion = !user.profile_completed ||
      !user.name ||
      !user.location_id ||
      (user.role === 'provider' && (!user.experience_years || !user.literacy_level));

    res.json({
      profile_completed: user.profile_completed,
      needs_completion: needsCompletion,
      missing_fields: {
        name: !user.name,
        location: !user.location_id,
        experience: user.role === 'provider' && !user.experience_years,
        literacy: user.role === 'provider' && !user.literacy_level,
        skills: user.role === 'provider' && (!user.skills || user.skills.length === 0),
        gender: !user.gender,
        date_of_birth: !user.date_of_birth
      }
    });

  } catch (err) {
    console.error('Error checking profile status:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;