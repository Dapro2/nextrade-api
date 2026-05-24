const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { query } = require('../config/database');

// GET /api/portfolio
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { rows } = await query(
      'SELECT * FROM portfolio WHERE user_id = $1 ORDER BY quantity DESC',
      [req.user.id]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

module.exports = router;
