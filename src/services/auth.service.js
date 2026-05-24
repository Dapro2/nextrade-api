const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const speakeasy = require('speakeasy');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../config/database');
const { setCache, getCache, delCache } = require('../config/redis');
const emailService = require('./email.service');

const SALT_ROUNDS = 12;

// Hash a password
async function hashPassword(password) {
  return bcrypt.hash(password, SALT_ROUNDS);
}

// Compare password with hash
async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

// Generate access + refresh tokens
function generateTokens(userId) {
  const accessToken = jwt.sign(
    { userId },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
  );
  const refreshToken = jwt.sign(
    { userId, type: 'refresh' },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' }
  );
  return { accessToken, refreshToken };
}

// Register a new user
async function register({ email, password, full_name }) {
  const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
  if (existing.rows.length) {
    const err = new Error('Email already registered'); err.status = 409; throw err;
  }

  const password_hash = await hashPassword(password);
  const { rows } = await query(
    `INSERT INTO users (email, password_hash, full_name)
     VALUES ($1, $2, $3) RETURNING id, email, full_name, created_at`,
    [email, password_hash, full_name]
  );

  const user = rows[0];

  // Create default USDT wallet
  await query(
    'INSERT INTO wallets (user_id, coin, balance) VALUES ($1, $2, $3)',
    [user.id, 'USDT', 0]
  );

  // Send welcome email
  await emailService.sendWelcome(email, full_name);

  const tokens = generateTokens(user.id);
  await storeRefreshToken(user.id, tokens.refreshToken);

  return { user, ...tokens };
}

// Login
async function login({ email, password, totp_code }) {
  const { rows } = await query(
    'SELECT id, email, password_hash, two_fa_enabled, two_fa_secret, is_active FROM users WHERE email = $1',
    [email]
  );

  const user = rows[0];
  if (!user || !await verifyPassword(password, user.password_hash)) {
    const err = new Error('Invalid email or password'); err.status = 401; throw err;
  }

  if (!user.is_active) {
    const err = new Error('Account deactivated'); err.status = 403; throw err;
  }

  // Check 2FA if enabled
  if (user.two_fa_enabled) {
    if (!totp_code) {
      const err = new Error('2FA code required'); err.status = 401; err.code = '2FA_REQUIRED'; throw err;
    }
    const valid = speakeasy.totp.verify({
      secret: user.two_fa_secret,
      encoding: 'base32',
      token: totp_code,
      window: 1,
    });
    if (!valid) {
      const err = new Error('Invalid 2FA code'); err.status = 401; throw err;
    }
  }

  const tokens = generateTokens(user.id);
  await storeRefreshToken(user.id, tokens.refreshToken);

  return {
    user: { id: user.id, email: user.email },
    ...tokens,
  };
}

// Refresh access token
async function refreshAccessToken(refreshToken) {
  let decoded;
  try {
    decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
  } catch {
    const err = new Error('Invalid refresh token'); err.status = 401; throw err;
  }

  const stored = await getCache(`refresh:${decoded.userId}`);
  if (stored !== refreshToken) {
    const err = new Error('Refresh token revoked'); err.status = 401; throw err;
  }

  const tokens = generateTokens(decoded.userId);
  await storeRefreshToken(decoded.userId, tokens.refreshToken);
  return tokens;
}

// Logout — revoke refresh token
async function logout(userId) {
  await delCache(`refresh:${userId}`);
}

// Setup 2FA — generate secret & QR URI
async function setup2FA(userId, email) {
  const secret = speakeasy.generateSecret({ name: `NexTrade:${email}`, length: 20 });
  await query('UPDATE users SET two_fa_secret = $1 WHERE id = $2', [secret.base32, userId]);
  return { secret: secret.base32, otpauth_url: secret.otpauth_url };
}

// Verify & enable 2FA
async function enable2FA(userId, token) {
  const { rows } = await query('SELECT two_fa_secret FROM users WHERE id = $1', [userId]);
  const valid = speakeasy.totp.verify({
    secret: rows[0].two_fa_secret,
    encoding: 'base32',
    token,
    window: 1,
  });
  if (!valid) { const err = new Error('Invalid 2FA code'); err.status = 400; throw err; }
  await query('UPDATE users SET two_fa_enabled = true WHERE id = $1', [userId]);
  return { message: '2FA enabled successfully' };
}

// Store refresh token in Redis (7 days TTL)
async function storeRefreshToken(userId, token) {
  await setCache(`refresh:${userId}`, token, 7 * 24 * 60 * 60);
}

module.exports = { register, login, refreshAccessToken, logout, setup2FA, enable2FA };
