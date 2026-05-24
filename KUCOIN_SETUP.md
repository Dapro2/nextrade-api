# KuCoin API Setup Guide (Backup Exchange)

KuCoin works well in Nigeria and is a great backup to Binance.

## Step 1 — Create KuCoin Account
Go to: https://www.kucoin.com/r/NEXTRADE (or kucoin.com)
- Sign up with your email
- Complete KYC verification

## Step 2 — Create API Keys
1. Log in to KuCoin
2. Click profile icon → **API Management**
3. Click **Create API**
4. Set:
   - Name: NexTrade
   - Passphrase: (create a strong password — save this!)
   - Permissions: ✅ General + ✅ Trade (NOT withdraw)
5. Complete 2FA verification
6. Copy your **API Key**, **Secret**, and **Passphrase**

## Step 3 — Add to .env File
```
KUCOIN_API_KEY=paste_here
KUCOIN_SECRET_KEY=paste_here
KUCOIN_PASSPHRASE=paste_here
```

## Step 4 — Apply for KuCoin Affiliate Program
Go to: https://www.kucoin.com/affiliate-program

Requirements:
- Social media following OR
- A platform with users (like NexTrade!)

Commission: Up to 40% of trading fees from referred users.

## How the Exchange Router Works

The platform automatically picks the best available exchange:

1. 🟢 **Binance** — tried first (highest liquidity)
2. 🟡 **KuCoin** — used if Binance unavailable
3. 🔵 **Demo mode** — simulated prices if neither configured

You can check which exchange is active at:
```
GET /api/market/exchange-status
```

## Supported Pairs on KuCoin
BTC-USDT · ETH-USDT · SOL-USDT · BNB-USDT
XRP-USDT · ADA-USDT · AVAX-USDT · DOGE-USDT
