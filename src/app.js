require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors({ origin: '*', methods: ['GET','POST','PUT','DELETE','OPTIONS'], allowedHeaders: ['Content-Type','Authorization'] }));
app.use(express.json());
app.use(morgan('dev'));

app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Load routes safely
const routes = [
  ['/api/auth', './routes/auth.routes'],
  ['/api/user', './routes/user.routes'],
  ['/api/market', './routes/market.routes'],
  ['/api/trade', './routes/trade.routes'],
  ['/api/portfolio', './routes/portfolio.routes'],
  ['/api/wallet', './routes/wallet.routes'],
  ['/api/kyc', './routes/kyc.routes'],
];

routes.forEach(([path, file]) => {
  try {
    app.use(path, require(file));
    console.log(`✅ Route loaded: ${path}`);
  } catch (err) {
    console.warn(`⚠️ Route ${path} skipped: ${err.message}`);
  }
});

app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  console.error(err.message);
  res.status(err.status || 500).json({ error: err.message || 'Server error' });
});

app.listen(PORT, () => console.log(`✅ NexTrade API on port ${PORT}`));
module.exports = app;
