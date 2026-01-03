import express from 'express';
import axios from 'axios';
import User from '../models/User.js';
import Transaction from '../models/Transaction.js';
import Notification from '../models/Notification.js';

const router = express.Router();

let priceCache: any = null;
let lastFetch = 0;
const CACHE_DURATION = 60 * 1000; // 1 minute

/**
 * @route GET /api/market/prices
 * @desc Get live crypto prices from CoinGecko
 */
router.get('/prices', async (req, res) => {
  const now = Date.now();

  if (priceCache && (now - lastFetch < CACHE_DURATION)) {
    return res.json(priceCache);
  }

  try {
    const response = await axios.get('https://api.coingecko.com/api/v3/coins/markets', {
      params: {
        vs_currency: 'usd',
        ids: 'bitcoin,ethereum,binancecoin,solana,ripple,cardano,dogecoin,polkadot',
        order: 'market_cap_desc',
        per_page: 8,
        page: 1,
        sparkline: false,
        price_change_percentage: '24h'
      }
    });

    const prices = response.data.map((coin: any) => ({
      name: coin.name,
      symbol: coin.symbol.toUpperCase(),
      current_price: coin.current_price,
      price_change_percentage_24h: coin.price_change_percentage_24h,
      image: coin.image
    }));

    priceCache = prices;
    lastFetch = now;

    res.json(prices);
  } catch (error: any) {
    console.error('Market data fetch error:', error);
    // Return cache if available even if expired, otherwise error
    if (priceCache) return res.json(priceCache);
    res.status(500).json({ message: 'Failed to fetch market data' });
  }
});

// Helper to get price from cache or fetch
const getPrice = async (symbol: string) => {
  const now = Date.now();
  if (priceCache && (now - lastFetch < CACHE_DURATION)) {
    const coin = priceCache.find((c: any) => c.symbol.toLowerCase() === symbol.toLowerCase());
    return coin ? coin.current_price : null;
  }
  
  // If cache expired or not found, try to fetch all (simple implementation)
  try {
     const response = await axios.get('https://api.coingecko.com/api/v3/coins/markets', {
      params: {
        vs_currency: 'usd',
        ids: 'bitcoin,ethereum,binancecoin,solana,ripple,cardano,dogecoin,polkadot',
        order: 'market_cap_desc',
        per_page: 8,
        page: 1,
        sparkline: false
      }
    });
    
    // update cache
    priceCache = response.data.map((coin: any) => ({
      name: coin.name,
      symbol: coin.symbol.toUpperCase(),
      current_price: coin.current_price,
      price_change_percentage_24h: coin.price_change_percentage_24h,
      image: coin.image
    }));
    lastFetch = now;

    const coin = priceCache.find((c: any) => c.symbol.toLowerCase() === symbol.toLowerCase());
    return coin ? coin.current_price : null;
  } catch (e) {
    console.error('Error fetching price for swap:', e);
    return null;
  }
};

/**
 * @route POST /api/market/swap
 * @desc Swap between assets (Fiat <-> Crypto or Crypto <-> Crypto)
 */
router.post('/swap', async (req, res) => {
  try {
    const { userId, fromAsset, toAsset, amount } = req.body;
    // fromAsset/toAsset: 'usd' (fiat) or 'btc', 'eth', etc.

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const fromSymbol = fromAsset.toLowerCase();
    const toSymbol = toAsset.toLowerCase();
    const swapAmount = parseFloat(amount);

    if (isNaN(swapAmount) || swapAmount <= 0) {
      return res.status(400).json({ message: 'Invalid amount' });
    }

    // 1. Calculate Value in USD
    let sourcePrice = 1; // default if USD
    let targetPrice = 1; // default if USD

    if (fromSymbol !== 'usd') {
      const p = await getPrice(fromSymbol);
      if (!p) return res.status(400).json({ message: `Price not found for ${fromSymbol}` });
      sourcePrice = p;
    }

    if (toSymbol !== 'usd') {
      const p = await getPrice(toSymbol);
      if (!p) return res.status(400).json({ message: `Price not found for ${toSymbol}` });
      targetPrice = p;
    }

    const usdValueStart = swapAmount * sourcePrice;
    
    // 2. Check Balance
    if (fromSymbol === 'usd') {
      if ((user.fiatBalance || 0) < swapAmount) {
         return res.status(400).json({ message: 'Insufficient fiat balance' });
      }
    } else {
      const currentQty = user.portfolio.get(fromSymbol) || 0;
      if (currentQty < swapAmount) {
         return res.status(400).json({ message: `Insufficient ${fromSymbol.toUpperCase()} balance` });
      }
    }

    // 3. Execute Swap logic
    // Deduct
    if (fromSymbol === 'usd') {
       user.fiatBalance -= swapAmount;
    } else {
       const current = user.portfolio.get(fromSymbol) || 0;
       user.portfolio.set(fromSymbol, current - swapAmount);
       // Clean up zero balances if desired, or keep keys
       if (user.portfolio.get(fromSymbol)! <= 0) user.portfolio.delete(fromSymbol);
    }

    // Credit
    const receiveQty = usdValueStart / targetPrice;
    
    if (toSymbol === 'usd') {
       user.fiatBalance = (user.fiatBalance || 0) + receiveQty;
    } else {
       const current = user.portfolio.get(toSymbol) || 0;
       user.portfolio.set(toSymbol, current + receiveQty);
    }

    await user.save();

    // 4. Record Transaction
    await Transaction.create({
      userId: user._id,
      type: 'swap',
      amount: usdValueStart, // Record value in USD
      currency: 'USD', 
      description: `Swap ${swapAmount} ${fromSymbol.toUpperCase()} to ${receiveQty.toFixed(6)} ${toSymbol.toUpperCase()}`,
      status: 'completed',
      metadata: {
        fromAsset: fromSymbol,
        toAsset: toSymbol,
        fromAmount: swapAmount,
        toAmount: receiveQty,
        exchangeRate: sourcePrice / targetPrice
      }
    });

    // 5. Create Notification
    await Notification.create({
      userId: user._id,
      type: 'success',
      title: 'Swap Successful',
      message: `Swapped ${swapAmount} ${fromSymbol.toUpperCase()} to ${receiveQty.toFixed(6)} ${toSymbol.toUpperCase()}`,
      read: false
    });

    res.json({ 
      message: 'Swap successful', 
      from: { symbol: fromSymbol, amount: swapAmount },
      to: { symbol: toSymbol, amount: receiveQty },
      balance: fromSymbol === 'usd' ? user.fiatBalance : user.portfolio.get(fromSymbol),
      portfolio: Object.fromEntries(user.portfolio)
    });

  } catch (err) {
    console.error('Swap error:', err);
    res.status(500).json({ message: 'Swap failed' });
  }
});


export default router;
