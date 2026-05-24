/**
 * NexTrade — KuCoin API Integration Service
 * Backup exchange when Binance is unavailable.
 * Docs: https://docs.kucoin.com
 */

const axios = require('axios');
const crypto = require('crypto');
const { setCache, getCache } = require('../config/redis');

const BASE_URL   = process.env.KUCOIN_BASE_URL || 'https://api.kucoin.com';
const API_KEY    = process.env.KUCOIN_API_KEY;
const API_SECRET = process.env.KUCOIN_SECRET_KEY;
const PASSPHRASE = process.env.KUCOIN_PASSPHRASE;

// ─── Helpers ────────────────────────────────────────────────────────────────

function sign(timestamp, method, endpoint, body = '') {
  const str = `${timestamp}${method.toUpperCase()}${endpoint}${body}`;
  return crypto.createHmac('sha256', API_SECRET).update(str).digest('base64');
}

function signPassphrase() {
  return crypto.createHmac('sha256', API_SECRET).update(PASSPHRASE).digest('base64');
}

async function publicRequest(path, params = {}) {
  const query = new URLSearchParams(params).toString();
  const url   = `${BASE_URL}${path}${query ? '?' + query : ''}`;
  const { data } = await axios.get(url, { timeout: 8000 });
  if (data.code !== '200000') throw new Error(data.msg || 'KuCoin API error');
  return data.data;
}

async function privateRequest(method, path, body = {}) {
  const timestamp  = Date.now().toString();
  const bodyStr    = method === 'GET' ? '' : JSON.stringify(body);
  const signature  = sign(timestamp, method, path, bodyStr);

  const { data } = await axios({
    method,
    url: `${BASE_URL}${path}`,
    headers: {
      'KC-API-KEY':         API_KEY,
      'KC-API-SIGN':        signature,
      'KC-API-TIMESTAMP':   timestamp,
      'KC-API-PASSPHRASE':  signPassphrase(),
      'KC-API-KEY-VERSION': '2',
      'Content-Type':       'application/json',
    },
    data: method !== 'GET' ? body : undefined,
    timeout: 10000,
  });

  if (data.code !== '200000') throw new Error(data.msg || 'KuCoin API error');
  return data.data;
}

// ─── Market Data ─────────────────────────────────────────────────────────────

// Convert our symbol format to KuCoin format: BTC → BTC-USDT
function toKuCoinSymbol(symbol) {
  if (symbol.includes('-')) return symbol;
  if (symbol.includes('/')) return symbol.replace('/', '-');
  return `${symbol}-USDT`;
}

async function getPrice(symbol) {
  const kcSymbol = toKuCoinSymbol(symbol);
  const cacheKey = `kucoin:price:${kcSymbol}`;
  const cached   = await getCache(cacheKey);
  if (cached) return cached;

  const data = await publicRequest('/api/v1/market/orderbook/level1', { symbol: kcSymbol });
  const result = { symbol: kcSymbol, price: parseFloat(data.price) };
  await setCache(cacheKey, result, 5);
  return result;
}

async function get24hTicker(symbol) {
  const cacheKey = `kucoin:24h:${symbol || 'all'}`;
  const cached   = await getCache(cacheKey);
  if (cached) return cached;

  const supported = ['BTC-USDT','ETH-USDT','SOL-USDT','BNB-USDT',
                     'XRP-USDT','ADA-USDT','AVAX-USDT','DOGE-USDT'];

  if (symbol) {
    const data = await publicRequest('/api/v1/market/stats', { symbol: toKuCoinSymbol(symbol) });
    const result = formatTicker(data);
    await setCache(cacheKey, result, 30);
    return result;
  }

  // Fetch all tickers and filter to supported
  const data  = await publicRequest('/api/v1/market/allTickers');
  const tickers = (data.ticker || [])
    .filter(t => supported.includes(t.symbol))
    .map(formatTicker);
  await setCache(cacheKey, tickers, 30);
  return tickers;
}

function formatTicker(t) {
  return {
    symbol:      t.symbol,
    price:       parseFloat(t.last || t.buy || 0),
    change24h:   parseFloat(t.changeRate || 0) * 100,
    high24h:     parseFloat(t.high || 0),
    low24h:      parseFloat(t.low || 0),
    volume24h:   parseFloat(t.vol || 0),
    quoteVolume: parseFloat(t.volValue || 0),
  };
}

