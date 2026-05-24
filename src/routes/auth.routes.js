const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const SECRET = process.env.JWT_SECRET || 'nextrade_secret_2026';

router.post('/register', async (req, res) => {
  try {
    const { email, password, full_name } = req.body;
    if (!email || !password || !full_name) return res.status(400).json({ error: 'All fields required' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    const existing = await pool.query('SELECT id FROM users WHERE email=$1', [email]);
    if (existing.rows.length) return res.status(409).json({ error: 'Email already registered' });
    const hash = await bcrypt.hash(password, 12);
    const { rows } = await pool.query(
      'INSERT INTO users (email, password_hash, full_name) VALUES($1,$2,$3) RETURNING id, email, full_name',
      [email, hash, full_name]
    );
    await pool.query('INSERT INTO wallets (user_id, coin, balance) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [rows[0].id, 'USDT', 0]);
    const token = jwt.sign({ userId: rows[0].id }, SECRET, { expiresIn: '7d' });
    res.status(201).json({ user: rows[0], accessToken: token });
  } catch (err) {
    console.error('Register error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const { rows } = await pool.query('SELECT * FROM users WHERE email=$1', [email]);
    if (!rows.length) return res.status(401).json({ error: 'Invalid email or password' });
    const valid = await bcrypt.compare(password, rows[0].password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' });
    const token = jwt.sign({ userId: rows[0].id }, SECRET, { expiresIn: '7d' });
    res.json({ user: { id: rows[0].id, email: rows[0].email, full_name: rows[0].full_name }, accessToken: token });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/logout', (req, res) => res.json({ message: 'Logged out' }));
router.post('/refresh', (req, res) => res.status(400).json({ error: 'Please login again' }));

module.exports = router;
