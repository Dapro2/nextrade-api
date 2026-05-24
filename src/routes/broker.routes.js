const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const binance = require('../services/binance.service');
const { query } = require('../config/database');

// GET /api/broker/commission — your earnings from Binance
router.get('/commission', authenticate, async (req, res, next) => {
  try {
    // Only admin can view this
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });

    const now   = Date.now();
    const start = now - 30 * 24 * 60 * 60 * 1000; // last 30 days

    let binanceCommission = null;
    try {
      binanceCommission = await binance.getBrokerCommission(start, now);
    } catch {
      binanceCommission = { note: 'Binance broker program not yet activated' };
    }

    // Platform fees collected internally
    const { rows: feeRows } = await query(`
      SELECT
        SUM(fee) as total_fees,
        COUNT(*) as total_trades,
        DATE_TRUNC('day', created_at) as day
      FROM trades
      WHERE created_at > NOW() - INTERVAL '30 days'
        AND status = 'completed'
      GROUP BY day
      ORDER BY day DESC
    `);

    res.json({
      platform_fees: {
        total:  feeRows.reduce((s, r) => s + parseFloat(r.total_fees), 0),
        trades: feeRows.reduce((s, r) => s + parseInt(r.total_trades), 0),
        daily:  feeRows,
      },
      binance_commission: binanceCommission,
    });
  } catch (err) { next(err); }
});

// GET /api/broker/stats — overall platform stats for admin
router.get('/stats', authenticate, async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });

    const [users, trades, volume] = await Promise.all([
      query('SELECT COUNT(*) FROM users'),
      query("SELECT COUNT(*) FROM trades WHERE status='completed'"),
      query("SELECT SUM(amount * price) as vol FROM trades WHERE status='completed'"),
    ]);

    res.json({
      total_users:  parseInt(users.rows[0].count),
      total_trades: parseInt(trades.rows[0].count),
      total_volume: parseFloat(volume.rows[0].vol) || 0,
    });
  } catch (err) { next(err); }
});

module.exports = router;
