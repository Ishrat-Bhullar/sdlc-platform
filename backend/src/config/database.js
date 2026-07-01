const { Pool } = require('pg');
require('dotenv').config();

const getDatabaseUrl = () => {
  // Prefer configured URL; never derive DB name from OS username.
  // Supports either a full DATABASE_URL or discrete POSTGRES_* env vars.
  return (
    process.env.DATABASE_URL ||
    (process.env.POSTGRES_DB
      ? `postgresql+psycopg2://${process.env.POSTGRES_USER || 'postgres'}:${process.env.POSTGRES_PASSWORD || 'postgres'}@${process.env.POSTGRES_HOST || 'localhost'}:${process.env.POSTGRES_PORT || '5432'}/${process.env.POSTGRES_DB}`
      : null)
  );
};

const DATABASE_URL = getDatabaseUrl();
const DEMO_MODE = (process.env.DEMO_MODE || 'false').toLowerCase() === 'true';

let pool = null;
if (!DATABASE_URL) {
  console.warn('⚠️ DATABASE_URL/POSTGRES_* not set; running in DEMO_MODE (no DB connection)');
} else {
  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });

  pool.on('connect', () => {
    console.log('✅ PostgreSQL connected');
  });

  pool.on('error', (err) => {
    console.error('❌ PostgreSQL error:', err.message);
  });
}

const query = (text, params) => {
  if (!pool) {
    if (DEMO_MODE) return Promise.resolve({ rows: [] });
    return Promise.reject(new Error('PostgreSQL not configured (missing DATABASE_URL/POSTGRES_*)'));
  }
  return pool.query(text, params);
};

module.exports = { pool, query, DATABASE_URL, DEMO_MODE };

