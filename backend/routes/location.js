const express = require('express');
const router = express.Router();
const db = require('../db');

/**
 * utility: resolve param which could be an id or a name -> returns numeric id or null
 */
async function resolveId(param) {
  if (!param) return null;
  // if looks numeric, return numeric
  if (!isNaN(Number(param))) return Number(param);

  // otherwise try to find by name (case-insensitive)
  const r = await db.query('SELECT id FROM locations WHERE LOWER(name)=LOWER($1) LIMIT 1', [param]);
  if (r.rowCount === 0) return null;
  return r.rows[0].id;
}

/**
 * GET /states
 */
router.get('/states', async (req, res) => {
  try {
    const r = await db.query("SELECT id, name FROM locations WHERE type='state' ORDER BY name");
    res.json(r.rows);
  } catch (err) {
    console.error('Error fetching states:', err);
    res.status(500).json({ error: 'Failed to fetch states' });
  }
});

/**
 * GET /districts/:stateId
 */
router.get('/districts/:stateId', async (req, res) => {
  try {
    const raw = req.params.stateId;
    const stateId = await resolveId(raw);
    if (!stateId) return res.status(400).json({ error: 'Invalid state id/name' });

    const r = await db.query("SELECT id, name FROM locations WHERE parent_id=$1 AND type='district' ORDER BY name", [stateId]);
    res.json(r.rows);
  } catch (err) {
    console.error('Error fetching districts:', err);
    res.status(500).json({ error: 'Failed to fetch districts' });
  }
});

/**
 * GET /taluks/:districtId
 */
router.get('/taluks/:districtId', async (req, res) => {
  try {
    const raw = req.params.districtId;
    const districtId = await resolveId(raw);
    if (!districtId) return res.status(400).json({ error: 'Invalid district id/name' });

    const r = await db.query("SELECT id, name FROM locations WHERE parent_id=$1 AND type='taluk' ORDER BY name", [districtId]);
    res.json(r.rows);
  } catch (err) {
    console.error('Error fetching taluks:', err);
    res.status(500).json({ error: 'Failed to fetch taluks' });
  }
});

/**
 * GET /villages/:talukId
 */
router.get('/villages/:talukId', async (req, res) => {
  try {
    const raw = req.params.talukId;
    const talukId = await resolveId(raw);
    if (!talukId) return res.status(400).json({ error: 'Invalid taluk id/name' });

    const r = await db.query("SELECT id, name FROM locations WHERE parent_id=$1 AND type='village' ORDER BY name", [talukId]);
    res.json(r.rows);
  } catch (err) {
    console.error('Error fetching villages:', err);
    res.status(500).json({ error: 'Failed to fetch villages' });
  }
});

/**
 * GET /:id/hierarchy -> return array from root to the node
 */
router.get('/:id/hierarchy', async (req, res) => {
  try {
    const raw = req.params.id;
    const id = await resolveId(raw);
    if (!id) return res.status(400).json({ error: 'Invalid id/name' });

    const path = [];
    let currentId = id;
    while (currentId) {
      const r = await db.query('SELECT id, name, type, parent_id FROM locations WHERE id=$1', [currentId]);
      if (r.rowCount === 0) break;
      path.unshift(r.rows[0]);
      currentId = r.rows[0].parent_id;
    }

    res.json(path);

  } catch (err) {
    console.error('Error fetching hierarchy:', err);
    res.status(500).json({ error: 'Failed to fetch hierarchy' });
  }
});


// Get complete location hierarchy from village to state
async function getFullLocationHierarchy(locationId) {
  if (!locationId) return null;
  
  const query = `
    WITH RECURSIVE location_path AS (
      SELECT id, name, type, parent_id, 1 as level
      FROM locations 
      WHERE id = $1
      
      UNION ALL
      
      SELECT l.id, l.name, l.type, l.parent_id, lp.level + 1
      FROM locations l
      INNER JOIN location_path lp ON l.id = lp.parent_id
      WHERE lp.parent_id IS NOT NULL
    )
    SELECT * FROM location_path ORDER BY level DESC;
  `;
  
  const result = await db.query(query, [locationId]);
  return result.rows;
}

// Get location by name and type (fuzzy search)
async function findLocationByName(name, type = null) {
  let query = 'SELECT id, name, type, parent_id FROM locations WHERE name ILIKE $1';
  const params = [`%${name}%`];
  
  if (type) {
    query += ' AND type = $2';
    params.push(type);
  }
  
  query += ' ORDER BY name LIMIT 5';
  
  const result = await db.query(query, params);
  return result.rows;
}

// Get all locations of a specific type with their hierarchy
async function getLocationsByType(type, parentId = null) {
  let query = 'SELECT id, name, type, parent_id FROM locations WHERE type = $1';
  const params = [type];
  
  if (parentId) {
    query += ' AND parent_id = $2';
    params.push(parentId);
  }
  
  query += ' ORDER BY name';
  
  const result = await db.query(query, params);
  return result.rows;
}

// Get states with districts count
async function getStatesWithCounts() {
  const query = `
    SELECT s.id, s.name, 
           COUNT(DISTINCT d.id) as district_count,
           COUNT(DISTINCT u.id) as user_count
    FROM locations s
    LEFT JOIN locations d ON d.parent_id = s.id AND d.type = 'district'
    LEFT JOIN users u ON u.location_id IN (s.id, d.id, 
      (SELECT id FROM locations WHERE parent_id = d.id AND type = 'taluk'),
      (SELECT id FROM locations WHERE parent_id IN 
        (SELECT id FROM locations WHERE parent_id = d.id AND type = 'taluk') AND type = 'village')
    )
    WHERE s.type = 'state'
    GROUP BY s.id, s.name
    ORDER BY s.name;
  `;
  
  const result = await db.query(query);
  return result.rows;
}

module.exports = {
  getFullLocationHierarchy,
  findLocationByName,
  getLocationsByType,
  getStatesWithCounts
};

module.exports = router;
