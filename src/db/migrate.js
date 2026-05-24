const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        full_name VARCHAR(100),
        kyc_status VARCHAR(20) DEFAULT 'pending',
        role VARCHAR(20) DEFAULT 'user',
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS wallets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id),
        coin VARCHAR(20) NOT NULL,
        balance DECIMAL(20,8) DEFAULT 0,
        UNIQUE(user_id, coin)
      );
      CREATE TABLE IF NOT EXISTS trades (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id),
        pair VARCHAR(20), side VARCHAR(4),
        amount DECIMAL(20,8), price DECIMAL(20,8),
        fee DECIMAL(20,8) DEFAULT 0,
        status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS portfolio (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id),
        coin VARCHAR(20),
        quantity DECIMAL(20,8) DEFAULT 0,
        avg_buy_price DECIMAL(20,8) DEFAULT 0,
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, coin)
      );
    `);
    console.log('✅ Tables ready!');
  } catch(err) {
    console.error('Migration error:', err.message);
  } finally {
    client.release();
    process.exit(0);
  }
}
migrate();
