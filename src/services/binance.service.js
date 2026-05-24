/**
 * NexTrade — Binance API Integration Service
 * Handles all communication with Binance REST + WebSocket APIs.
 * Docs: https://binance-docs.github.io/apidocs/spot/en/
 */

const axios = require('axios');
const crypto = require('crypto');
const WebSocket = require('ws');
const { setCache, getCache } = require('../config/redis');

const BASE_URL = process.env.BINANCE_BASE_URL || 'https://api.binance.com';
const API_KEY    = process.env.BINANCE_API_KEY;
const API_SECRET = process.env.BINANCE_SECRET_KEY;

// ─── Helpers ────────────────────────────────────────────────────────────────

// Sign a query string with HMAC SHA256
function sign(queryString) {
  return crypto
    .createHmac('sha256', API_SECRET)
    .update(queryString)
    .digest('hex');
}

// Build signed params string
function signedParams(params = {}) {
  const timestamp = Date.now();
  const query = new URLSearchParams({ ...params, timestamp }).toString();
  return `${query}&signature=${sign(query)}`;
}

// Public request (no auth needed)
async function publicRequest(path, params = {}) {
  const query = new URLSearchParams(params).toString();
  const url = `${BASE_URL}${path}${query ? '?' + query : ''}`;
  const { data } = await axios.get(url, { timeout: 8000 });
  return data;
}

// Private request (requires API key + signature)
async function privateRequest(method, path, params = {}) {
  const query = signedParams(params);
  const url = `${BASE_URL}${path}?${query}`;
  const { data } = await axios({
    method,
    url,
    headers: { 'X-MBX-APIKEY': API_KEY },
    timeout: 10000,
  });
  return data;
}

// ─── Market Data (Public) ────────────────────────────────────────────────────

// Get live price for one or all symbols
async function getPrice(symbol) {
  const cacheKey = `binance:price:${symbol || 'all'}`;
  const cached = await getCache(cacheKey);
  if (cached) return cached;

  const data = await publicRequest('/api/v3/ticker/price',
    symbol ? { symbol } : {}
  );

  await setCache(cacheKey, data, 5); // 5 second cache
  return data;
}

// Get 24h ticker stats
async function get24hTicker(symbol) {
  const cacheKey = `binance:24h:${symbol || 'all'}`;
  const cached = await getCache(cacheKey);
  if (cached) return cached;

  const data = await publicRequest('/api/v3/ticker/24hr',
    symbol ? { symbol } : {}
  );

  await setCache(cacheKey, data, 30);
  return data;
}

// Get order book
async function getOrderBook(symbol, limit = 20) {
  const cacheKey = `binance:orderbook:${symbol}:${limit}`;
  const cached = await getCache(cacheKey);
  if (cached) return cached;

  const data = await publicRequest('/api/v3/depth', { symbol, limit });
  await setCache(cacheKey, data, 2);
  return data;
}

// Get candlestick / kline data
async function getKlines(symbol, interval = '1d', limit = 100) {
  const cacheKey = `binance:klines:${symbol}:${interval}:${limit}`;
  const cached = await getCache(cacheKey);
  if (cached) return cached;

  const raw = await publicRequest('/api/v3/klines', { symbol, interval, limit });

  // Format: [time, open, high, low, close, volume]
  const klines = raw.map(([time, open, high, low, close, volume]) => ({
    time:   Math.floor(time / 1000),
    open:   parseFloat(open),
    high:   parseFloat(high),
    low:    parseFloat(low),
    close:  parseFloat(close),
    volume: parseFloat(volume),
  }));

  const ttl = interval === '1m' ? 30 : interval === '1h' ? 120 : 300;
  await setCache(cacheKey, klines, ttl);
  return klines;
}

// Get recent trades for a symbol
async function getRecentTrades(symbol, limit = 20) {
  return publicRequest('/api/v3/trades', { symbol, limit });
}

// ─── Broker Sub-Account Management ──────────────────────────────────────────
// Used when you are an approved Binance Broker

// Create a sub-account for a new user
async function createSubAccount(email) {
  try {
    const data = await privateRequest('POST',
      '/sapi/v1/broker/subAccount',
      { email }
    );
    return data;
  } catch (err) {
    throw Object.assign(
      new Error('Failed to create Binance sub-account: ' + (err.response?.data?.msg || err.message)),
      { status: 500 }
    );
  }
}

// Get deposit address for a sub-account
async function getSubAccountDepositAddress(subAccountId, coin, network) {
  return privateRequest('GET', '/sapi/v1/broker/subAccount/depositAddress', {
    subAccountId, coin, network,
  });
}

