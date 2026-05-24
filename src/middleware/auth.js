const jwt = require('jsonwebtoken');
const { query } = require('../config/database');

async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Verify user still exists and is active
    const { rows } = await query(
      'SELECT id, email, kyc_status, is_active FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (!rows.length || !rows[0].is_active) {
      return res.status(401).json({ error: 'User not found or deactivated' });
    }

    req.user = rows[0];
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// Require KYC verification for trading
function requireKYC(req, res, next) {
  if (req.user.kyc_status !== 'verified') {
    return res.status(403).json({
      error: 'KYC verification required to trade',
      kyc_status: req.user.kyc_status,
    });
  }
  next();
}

module.exports = { authenticate, requireKYC };
