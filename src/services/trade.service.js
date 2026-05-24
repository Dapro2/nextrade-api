const { query, getClient } = require('../config/database');
const { getCoinPrice } = require('./market.service');

const FEE_RATE = 0.001; // 0.1%

// Execute a trade (buy or sell)
async function executeTrade({ userId, pair, side, amount, order_type, limit_price }) {
  const [baseCoin, quoteCoin] = pair.split('/'); // e.g. BTC / USDT

  // Get current market price
  const marketPrice = await getCoinPrice(baseCoin);
  const price = order_type === 'limit' ? limit_price : marketPrice;

  const fee = amount * price * FEE_RATE;
  const total = amount * price + (side === 'buy' ? fee : -fee);

  const client = await getClient();
  try {
    await client.query('BEGIN');

    if (side === 'buy') {
      // Deduct USDT from wallet
      const { rows: quoteWallet } = await client.query(
        'SELECT balance FROM wallets WHERE user_id = $1 AND coin = $2 FOR UPDATE',
        [userId, quoteCoin]
      );
      if (!quoteWallet.length || quoteWallet[0].balance < total) {
        throw Object.assign(new Error('Insufficient balance'), { status: 400 });
      }

      await client.query(
        'UPDATE wallets SET balance = balance - $1 WHERE user_id = $2 AND coin = $3',
        [total, userId, quoteCoin]
      );

      // Add base coin to wallet (create if not exists)
      await client.query(
        `INSERT INTO wallets (user_id, coin, balance)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, coin) DO UPDATE SET balance = wallets.balance + $3`,
        [userId, baseCoin, amount]
      );

      // Update portfolio
      await updatePortfolioEntry(client, userId, baseCoin, amount, price);

    } else {
      // side === 'sell'
      const { rows: baseWallet } = await client.query(
        'SELECT balance FROM wallets WHERE user_id = $1 AND coin = $2 FOR UPDATE',
        [userId, baseCoin]
      );
      if (!baseWallet.length || baseWallet[0].balance < amount) {
        throw Object.assign(new Error('Insufficient balance'), { status: 400 });
      }

      await client.query(
        'UPDATE wallets SET balance = balance - $1 WHERE user_id = $2 AND coin = $3',
        [amount, userId, baseCoin]
      );

      await client.query(
        `INSERT INTO wallets (user_id, coin, balance)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, coin) DO UPDATE SET balance = wallets.balance + $3`,
        [userId, quoteCoin, total]
      );

      // Reduce portfolio entry
      await reducePortfolioEntry(client, userId, baseCoin, amount);
    }

    // Record the trade
    const { rows: trade } = await client.query(
      `INSERT INTO trades (user_id, pair, side, amount, price, fee, order_type, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'completed')
       RETURNING *`,
      [userId, pair, side, amount, price, fee, order_type]
    );

    await client.query('COMMIT');
    return trade[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Update avg buy price in portfolio
async function updatePortfolioEntry(client, userId, coin, amount, price) {
  const { rows } = await client.query(
    'SELECT quantity, avg_buy_price FROM portfolio WHERE user_id = $1 AND coin = $2',
    [userId, coin]
  );

  if (rows.length) {
    const existing = rows[0];
    const totalQty = parseFloat(existing.quantity) + amount;
    const newAvg =
      (parseFloat(existing.quantity) * parseFloat(existing.avg_buy_price) + amount * price) / totalQty;

    await client.query(
      'UPDATE portfolio SET quantity = $1, avg_buy_price = $2, updated_at = NOW() WHERE user_id = $3 AND coin = $4',
      [totalQty, newAvg, userId, coin]
    );
  } else {
    await client.query(
      'INSERT INTO portfolio (user_id, coin, quantity, avg_buy_price) VALUES ($1, $2, $3, $4)',
      [userId, coin, amount, price]
    );
  }
}

// Reduce portfolio quantity on sell
async function reducePortfolioEntry(client, userId, coin, amount) {
  await client.query(
    `UPDATE portfolio
     SET quantity = GREATEST(0, quantity - $1), updated_at = NOW()
     WHERE user_id = $2 AND coin = $3`,
    [amount, userId, coin]
  );
  // Remove zero-balance entries
  await client.query(
    'DELETE FROM portfolio WHERE user_id = $1 AND coin = $2 AND quantity = 0',
    [userId, coin]
  );
}

// Get trade history for a user
async function getTradeHistory(userId, { limit = 50, offset = 0, pair } = {}) {
  let sql = `
    SELECT * FROM trades
    WHERE user_id = $1
    ${pair ? 'AND pair = $3' : ''}
    ORDER BY created_at DESC
    LIMIT $2 OFFSET ${offset}
  `;
  const params = pair ? [userId, limit, pair] : [userId, limit];
  const { rows } = await query(sql, params);
  return rows;
}

module.exports = { executeTrade, getTradeHistory };
