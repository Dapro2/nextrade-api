const express = require('express');
const router = express.Router();
const binance = require('../services/binance.service');

// GET /api/market/prices — all live prices
router.get('/prices', async (req, res, next) => {
  try {
    const tickers = await binance.get24hTicker();
    // Filter to our supported pairs and format nicely
    const supported = ['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT','ADAUSDT','AVAXUSDT','DOGEUSDT','DOTUSDT','MATICUSDT'];
    const prices = (Array.isArray(tickers) ? tickers : [tickers])
      .filter(t => supported.includes(t.symbol))
      .map(t => ({
        symbol:     t.symbol.replace('USDT', ''),
        pair:       t.symbol,
        price:      parseFloat(t.lastPrice),
        change24h:  parseFloat(t.priceChangePercent),
        high24h:    parseFloat(t.highPrice),
        low24h:     parseFloat(t.lowPrice),
        volume24h:  parseFloat(t.volume),
        quoteVolume:parseFloat(t.quoteVolume),
      }));
    res.json(prices);
  } catch (err) { next(err); }
});

// GET /api/market/:symbol/price — single coin price
router.get('/:symbol/price', async (req, res, next) => {
  try {
    const symbol = req.params.symbol.toUpperCase() + 'USDT';
    const data = await binance.getPrice(symbol);
    res.json({ symbol: req.params.symbol.toUpperCase(), price: parseFloat(data.price) });
  } catch (err) { next(err); }
});

// GET /api/market/:symbol/klines — candlestick chart data
router.get('/:symbol/klines', async (req, res, next) => {
  try {
    const symbol   = req.params.symbol.toUpperCase() + 'USDT';
    const interval = req.query.interval || '1d';
    const limit    = parseInt(req.query.limit) || 100;
    const data = await binance.getKlines(symbol, interval, limit);
    res.json(data);
  } catch (err) { next(err); }
});

// GET /api/market/:symbol/orderbook — live order book
router.get('/:symbol/orderbook', async (req, res, next) => {
  try {
    const symbol = req.params.symbol.toUpperCase() + 'USDT';
    const limit  = parseInt(req.query.limit) || 20;
    const data = await binance.getOrderBook(symbol, limit);
    // Format bids/asks as [price, amount] arrays
    res.json({
      bids: data.bids.slice(0, 10).map(([p, a]) => ({ price: parseFloat(p), amount: parseFloat(a) })),
      asks: data.asks.slice(0, 10).map(([p, a]) => ({ price: parseFloat(p), amount: parseFloat(a) })),
    });
  } catch (err) { next(err); }
});

// GET /api/market/:symbol/trades — recent trades
router.get('/:symbol/trades', async (req, res, next) => {
  try {
    const symbol = req.params.symbol.toUpperCase() + 'USDT';
    const data = await binance.getRecentTrades(symbol, 20);
    res.json(data.map(t => ({
      price:  parseFloat(t.price),
      amount: parseFloat(t.qty),
      side:   t.isBuyerMaker ? 'sell' : 'buy',
      time:   t.time,
    })));
  } catch (err) { next(err); }
});

// GET /api/market/stats — global market stats (from 24h data)
router.get('/stats', async (req, res, next) => {
  try {
    const tickers = await binance.get24hTicker();
    const all = Array.isArray(tickers) ? tickers : [tickers];
    const usdtPairs = all.filter(t => t.symbol.endsWith('USDT'));
    const totalVolume = usdtPairs.reduce((s, t) => s + parseFloat(t.quoteVolume), 0);
    const btc = all.find(t => t.symbol === 'BTCUSDT');
    res.json({
      total_volume_usd:  totalVolume,
      btc_price:         btc ? parseFloat(btc.lastPrice) : null,
      btc_change_24h:    btc ? parseFloat(btc.priceChangePercent) : null,
      active_pairs:      usdtPairs.length,
    });
  } catch (err) { next(err); }
});

module.exports = router;
