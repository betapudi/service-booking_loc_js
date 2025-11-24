const { Pool } = require("pg");

// Configure your source DB (with separate tables)
const sourcePool = new Pool({
  user: "postgres",
  host: "localhost",
  database: "service_booking_app",
  password: "postgres",
  port: 5432,
});

// Configure your target DB (servicedb with locations)
const targetPool = new Pool({
  user: "postgres",
  host: "localhost",
  database: "servicedb",
  password: "postgres",
  port: 5432,
});

async function migrateLocations() {
  try {
    console.log("Clearing target locations table...");
    await targetPool.query("DELETE FROM locations");

    // 1. Migrate states
    const states = await sourcePool.query(
      'SELECT id, name FROM states'
    );
    for (const state of states.rows) {
      await targetPool.query(
        "INSERT INTO locations (id, name, type, parent_id) VALUES ($1, $2, 'state', NULL)",
        [state.id, state.name]
      );
    }
    console.log(`Migrated ${states.rows.length} states.`);

    // 2. Migrate districts (normalize casing)
    const districts = await sourcePool.query(
      'SELECT id, name, "stateId" AS state_id FROM districts'
    );
    for (const district of districts.rows) {
      await targetPool.query(
        "INSERT INTO locations (id, name, type, parent_id) VALUES ($1, $2, $3, $4)",
        [district.id, district.name, "district", district.state_id]
      );
    }
    console.log(`Migrated ${districts.rows.length} districts.`);

    // 3. Migrate taluks
    const taluks = await sourcePool.query(
      'SELECT id, name, "districtId" AS district_id FROM taluks'
    );
    for (const taluk of taluks.rows) {
      await targetPool.query(
        "INSERT INTO locations (id, name, type, parent_id) VALUES ($1, $2, $3, $4)",
        [taluk.id, taluk.name, "taluk", taluk.district_id]
      );
    }
    console.log(`Migrated ${taluks.rows.length} taluks.`);

    // 4. Migrate villages
    const villages = await sourcePool.query(
      'SELECT id, name, "talukId" AS taluk_id FROM villages'
    );
    for (const village of villages.rows) {
      await targetPool.query(
        "INSERT INTO locations (id, name, type, parent_id) VALUES ($1, $2, $3, $4)",
        [village.id, village.name, "village", village.taluk_id]
      );
    }
    console.log(`Migrated ${villages.rows.length} villages.`);

    console.log("Migration complete!");
  } catch (err) {
    console.error("Migration failed:", err);
  } finally {
    await sourcePool.end();
    await targetPool.end();
  }
}

migrateLocations();
