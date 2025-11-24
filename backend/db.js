const { Pool } = require("pg");
require("dotenv").config();

// const pool = new Pool({
//   user: process.env.PGUSER || "postgres",
//   password: process.env.PGPASSWORD || "password",
//   host: process.env.PGHOST || "localhost",
//   port: process.env.PGPORT || 5432,
//   database: process.env.PGDATABASE || "servicedb2",
// });

const pool = new Pool({
  user: process.env.PGUSER || "postgres",
  password: process.env.PGPASSWORD || "password",
  host: process.env.PGHOST || "localhost",
  port: Number(process.env.PGPORT) || 5432,
  database: process.env.PGDATABASE || "servicedb2",
  // Production-safe defaults; override via env if needed
  max: Number(process.env.PGPOOL_MAX) || 10,
  idleTimeoutMillis: Number(process.env.PGPOOL_IDLE_MS) || 30000,
  connectionTimeoutMillis: Number(process.env.PGPOOL_CONN_MS) || 5000,
});

pool.on("connect", () => { console.log("Connected to PostgreSQL"); });
pool.on("error", (err) => { console.error("Unexpected error on idle client", err); process.exit(-1); });

module.exports = pool;
