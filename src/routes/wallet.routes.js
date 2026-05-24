const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { query } = require('../config/database');

// GET /api/wallet/balance
router.get('/balance', authenticate, async (req, res, next) => {
  try {
    const { rows } = await query(
      'SELECT * FROM wallets WHERE user_id = $1',
      [req.user.id]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// POST /api/wallet/deposit (demo)
router.post('/deposit', authenticate, async (req, res, next) => {
  try {
    const { coin, amount } = req.body;
    if (!coin || !amount) return res.status(400).json({ error: 'Coin and amount required' });
    await query(
      `INSERT INTO wallets (user_id, coin, balance)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, coin) DO UPDATE SET balance = wallets.balance + $3`,
      [req.user.id, coin.toUpperCase(), amount]
    );
    res.json({ message: `Deposited ${amount} ${coin} successfully` });
  } catch (err) { next(err); }
});

module.exports = router;
