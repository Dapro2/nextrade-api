/**
 * WebSocket Service
 * Bridges Binance live price stream → connected browser/app clients.
 * Each price update from Binance is broadcast to all connected users instantly.
 */

const WebSocket = require('ws');
const binance = require('./binance.service');

const SUPPORTED_PAIRS = [
  'BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'BNB/USDT',
  'XRP/USDT', 'ADA/USDT', 'AVAX/USDT', 'DOGE/USDT',
];

let wss = null;
let binanceWs = null;
const clients = new Set();

function initWebSocket(httpServer) {
  wss = new WebSocket.Server({ server: httpServer, path: '/ws/prices' });

  wss.on('connection', (ws) => {
    clients.add(ws);
    console.log(`WS client connected (${clients.size} total)`);

    // Send welcome ping
    ws.send(JSON.stringify({ type: 'connected', message: 'NexTrade live prices active' }));

    ws.on('close', () => {
      clients.delete(ws);
      console.log(`WS client disconnected (${clients.size} remaining)`);
    });

    ws.on('error', () => clients.delete(ws));
  });

  // Connect to Binance stream
  connectBinanceStream();
  console.log('✅ WebSocket server initialised');
}

function connectBinanceStream() {
  try {
    binanceWs = binance.subscribePriceStream(
      SUPPORTED_PAIRS,
      (update) => broadcast({ type: 'price', ...update }),
      (err) => console.error('Binance WS error:', err)
    );
  } catch (err) {
    console.warn('Binance stream unavailable — broadcasting mock prices');
    startMockStream(); // Demo mode when API keys not set
  }
}

// Broadcast to all connected clients
function broadcast(data) {
  const msg = JSON.stringify(data);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  }
}

// Demo mode: generate realistic-looking price ticks
function startMockStream() {
  const mockPrices = {
    BTC: 67412, ETH: 3518, SOL: 178, BNB: 608,
    XRP: 0.584, ADA: 0.481, AVAX: 38.4, DOGE: 0.182,
  };

  setInterval(() => {
    for (const [sym, basePrice] of Object.entries(mockPrices)) {
      // Random walk ±0.05%
      const delta = basePrice * (Math.random() - 0.5) * 0.001;
      mockPrices[sym] = Math.max(0.0001, basePrice + delta);

      broadcast({
        type:      'price',
        symbol:    sym + 'USDT',
        price:     parseFloat(mockPrices[sym].toFixed(sym === 'BTC' ? 2 : 4)),
        change24h: (Math.random() - 0.4) * 5,
      });
    }
  }, 1500);
}

module.exports = { initWebSocket, broadcast };
