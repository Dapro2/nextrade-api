const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

async function connectDB() {
  const client = await pool.connect();
  console.log('✅ PostgreSQL connected');
  client.release();
}

// Helper: run a query
async function query(text, params) {
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  if (process.env.NODE_ENV === 'development') {
    console.log('query', { text, duration, rows: res.rowCount });
  }
  return res;
}

// Helper: get a client for transactions
async function getClient() {
  return pool.connect();
}

module.exports = { pool, connectDB, query, getClient };
