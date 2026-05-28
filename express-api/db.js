const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host:     process.env.DB_HOST,
  port:     parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl:      process.env.DB_SSLMODE === 'require' ? { rejectUnauthorized: false } : false,
  max:      10,
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => {
  console.error('[DB] Unexpected pool error:', err.message);
});

// Test connection on startup
pool.query('SELECT NOW()').then(() => {
  console.log('[DB] Connected to PostgreSQL ✓');
}).catch((err) => {
  console.error('[DB] Connection failed:', err.message);
});

module.exports = pool;
