const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { query } = require('../config/database');

// GET /api/kyc/status
router.get('/status', authenticate, async (req, res, next) => {
  try {
    const { rows } = await query(
      'SELECT kyc_status FROM users WHERE id = $1',
      [req.user.id]
    );
    res.json({ kyc_status: rows[0]?.kyc_status || 'pending' });
  } catch (err) { next(err); }
});

// POST /api/kyc/submit
router.post('/submit', authenticate, async (req, res, next) => {
  try {
    await query(
      "UPDATE users SET kyc_status = 'submitted' WHERE id = $1",
      [req.user.id]
    );
    res.json({ message: 'KYC submitted successfully. Under review.' });
  } catch (err) { next(err); }
});

module.exports = router;
