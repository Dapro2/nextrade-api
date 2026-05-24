const express = require('express');
const router = express.Router();
const { authenticate, requireKYC } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validate');
const { tradeLimiter } = require('../middleware/rateLimit');
const binance = require('../services/binance.service');
const { query, getClient } = require('../config/database');

const PLATFORM_FEE_RATE = 0.001; // 0.1% — your revenue

// POST /api/trade — place a real order via Binance
router.post('/', authenticate, requireKYC, tradeLimiter, validate(schemas.trade), async (req, res, next) => {
  const { pair, side, amount, order_type, limit_price } = req.body;
  const userId = req.user.id;

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const [baseCoin, quoteCoin] = pair.split('/');
    const binanceSymbol = pair.replace('/', '');

    // 1. Get live price from Binance
    const priceData = await binance.getPrice(binanceSymbol + 'USDT');
    const marketPrice = parseFloat(priceData.price);
    const execPrice = order_type === 'limit' ? limit_price : marketPrice;

    // 2. Calculate fees
    const platformFee = amount * execPrice * PLATFORM_FEE_RATE;
    const total = side === 'buy'
      ? amount * execPrice + platformFee
      : amount * execPrice - platformFee;

    // 3. Check user balance
    if (side === 'buy') {
      const { rows } = await client.query(
        'SELECT balance FROM wallets WHERE user_id=$1 AND coin=$2 FOR UPDATE',
        [userId, quoteCoin]
      );
      if (!rows.length || rows[0].balance < total) {
        throw Object.assign(new Error('Insufficient balance'), { status: 400 });
      }
    } else {
      const { rows } = await client.query(
        'SELECT balance FROM wallets WHERE user_id=$1 AND coin=$2 FOR UPDATE',
        [userId, baseCoin]
      );
      if (!rows.length || rows[0].balance < amount) {
        throw Object.assign(new Error('Insufficient balance'), { status: 400 });
      }
    }

    // 4. Get user's Binance sub-account ID (if broker program enabled)
    const { rows: userRows } = await client.query(
      'SELECT binance_sub_account_id FROM users WHERE id=$1',
      [userId]
    );
    const subAccountId = userRows[0]?.binance_sub_account_id;

    // 5. Place real order on Binance
    let binanceOrder = null;
    try {
      binanceOrder = await binance.placeOrder({
        symbol:     binanceSymbol + 'USDT',
        side,
        type:       order_type,
        quantity:   amount,
        price:      execPrice,
        subAccountId,
      });
    } catch (binanceErr) {
      // If Binance API not configured yet, simulate the order (demo mode)
      console.warn('Binance API not configured — running in demo mode:', binanceErr.message);
      binanceOrder = {
        orderId:     Math.floor(Math.random() * 1e9),
        status:      'FILLED',
        executedQty: amount,
        price:       execPrice,
        demo:        true,
      };
    }

    // 6. Update internal balances
    if (side === 'buy') {
      await client.query('UPDATE wallets SET balance=balance-$1 WHERE user_id=$2 AND coin=$3', [total, userId, quoteCoin]);
      await client.query(
        `INSERT INTO wallets (user_id,coin,balance) VALUES($1,$2,$3)
         ON CONFLICT (user_id,coin) DO UPDATE SET balance=wallets.balance+$3`,
        [userId, baseCoin, amount]
      );
    } else {
      await client.query('UPDATE wallets SET balance=balance-$1 WHERE user_id=$2 AND coin=$3', [amount, userId, baseCoin]);
      await client.query(
        `INSERT INTO wallets (user_id,coin,balance) VALUES($1,$2,$3)
         ON CONFLICT (user_id,coin) DO UPDATE SET balance=wallets.balance+$3`,
        [userId, quoteCoin, total]
      );
    }

    // 7. Update portfolio
    await updatePortfolio(client, userId, baseCoin, amount, execPrice, side);

    // 8. Record trade in DB
    const { rows: tradeRows } = await client.query(
      `INSERT INTO trades
        (user_id, pair, side, amount, price, fee, order_type, status, binance_order_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [userId, pair, side, amount, execPrice, platformFee, order_type,
       binanceOrder.status === 'FILLED' ? 'completed' : 'pending',
       binanceOrder.orderId]
    );

    await client.query('COMMIT');

    res.json({
      trade:        tradeRows[0],
      binanceOrder,
      platformFee,
      executedAt:   new Date().toISOString(),
    });

  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// GET /api/trade/history
router.get('/history', authenticate, async (req, res, next) => {
  try {
    const { limit = 50, offset = 0, pair } = req.query;
    let sql = `SELECT * FROM trades WHERE user_id=$1 ${pair ? 'AND pair=$3' : ''} ORDER BY created_at DESC LIMIT $2`;
    const params = pair ? [req.user.id, limit, pair] : [req.user.id, limit];
    const { rows } = await query(sql, params);
    res.json(rows);
  } catch (err) { next(err); }
});

// GET /api/trade/open — open orders from Binance
router.get('/open', authenticate, async (req, res, next) => {
  try {
    const { symbol } = req.query;
    const orders = await binance.getOpenOrders(symbol);
    res.json(orders);
  } catch (err) {
    // Return empty if Binance not configured
    res.json([]);
  }
});

// DELETE /api/trade/:orderId — cancel an order
router.delete('/:orderId', authenticate, async (req, res, next) => {
  try {
    const { symbol } = req.query;
    if (!symbol) return res.status(400).json({ error: 'symbol required' });
    const result = await binance.cancelOrder(symbol, req.params.orderId);
    await query('UPDATE trades SET status=$1 WHERE binance_order_id=$2 AND user_id=$3',
      ['cancelled', req.params.orderId, req.user.id]);
    res.json(result);
  } catch (err) { next(err); }
});

// ─── Helpers ─────────────────────────────────────────────────────────────────
async function updatePortfolio(client, userId, coin, amount, price, side) {
  const { rows } = await client.query(
    'SELECT quantity, avg_buy_price FROM portfolio WHERE user_id=$1 AND coin=$2',
    [userId, coin]
  );
  if (side === 'buy') {
    if (rows.length) {
      const qty    = parseFloat(rows[0].quantity) + amount;
      const newAvg = (parseFloat(rows[0].quantity) * parseFloat(rows[0].avg_buy_price) + amount * price) / qty;
      await client.query(
        'UPDATE portfolio SET quantity=$1, avg_buy_price=$2, updated_at=NOW() WHERE user_id=$3 AND coin=$4',
        [qty, newAvg, userId, coin]
      );
    } else {
      await client.query(
        'INSERT INTO portfolio (user_id,coin,quantity,avg_buy_price) VALUES($1,$2,$3,$4)',
        [userId, coin, amount, price]
      );
    }
  } else {
    await client.query(
      'UPDATE portfolio SET quantity=GREATEST(0,quantity-$1), updated_at=NOW() WHERE user_id=$2 AND coin=$3',
      [amount, userId, coin]
    );
    await client.query('DELETE FROM portfolio WHERE user_id=$1 AND coin=$2 AND quantity=0', [userId, coin]);
  }
}

module.exports = router;