// Get sub-account balances
async function getSubAccountBalances(subAccountId) {
  return privateRequest('GET', '/sapi/v1/broker/subAccount/spotSummary', {
    subAccountId,
  });
}

// Transfer from sub-account to master (broker fee collection)
async function transferFromSubAccount(subAccountId, asset, amount) {
  return privateRequest('POST', '/sapi/v1/broker/transfer', {
    fromId: subAccountId,
    asset,
    amount,
  });
}

// ─── Trading (Sub-Account Orders) ───────────────────────────────────────────

// Place a market or limit order on behalf of sub-account
async function placeOrder({ symbol, side, type, quantity, price, subAccountId }) {
  const params = {
    symbol:   symbol.replace('/', ''),  // BTC/USDT → BTCUSDT
    side:     side.toUpperCase(),       // BUY | SELL
    type:     type.toUpperCase(),       // MARKET | LIMIT
    quantity: quantity.toFixed(8),
  };

  if (type === 'limit') {
    params.price = price.toFixed(8);
    params.timeInForce = 'GTC'; // Good Till Cancelled
  }

  // If broker program approved, use sub-account endpoint
  if (subAccountId) {
    params.subAccountId = subAccountId;
    return privateRequest('POST', '/sapi/v1/broker/subAccount/futures/order', params);
  }

  // Otherwise use standard account
  return privateRequest('POST', '/api/v3/order', params);
}

// Cancel an order
async function cancelOrder(symbol, orderId) {
  return privateRequest('DELETE', '/api/v3/order', {
    symbol: symbol.replace('/', ''),
    orderId,
  });
}

// Get order status
async function getOrderStatus(symbol, orderId) {
  return privateRequest('GET', '/api/v3/order', {
    symbol: symbol.replace('/', ''),
    orderId,
  });
}

// Get all open orders
async function getOpenOrders(symbol) {
  return privateRequest('GET', '/api/v3/openOrders',
    symbol ? { symbol: symbol.replace('/', '') } : {}
  );
}

// ─── Account Info ────────────────────────────────────────────────────────────

async function getAccountInfo() {
  return privateRequest('GET', '/api/v3/account');
}

async function getTradeHistory(symbol, limit = 50) {
  return privateRequest('GET', '/api/v3/myTrades', {
    symbol: symbol.replace('/', ''),
    limit,
  });
}

// ─── WebSocket Price Streaming ───────────────────────────────────────────────

const WS_BASE = 'wss://stream.binance.com:9443/stream';

/**
 * Subscribe to multiple symbol price streams.
 * Calls onUpdate({ symbol, price, change24h }) on each tick.
 */
function subscribePriceStream(symbols, onUpdate, onError) {
  const streams = symbols
    .map(s => `${s.toLowerCase().replace('/', '')}@ticker`)
    .join('/');

  const ws = new WebSocket(`${WS_BASE}?streams=${streams}`);

  ws.on('message', (raw) => {
    try {
      const { data } = JSON.parse(raw);
      onUpdate({
        symbol:    data.s,                        // e.g. "BTCUSDT"
        price:     parseFloat(data.c),            // current price
        change24h: parseFloat(data.P),            // 24h % change
        high24h:   parseFloat(data.h),
        low24h:    parseFloat(data.l),
        volume24h: parseFloat(data.v),
      });
    } catch {}
  });

  ws.on('error', onError);
  ws.on('close', () => {
    // Auto-reconnect after 3s
    setTimeout(() => subscribePriceStream(symbols, onUpdate, onError), 3000);
  });

  return ws;
}

// ─── Affiliate / Commission Tracking ─────────────────────────────────────────

// Get broker commission earned (requires broker approval)
async function getBrokerCommission(startTime, endTime) {
  return privateRequest('GET', '/sapi/v1/broker/rebate/recentRecord', {
    startTime,
    endTime,
    limit: 500,
  });
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  // Market data
  getPrice,
  get24hTicker,
  getOrderBook,
  getKlines,
  getRecentTrades,

  // Trading
  placeOrder,
  cancelOrder,
  getOrderStatus,
  getOpenOrders,

  // Account
  getAccountInfo,
  getTradeHistory,

  // Broker / sub-accounts
  createSubAccount,
  getSubAccountDepositAddress,
  getSubAccountBalances,
  transferFromSubAccount,

  // Streaming
  subscribePriceStream,

  // Commissions
  getBrokerCommission,
};
