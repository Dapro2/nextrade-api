# Binance API Setup Guide

## Step 1 — Create a Binance Account
Go to https://binance.com and create an account if you don't have one.
Complete identity verification (KYC).

## Step 2 — Get Your API Keys

1. Log into Binance
2. Click your profile icon → **API Management**
3. Click **Create API**
4. Name it "NexTrade"
5. Enable:
   - ✅ Read Info
   - ✅ Enable Spot & Margin Trading
   - ❌ Enable Withdrawals (leave OFF for safety)
6. Copy your **API Key** and **Secret Key**
7. Add your server IP to the whitelist

## Step 3 — Add Keys to Your .env File

```
BINANCE_API_KEY=your_api_key_here
BINANCE_SECRET_KEY=your_secret_key_here
```

Restart the server:
```bash
npm run dev
```

## Step 4 — Apply for Broker Program (to earn commissions)

Email: **link@binance.com**

Include in your email:
- Your platform name (NexTrade)
- Website URL
- Number of current users
- Monthly trading volume estimate
- Brief description of your platform

Once approved you get:
- Sub-account management API
- Commission on every user trade
- Dedicated Binance support

## Step 5 — Test the Integration

Once keys are set, test with:
```bash
curl http://localhost:4000/api/market/BTC/price
```

Should return real live Bitcoin price from Binance.

## Revenue Tracking

View your earnings at:
```
GET /api/broker/commission   (requires admin role)
GET /api/broker/stats
```

## Demo Mode

If API keys are not set, the platform runs in **demo mode**:
- Prices are simulated (realistic random walk)
- Trades are recorded internally but not sent to Binance
- Perfect for testing before going live

## Supported Trading Pairs

BTC/USDT · ETH/USDT · SOL/USDT · BNB/USDT
XRP/USDT · ADA/USDT · AVAX/USDT · DOGE/USDT