async function getOrderBook(symbol, limit = 20) {
  const kcSymbol = toKuCoinSymbol(symbol);
  const cacheKey = `kucoin:orderbook:${kcSymbol}`;
  const cached   = await getCache(cacheKey);
  if (cached) return cached;

  const data = await publicRequest('/api/v1/market/orderbook/level2_20', { symbol: kcSymbol });
  const result = {
    bids: (data.bids || []).slice(0, 10).map(([p, a]) => ({ price: parseFloat(p), amount: parseFloat(a) })),
    asks: (data.asks || []).slice(0, 10).map(([p, a]) => ({ price: parseFloat(p), amount: parseFloat(a) })),
  };
  await setCache(cacheKey, result, 2);
  return result;
}

async function getKlines(symbol, interval = '1day', limit = 100) {
  const kcSymbol = toKuCoinSymbol(symbol);
  const cacheKey = `kucoin:klines:${kcSymbol}:${interval}`;
  const cached   = await getCache(cacheKey);
  if (cached) return cached;

  // KuCoin interval format: 1min, 3min, 5min, 15min, 30min, 1hour, 2hour, 4hour, 6hour, 8hour, 12hour, 1day, 1week
  const kcInterval = interval === '1d' ? '1day' : interval === '1h' ? '1hour' : interval;
  const data = await publicRequest('/api/v1/market/candles', { symbol: kcSymbol, type: kcInterval });

  // KuCoin returns [time, open, close, high, low, volume, turnover]
  const klines = (data || []).slice(0, limit).map(([time, open, close, high, low, volume]) => ({
    time:   parseInt(time),
    open:   parseFloat(open),
    high:   parseFloat(high),
    low:    parseFloat(low),
    close:  parseFloat(close),
    volume: parseFloat(volume),
  })).reverse();

  await setCache(cacheKey, klines, 60);
  return klines;
}

// ─── Trading ─────────────────────────────────────────────────────────────────

async function placeOrder({ symbol, side, type, quantity, price }) {
  const kcSymbol = toKuCoinSymbol(symbol);
  const params = {
    clientOid: `nextrade_${Date.now()}`,
    side:      side.toLowerCase(),        // buy | sell
    symbol:    kcSymbol,
    type:      type.toLowerCase(),        // market | limit
    size:      quantity.toFixed(8),
  };

  if (type === 'limit') {
    params.price = price.toFixed(8);
    params.timeInForce = 'GTC';
  }

  return privateRequest('POST', '/api/v1/orders', params);
}

async function cancelOrder(orderId) {
  return privateRequest('DELETE', `/api/v1/orders/${orderId}`);
}

async function getOrderStatus(orderId) {
  return privateRequest('GET', `/api/v1/orders/${orderId}`);
}

async function getOpenOrders(symbol) {
  const params = symbol ? { symbol: toKuCoinSymbol(symbol), status: 'active' } : { status: 'active' };
  return privateRequest('GET', '/api/v1/orders', params);
}

// ─── Account ─────────────────────────────────────────────────────────────────

async function getAccountInfo() {
  return privateRequest('GET', '/api/v1/accounts');
}

async function getDepositAddress(coin, network) {
  return privateRequest('GET', `/api/v1/deposit-addresses?currency=${coin}&chain=${network || ''}`);
}

async function getWithdrawalQuota(coin) {
  return privateRequest('GET', `/api/v1/withdrawals/quotas?currency=${coin}`);
}

// ─── Affiliate Commission ─────────────────────────────────────────────────────
// Apply at: https://www.kucoin.com/affiliate-program

async function getReferralStats() {
  // KuCoin affiliate stats via partner dashboard
  // Requires affiliate approval first
  return { note: 'Apply at kucoin.com/affiliate-program to access commission stats' };
}

module.exports = {
  getPrice,
  get24hTicker,
  getOrderBook,
  getKlines,
  placeOrder,
  cancelOrder,
  getOrderStatus,
  getOpenOrders,
  getAccountInfo,
  getDepositAddress,
  getWithdrawalQuota,
  getReferralStats,
  toKuCoinSymbol,
};
