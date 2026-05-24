const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { query } = require('../config/database');

// GET /api/user/profile
router.get('/profile', authenticate, async (req, res, next) => {
  try {
    const { rows } = await query(
      'SELECT id, email, full_name, kyc_status, two_fa_enabled, created_at FROM users WHERE id = $1',
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// PUT /api/user/profile
router.put('/profile', authenticate, async (req, res, next) => {
  try {
    const { full_name } = req.body;
    if (!full_name) return res.status(400).json({ error: 'Full name required' });
    const { rows } = await query(
      'UPDATE users SET full_name = $1 WHERE id = $2 RETURNING id, email, full_name, kyc_status',
      [full_name, req.user.id]
    );
    res.json(rows[0]);
  } catch (err) { next(err); }
});

module.exports = router;
