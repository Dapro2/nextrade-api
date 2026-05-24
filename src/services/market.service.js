const axios = require('axios');
const { setCache, getCache } = require('../config/redis');

const COINGECKO_BASE = process.env.COINGECKO_API_URL || 'https://api.coingecko.com/api/v3';
const SUPPORTED_COINS = [
  'bitcoin', 'ethereum', 'solana', 'binancecoin', 'ripple',
  'cardano', 'avalanche-2', 'dogecoin', 'polkadot', 'matic-network',
];

const COIN_ID_MAP = {
  BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana',
  BNB: 'binancecoin', XRP: 'ripple', ADA: 'cardano',
  AVAX: 'avalanche-2', DOGE: 'dogecoin', DOT: 'polkadot', MATIC: 'matic-network',
};

// Fetch all live prices (cached 30 seconds)
async function getLivePrices() {
  const cacheKey = 'market:prices';
  const cached = await getCache(cacheKey);
  if (cached) return cached;

  const { data } = await axios.get(`${COINGECKO_BASE}/coins/markets`, {
    params: {
      vs_currency: 'usd',
      ids: SUPPORTED_COINS.join(','),
      order: 'market_cap_desc',
      per_page: 20,
      price_change_percentage: '1h,24h,7d',
    },
    headers: process.env.COINGECKO_API_KEY
      ? { 'x-cg-pro-api-key': process.env.COINGECKO_API_KEY }
      : {},
    timeout: 8000,
  });

  const prices = data.map((coin) => ({
    id: coin.id,
    symbol: coin.symbol.toUpperCase(),
    name: coin.name,
    image: coin.image,
    current_price: coin.current_price,
    market_cap: coin.market_cap,
    volume_24h: coin.total_volume,
    change_1h: coin.price_change_percentage_1h_in_currency,
    change_24h: coin.price_change_percentage_24h_in_currency,
    change_7d: coin.price_change_percentage_7d_in_currency,
    high_24h: coin.high_24h,
    low_24h: coin.low_24h,
    sparkline: coin.sparkline_in_7d?.price || [],
  }));

  await setCache(cacheKey, prices, 30);
  return prices;
}

// Get price for a single coin
async function getCoinPrice(symbol) {
  const prices = await getLivePrices();
  const coin = prices.find((c) => c.symbol === symbol.toUpperCase());
  if (!coin) { const err = new Error(`Coin ${symbol} not supported`); err.status = 404; throw err; }
  return coin.current_price;
}

// Get OHLC history for a coin
async function getCoinHistory(symbol, days = 7) {
  const coinId = COIN_ID_MAP[symbol.toUpperCase()];
  if (!coinId) { const err = new Error(`Coin ${symbol} not supported`); err.status = 404; throw err; }

  const cacheKey = `market:history:${symbol}:${days}d`;
  const cached = await getCache(cacheKey);
  if (cached) return cached;

  const { data } = await axios.get(`${COINGECKO_BASE}/coins/${coinId}/ohlc`, {
    params: { vs_currency: 'usd', days },
    timeout: 8000,
  });

  // data = [[timestamp, open, high, low, close], ...]
  const history = data.map(([time, open, high, low, close]) => ({
    time: Math.floor(time / 1000),
    open, high, low, close,
  }));

  const ttl = days <= 1 ? 60 : 300; // shorter cache for intraday
  await setCache(cacheKey, history, ttl);
  return history;
}

// Get global market stats
async function getMarketStats() {
  const cacheKey = 'market:global';
  const cached = await getCache(cacheKey);
  if (cached) return cached;

  const { data } = await axios.get(`${COINGECKO_BASE}/global`, { timeout: 8000 });
  const stats = {
    total_market_cap_usd: data.data.total_market_cap.usd,
    total_volume_usd: data.data.total_volume.usd,
    btc_dominance: data.data.market_cap_percentage.btc,
    eth_dominance: data.data.market_cap_percentage.eth,
    market_cap_change_24h: data.data.market_cap_change_percentage_24h_usd,
    active_coins: data.data.active_cryptocurrencies,
  };

  await setCache(cacheKey, stats, 120);
  return stats;
}

module.exports = { getLivePrices, getCoinPrice, getCoinHistory, getMarketStats, COIN_ID_MAP };
