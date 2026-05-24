/**
 * NexTrade — Exchange Router
 * Automatically uses Binance as primary exchange.
 * Falls back to KuCoin if Binance is unavailable or not configured.
 *
 * Usage (anywhere in the app):
 *   const exchange = require('./exchange.service');
 *   const price = await exchange.getPrice('BTC');
 */

const binance = require('./binance.service');
const kucoin  = require('./kucoin.service');

const BINANCE_CONFIGURED = !!(process.env.BINANCE_API_KEY && process.env.BINANCE_SECRET_KEY);
const KUCOIN_CONFIGURED  = !!(process.env.KUCOIN_API_KEY  && process.env.KUCOIN_SECRET_KEY);

let activeExchange = 'demo';
if (BINANCE_CONFIGURED) activeExchange = 'binance';
else if (KUCOIN_CONFIGURED) activeExchange = 'kucoin';

console.log(`✅ Exchange router: using ${activeExchange.toUpperCase()} ${activeExchange === 'demo' ? '(set API keys to go live)' : ''}`);

// ─── Auto-fallback wrapper ───────────────────────────────────────────────────

async function withFallback(binanceFn, kucoinFn, mockData) {
  // Try Binance first
  if (BINANCE_CONFIGURED) {
    try {
      return await binanceFn();
    } catch (err) {
      console.warn(`Binance failed (${err.message}), trying KuCoin...`);
    }
  }
  // Fall back to KuCoin
  if (KUCOIN_CONFIGURED) {
    try {
      return await kucoinFn();
    } catch (err) {
      console.warn(`KuCoin also failed (${err.message}), using demo data`);
    }
  }
  // Return mock/demo data
  return mockData;
}

// ─── Market Data ─────────────────────────────────────────────────────────────

async function getPrice(symbol) {
  return withFallback(
    () => binance.getPrice(symbol + 'USDT'),
    () => kucoin.getPrice(symbol),
    { symbol, price: DEMO_PRICES[symbol] || 0 }
  );
}

async function get24hTicker(symbol) {
  return withFallback(
    () => binance.get24hTicker(symbol ? symbol + 'USDT' : undefined),
    () => kucoin.get24hTicker(symbol),
    symbol ? [DEMO_TICKER(symbol)] : Object.keys(DEMO_PRICES).map(DEMO_TICKER)
  );
}

async function getOrderBook(symbol, limit = 20) {
  return withFallback(
    () => binance.getOrderBook(symbol + 'USDT', limit),
    () => kucoin.getOrderBook(symbol, limit),
    DEMO_ORDER_BOOK(symbol)
  );
}

async function getKlines(symbol, interval = '1d', limit = 100) {
  return withFallback(
    () => binance.getKlines(symbol + 'USDT', interval, limit),
    () => kucoin.getKlines(symbol, interval, limit),
    DEMO_KLINES(symbol, limit)
  );
}

// ─── Trading ─────────────────────────────────────────────────────────────────

async function placeOrder(params) {
  return withFallback(
    () => binance.placeOrder(params),
    () => kucoin.placeOrder(params),
    // Demo mode — simulate filled order
    {
      orderId:     `demo_${Date.now()}`,
      status:      'FILLED',
      executedQty: params.quantity,
      price:       params.price || DEMO_PRICES[params.symbol?.replace('USDT','')] || 0,
      demo:        true,
    }
  );
}

async function cancelOrder(symbol, orderId) {
  return withFallback(
    () => binance.cancelOrder(symbol, orderId),
    () => kucoin.cancelOrder(orderId),
    { orderId, status: 'CANCELLED', demo: true }
  );
}

async function getOpenOrders(symbol) {
  return withFallback(
    () => binance.getOpenOrders(symbol),
    () => kucoin.getOpenOrders(symbol),
    []
  );
}

// ─── Info ─────────────────────────────────────────────────────────────────────

function getActiveExchange() {
  return {
    exchange:   activeExchange,
    binance:    BINANCE_CONFIGURED,
    kucoin:     KUCOIN_CONFIGURED,
    liveTrading: BINANCE_CONFIGURED || KUCOIN_CONFIGURED,
  };
}

// ─── Demo / Mock Data ─────────────────────────────────────────────────────────

const DEMO_PRICES = {
  BTC: 67412, ETH: 3518, SOL: 178, BNB: 608,
  XRP: 0.584, ADA: 0.481, AVAX: 38.4, DOGE: 0.182,
};

const DEMO_TICKER = (sym) => ({
  symbol:    sym + 'USDT',
  price:     DEMO_PRICES[sym] || 1,
  change24h: (Math.random() - 0.4) * 5,
  high24h:   (DEMO_PRICES[sym] || 1) * 1.02,
  low24h:    (DEMO_PRICES[sym] || 1) * 0.98,
  volume24h: Math.random() * 1e6,
});

const DEMO_ORDER_BOOK = (sym) => {
  const mid = DEMO_PRICES[sym] || 100;
  return {
    asks: Array.from({length:10}, (_, i) => ({ price: mid * (1 + (i+1)*0.001), amount: Math.random()*2 })),
    bids: Array.from({length:10}, (_, i) => ({ price: mid * (1 - (i+1)*0.001), amount: Math.random()*2 })),
  };
};

const DEMO_KLINES = (sym, limit) => {
  const base = DEMO_PRICES[sym] || 100;
  const now  = Math.floor(Date.now() / 1000);
  return Array.from({length: limit}, (_, i) => {
    const t     = now - (limit - i) * 86400;
    const open  = base * (0.95 + Math.random() * 0.1);
    const close = base * (0.95 + Math.random() * 0.1);
    return { time: t, open, high: Math.max(open,close)*1.01, low: Math.min(open,close)*0.99, close, volume: Math.random()*1e4 };
  });
};

module.exports = {
  getPrice,
  get24hTicker,
  getOrderBook,
  getKlines,
  placeOrder,
  cancelOrder,
  getOpenOrders,
  getActiveExchange,
};
