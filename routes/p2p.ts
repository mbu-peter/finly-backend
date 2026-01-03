import express from 'express';
import P2POffer from '../models/P2POffer.js';
import P2PTrade from '../models/P2PTrade.js';
import Wallet from '../models/Wallet.js';
import Deposit from '../models/Deposit.js';
import Notification from '../models/Notification.js';
import User from '../models/User.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { WalletGenerator } from '../utils/walletGenerator.js';

const router = express.Router();

// All routes require authentication
router.use(authMiddleware);

// Get all active P2P offers with filtering
router.get('/offers', async (req: AuthRequest, res) => {
  try {
    const {
      type, // 'buy' or 'sell'
      cryptocurrency,
      fiatCurrency,
      paymentMethod,
      minAmount,
      maxAmount,
      page = 1,
      limit = 20
    } = req.query;

    const filter: any = { status: 'active' };

    if (type) filter.type = type;
    if (cryptocurrency) filter.cryptocurrency = cryptocurrency.toString().toUpperCase();
    if (fiatCurrency) filter.fiatCurrency = fiatCurrency.toString().toUpperCase();
    if (paymentMethod) filter.paymentMethods = paymentMethod;

    if (minAmount) {
      filter.amount = { ...filter.amount, $gte: parseFloat(minAmount.toString()) };
    }
    if (maxAmount) {
      filter.amount = { ...filter.amount, $lte: parseFloat(maxAmount.toString()) };
    }

    const offers = await P2POffer.find(filter)
      .populate('userId', 'fullName email avatar rating')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit.toString()))
      .skip((parseInt(page.toString()) - 1) * parseInt(limit.toString()))
      .lean();

    const total = await P2POffer.countDocuments(filter);

    res.json({
      offers,
      pagination: {
        page: parseInt(page.toString()),
        limit: parseInt(limit.toString()),
        total,
        pages: Math.ceil(total / parseInt(limit.toString()))
      }
    });
  } catch (err: any) {
    console.error('Error fetching P2P offers:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Create a new P2P offer
router.post('/offers', async (req: AuthRequest, res) => {
  try {
    const {
      type,
      cryptocurrency,
      fiatCurrency,
      amount,
      price,
      minLimit,
      maxLimit,
      paymentMethods,
      terms,
      expiresInHours = 24
    } = req.body;

    // Validate required fields
    if (!type || !cryptocurrency || !fiatCurrency || !amount || !price || !minLimit || !maxLimit || !paymentMethods) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    // Validate amounts
    if (maxLimit < minLimit) {
      return res.status(400).json({ message: 'Maximum limit must be greater than minimum limit' });
    }

    if (amount < minLimit || amount > maxLimit) {
      return res.status(400).json({ message: 'Amount must be within limits' });
    }

    // Supported cryptocurrencies (top 10)
    const supportedCryptos = ['BTC', 'ETH', 'USDT', 'BNB', 'ADA', 'XRP', 'SOL', 'DOT', 'DOGE', 'AVAX'];
    if (!supportedCryptos.includes(cryptocurrency.toUpperCase())) {
      return res.status(400).json({ message: 'Unsupported cryptocurrency' });
    }

    const offer = await P2POffer.create({
      userId: req.user.id,
      type,
      cryptocurrency: cryptocurrency.toUpperCase(),
      fiatCurrency: fiatCurrency.toUpperCase(),
      amount: parseFloat(amount),
      price: parseFloat(price),
      minLimit: parseFloat(minLimit),
      maxLimit: parseFloat(maxLimit),
      paymentMethods: Array.isArray(paymentMethods) ? paymentMethods : [paymentMethods],
      terms,
      expiresAt: new Date(Date.now() + parseInt(expiresInHours) * 60 * 60 * 1000)
    });

    await offer.populate('userId', 'fullName email avatar rating');

    // Create notification for offer creation
    await Notification.create({
      userId: req.user.id,
      type: 'success',
      title: 'P2P Offer Created',
      message: `Your ${type} offer for ${amount} ${cryptocurrency} has been created successfully.`,
      read: false,
      data: {
        action: 'p2p_offer_created',
        offerId: offer._id,
        type,
        cryptocurrency,
        amount
      }
    });

    res.status(201).json(offer);
  } catch (err: any) {
    console.error('Error creating P2P offer:', err);
    res.status(500).json({ message: err.message || 'Failed to create offer' });
  }
});

// Get user's own offers
router.get('/my-offers', async (req: AuthRequest, res) => {
  try {
    const { status = 'active', page = 1, limit = 10 } = req.query;

    const offers = await P2POffer.find({
      userId: req.user.id,
      status: status === 'all' ? { $exists: true } : status
    })
      .sort({ createdAt: -1 })
      .limit(parseInt(limit.toString()))
      .skip((parseInt(page.toString()) - 1) * parseInt(limit.toString()))
      .lean();

    const total = await P2POffer.countDocuments({
      userId: req.user.id,
      status: status === 'all' ? { $exists: true } : status
    });

    res.json({
      offers,
      pagination: {
        page: parseInt(page.toString()),
        limit: parseInt(limit.toString()),
        total,
        pages: Math.ceil(total / parseInt(limit.toString()))
      }
    });
  } catch (err: any) {
    console.error('Error fetching user offers:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update offer status
router.patch('/offers/:id/status', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const offer = await P2POffer.findOneAndUpdate(
      { _id: id, userId: req.user.id },
      { status },
      { new: true }
    );

    if (!offer) {
      return res.status(404).json({ message: 'Offer not found' });
    }

    res.json(offer);
  } catch (err: any) {
    console.error('Error updating offer status:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Accept an offer and create a trade
router.post('/offers/:id/accept', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { amount, paymentMethod } = req.body;

    const offer = await P2POffer.findById(id);
    if (!offer) {
      return res.status(404).json({ message: 'Offer not found' });
    }

    if (offer.status !== 'active') {
      return res.status(400).json({ message: 'Offer is not active' });
    }

    if (offer.userId.toString() === req.user.id) {
      return res.status(400).json({ message: 'Cannot accept your own offer' });
    }

    // Validate amount
    if (amount < offer.minLimit || amount > offer.maxLimit) {
      return res.status(400).json({ message: 'Amount is outside offer limits' });
    }

    // Check if payment method is supported
    if (!offer.paymentMethods.includes(paymentMethod)) {
      return res.status(400).json({ message: 'Payment method not supported by this offer' });
    }

    const tradeAmount = amount / offer.price; // Convert fiat to crypto amount
    const totalFiat = amount;

    // Check wallet balances
    const Wallet = (await import('../models/Wallet.js')).default;

    if (offer.type === 'sell') {
      // Buyer (current user) needs to have crypto to sell
      const buyerWallet = await Wallet.findOne({
        userId: req.user.id,
        cryptocurrency: offer.cryptocurrency,
        balance: { $gte: tradeAmount },
        isActive: true
      });

      if (!buyerWallet) {
        return res.status(400).json({
          message: `You don't have sufficient ${offer.cryptocurrency} balance in your wallet. Please deposit funds first.`
        });
      }

      // Lock the crypto in escrow
      buyerWallet.lockedBalance += tradeAmount;
      buyerWallet.balance -= tradeAmount;
      await buyerWallet.save();
    } else {
      // Seller needs crypto balance for buy offers
      const sellerWallet = await Wallet.findOne({
        userId: offer.userId,
        cryptocurrency: offer.cryptocurrency,
        balance: { $gte: tradeAmount },
        isActive: true
      });

      if (!sellerWallet) {
        return res.status(400).json({ message: 'Seller does not have sufficient balance' });
      }

      // Lock the crypto in escrow
      sellerWallet.lockedBalance += tradeAmount;
      sellerWallet.balance -= tradeAmount;
      await sellerWallet.save();
    }

    const trade = await P2PTrade.create({
      offerId: offer._id,
      buyerId: offer.type === 'sell' ? req.user.id : offer.userId,
      sellerId: offer.type === 'sell' ? offer.userId : req.user.id,
      cryptocurrency: offer.cryptocurrency,
      fiatCurrency: offer.fiatCurrency,
      amount: tradeAmount,
      price: offer.price,
      totalFiat,
      paymentMethod,
      escrowAmount: tradeAmount,
      escrowHeld: true
    });

    // Update offer amount or mark as completed
    if (offer.amount <= tradeAmount) {
      offer.status = 'completed';
      offer.completedAt = new Date();
    } else {
      offer.amount -= tradeAmount;
    }
    await offer.save();

    await trade.populate([
      { path: 'buyerId', select: 'fullName email avatar' },
      { path: 'sellerId', select: 'fullName email avatar' }
    ]);

    // Create notifications for trade participants
    // Notify buyer
    await Notification.create({
      userId: trade.buyerId._id,
      type: 'success',
      title: 'P2P Trade Started',
      message: `Your ${offer.type === 'sell' ? 'buy' : 'sell'} trade for ${tradeAmount} ${offer.cryptocurrency} has been initiated. Please send payment to complete the transaction.`,
      read: false,
      data: {
        action: 'p2p_trade_started',
        tradeId: trade._id,
        role: 'buyer',
        amount: tradeAmount,
        cryptocurrency: offer.cryptocurrency
      }
    });

    // Notify seller
    await Notification.create({
      userId: trade.sellerId._id,
      type: 'success',
      title: 'P2P Trade Started',
      message: `A ${offer.type === 'sell' ? 'sell' : 'buy'} trade for ${tradeAmount} ${offer.cryptocurrency} has been initiated. Wait for payment confirmation.`,
      read: false,
      data: {
        action: 'p2p_trade_started',
        tradeId: trade._id,
        role: 'seller',
        amount: tradeAmount,
        cryptocurrency: offer.cryptocurrency
      }
    });

    // Notify admins about P2P trade activity
    const admins = await User.find({ role: 'admin' });
    for (const admin of admins) {
      await Notification.create({
        userId: admin._id,
        type: 'info',
        title: 'P2P Trade Activity',
        message: `New P2P trade: ${trade.buyerId.email} ↔ ${trade.sellerId.email} for ${tradeAmount} ${offer.cryptocurrency}`,
        read: false,
        data: {
          action: 'p2p_trade_admin',
          tradeId: trade._id,
          buyerId: trade.buyerId._id,
          sellerId: trade.sellerId._id
        }
      });
    }

    res.status(201).json(trade);
  } catch (err: any) {
    console.error('Error accepting offer:', err);
    res.status(500).json({ message: err.message || 'Failed to accept offer' });
  }
});

// Get user's trades
router.get('/trades', async (req: AuthRequest, res) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;

    const filter: any = {
      $or: [
        { buyerId: req.user.id },
        { sellerId: req.user.id }
      ]
    };

    if (status && status !== 'all') {
      filter.status = status;
    }

    const trades = await P2PTrade.find(filter)
      .populate('offerId')
      .populate('buyerId', 'fullName email avatar')
      .populate('sellerId', 'fullName email avatar')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit.toString()))
      .skip((parseInt(page.toString()) - 1) * parseInt(limit.toString()))
      .lean();

    const total = await P2PTrade.countDocuments(filter);

    res.json({
      trades,
      pagination: {
        page: parseInt(page.toString()),
        limit: parseInt(limit.toString()),
        total,
        pages: Math.ceil(total / parseInt(limit.toString()))
      }
    });
  } catch (err: any) {
    console.error('Error fetching trades:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update trade status
router.patch('/trades/:id/status', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { status, paymentProof, notes, payoutMethod, payoutDetails } = req.body;

    const trade = await P2PTrade.findById(id);
    if (!trade) {
      return res.status(404).json({ message: 'Trade not found' });
    }

    // Check if user is part of this trade
    if (trade.buyerId.toString() !== req.user.id && trade.sellerId.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    // Validate status transitions
    const validStatuses = ['pending', 'payment_sent', 'payment_received', 'crypto_released', 'completed', 'cancelled', 'disputed'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }

    const updateData: any = { status };
    if (paymentProof) updateData.paymentProof = paymentProof;
    if (notes) updateData.notes = notes;
    if (payoutMethod) updateData.payoutMethod = payoutMethod;
    if (payoutDetails) updateData.payoutDetails = payoutDetails;

    // Handle escrow and balance updates based on status
    if (status === 'completed') {
      updateData.completedAt = new Date();

      // If escrow was held, release it to buyer
      if (trade.escrowHeld) {
        const buyerWallet = await Wallet.findOne({
          userId: trade.buyerId,
          cryptocurrency: trade.cryptocurrency
        });

        if (buyerWallet) {
          buyerWallet.balance += trade.amount;
          await buyerWallet.save();
        }

        // Mark escrow as released
        updateData.escrowHeld = false;

        // Handle seller payout (in production, this would trigger actual payout)
        if (trade.payoutMethod && trade.payoutDetails) {
          // Here you would integrate with payment processors
          console.log(`Processing payout to seller: ${trade.payoutMethod} - ${trade.payoutDetails}`);
        }
      }
    } else if (status === 'cancelled') {
      updateData.cancelledAt = new Date();

      // Return escrowed funds to seller
      if (trade.escrowHeld) {
        const sellerWallet = await Wallet.findOne({
          userId: trade.sellerId,
          cryptocurrency: trade.cryptocurrency
        });

        if (sellerWallet) {
          sellerWallet.balance += trade.amount;
          sellerWallet.lockedBalance -= trade.amount;
          await sellerWallet.save();
        }

        updateData.escrowHeld = false;
      }
    }

    const updatedTrade = await P2PTrade.findByIdAndUpdate(id, updateData, { new: true });
    await updatedTrade?.populate([
      { path: 'buyerId', select: 'fullName email avatar' },
      { path: 'sellerId', select: 'fullName email avatar' }
    ]);

    res.json(updatedTrade);
  } catch (err: any) {
    console.error('Error updating trade status:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get supported cryptocurrencies
router.get('/supported-cryptos', (req, res) => {
  const supportedCryptos = [
    { symbol: 'BTC', name: 'Bitcoin', icon: '₿' },
    { symbol: 'ETH', name: 'Ethereum', icon: 'Ξ' },
    { symbol: 'USDT', name: 'Tether', icon: '₮' },
    { symbol: 'BNB', name: 'Binance Coin', icon: 'BNB' },
    { symbol: 'ADA', name: 'Cardano', icon: 'ADA' },
    { symbol: 'XRP', name: 'XRP', icon: 'XRP' },
    { symbol: 'SOL', name: 'Solana', icon: 'SOL' },
    { symbol: 'DOT', name: 'Polkadot', icon: 'DOT' },
    { symbol: 'DOGE', name: 'Dogecoin', icon: 'Ð' },
    { symbol: 'AVAX', name: 'Avalanche', icon: 'AVAX' }
  ];

  res.json(supportedCryptos);
});

// Get supported fiat currencies
router.get('/supported-fiats', (req, res) => {
  const supportedFiats = [
    { code: 'USD', name: 'US Dollar', symbol: '$' },
    { code: 'EUR', name: 'Euro', symbol: '€' },
    { code: 'GBP', name: 'British Pound', symbol: '£' },
    { code: 'NGN', name: 'Nigerian Naira', symbol: '₦' },
    { code: 'CAD', name: 'Canadian Dollar', symbol: 'C$' },
    { code: 'AUD', name: 'Australian Dollar', symbol: 'A$' }
  ];

  res.json(supportedFiats);
});

// Get wallet QR code data
router.get('/wallets/:id/qr', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { amount } = req.query;

    const wallet = await Wallet.findOne({ _id: id, userId: req.user.id });
    if (!wallet) {
      return res.status(404).json({ message: 'Wallet not found' });
    }

    const qrData = WalletGenerator.generateQRCodeData(
      wallet.cryptocurrency,
      wallet.address,
      amount?.toString()
    );

    res.json({
      walletId: wallet._id,
      cryptocurrency: wallet.cryptocurrency,
      network: wallet.network,
      address: wallet.address,
      qrData,
      amount: amount || null
    });
  } catch (err: any) {
    console.error('Error generating QR code:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get supported payment methods
router.get('/payment-methods', (req, res) => {
  const paymentMethods = [
    { id: 'bank_transfer', name: 'Bank Transfer', description: 'Direct bank transfer' },
    { id: 'paypal', name: 'PayPal', description: 'PayPal payment' },
    { id: 'cash_app', name: 'Cash App', description: 'Cash App payment' },
    { id: 'venmo', name: 'Venmo', description: 'Venmo payment' },
    { id: 'zelle', name: 'Zelle', description: 'Zelle payment' },
    { id: 'revolut', name: 'Revolut', description: 'Revolut payment' },
    { id: 'wise', name: 'Wise', description: 'Wise (TransferWise) payment' },
    { id: 'mpesa', name: 'M-Pesa', description: 'M-Pesa mobile payment' },
    { id: 'crypto_wallet', name: 'Crypto Wallet', description: 'Direct crypto transfer' }
  ];

  res.json(paymentMethods);
});

// ===== WALLET MANAGEMENT =====

// Get user's wallets
router.get('/wallets', async (req: AuthRequest, res) => {
  try {
    const wallets = await Wallet.find({ userId: req.user.id })
      .sort({ cryptocurrency: 1, isDefault: -1 })
      .lean();

    res.json(wallets);
  } catch (err: any) {
    console.error('Error fetching wallets:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Add a new wallet (auto-generated by platform)
router.post('/wallets', async (req: AuthRequest, res) => {
  try {
    const { cryptocurrency, network, label, isDefault = false } = req.body;

    // Validate required fields
    if (!cryptocurrency || !network) {
      return res.status(400).json({ message: 'Cryptocurrency and network are required' });
    }

    // Supported cryptocurrencies
    const supportedCryptos = ['BTC', 'ETH', 'USDT', 'BNB', 'ADA', 'XRP', 'SOL', 'DOT', 'DOGE', 'AVAX'];
    if (!supportedCryptos.includes(cryptocurrency.toUpperCase())) {
      return res.status(400).json({ message: 'Unsupported cryptocurrency' });
    }

    // Check if user already has a wallet for this cryptocurrency and network
    const existingWallet = await Wallet.findOne({
      userId: req.user.id,
      cryptocurrency: cryptocurrency.toUpperCase(),
      network,
      isActive: true
    });

    if (existingWallet) {
      return res.status(400).json({ message: 'You already have a wallet for this cryptocurrency and network' });
    }

    // Generate a new wallet for the user
    const walletData = WalletGenerator.generateAddress(
      req.user.id,
      cryptocurrency.toUpperCase(),
      network
    );

    const wallet = await Wallet.create({
      userId: req.user.id,
      cryptocurrency: cryptocurrency.toUpperCase(),
      network,
      address: walletData.address,
      privateKey: walletData.privateKey,
      publicKey: walletData.publicKey,
      derivationPath: walletData.derivationPath,
      label,
      isDefault,
      balance: 0,
      lockedBalance: 0,
      totalDeposits: 0,
      totalWithdrawals: 0,
      isActive: true
    });

    // Return wallet data (without sensitive private key)
    const walletResponse = {
      _id: wallet._id,
      cryptocurrency: wallet.cryptocurrency,
      network: wallet.network,
      address: wallet.address,
      label: wallet.label,
      isDefault: wallet.isDefault,
      balance: wallet.balance,
      lockedBalance: wallet.lockedBalance,
      totalDeposits: wallet.totalDeposits,
      totalWithdrawals: wallet.totalWithdrawals,
      createdAt: wallet.createdAt
    };

    // Create wallet creation notification
    await Notification.create({
      userId: req.user.id,
      type: 'success',
      title: 'Wallet Created',
      message: `Your ${cryptocurrency} wallet on ${network} network has been created successfully.`,
      read: false,
      data: {
        action: 'wallet_created',
        walletId: wallet._id,
        cryptocurrency,
        network
      }
    });

    res.status(201).json(walletResponse);
  } catch (err: any) {
    console.error('Error creating wallet:', err);
    res.status(500).json({ message: err.message || 'Failed to create wallet' });
  }
});

// Update wallet
router.patch('/wallets/:id', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { label, isDefault } = req.body;

    const wallet = await Wallet.findOneAndUpdate(
      { _id: id, userId: req.user.id },
      { label, isDefault },
      { new: true }
    );

    if (!wallet) {
      return res.status(404).json({ message: 'Wallet not found' });
    }

    res.json(wallet);
  } catch (err: any) {
    console.error('Error updating wallet:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete wallet
router.delete('/wallets/:id', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    // Check if wallet has balance
    const wallet = await Wallet.findOne({ _id: id, userId: req.user.id });
    if (!wallet) {
      return res.status(404).json({ message: 'Wallet not found' });
    }

    if (wallet.balance > 0 || wallet.lockedBalance > 0) {
      return res.status(400).json({ message: 'Cannot delete wallet with balance' });
    }

    await Wallet.findByIdAndDelete(id);
    res.json({ success: true });
  } catch (err: any) {
    console.error('Error deleting wallet:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ===== DEPOSIT MANAGEMENT =====

// Create deposit request (for manual deposit tracking)
router.post('/deposits', async (req: AuthRequest, res) => {
  try {
    const { walletId, amount, txHash } = req.body;

    if (!walletId || !amount) {
      return res.status(400).json({ message: 'Wallet ID and amount are required' });
    }

    const wallet = await Wallet.findOne({ _id: walletId, userId: req.user.id });
    if (!wallet) {
      return res.status(404).json({ message: 'Wallet not found' });
    }

    // Check if deposit with this TX hash already exists
    if (txHash) {
      const existingDeposit = await Deposit.findOne({ txHash, userId: req.user.id });
      if (existingDeposit) {
        return res.status(400).json({ message: 'Deposit with this transaction hash already exists' });
      }
    }

    // For demo purposes, we'll auto-confirm deposits after a short delay
    // In production, you'd integrate with blockchain APIs for real verification
    const deposit = await Deposit.create({
      userId: req.user.id,
      walletId: wallet._id,
      cryptocurrency: wallet.cryptocurrency,
      network: wallet.network,
      amount: parseFloat(amount),
      txHash,
      depositAddress: wallet.address,
      status: 'pending', // Start as pending
      confirmations: 0,
      requiredConfirmations: 1, // Simplified for demo
    });

    // Simulate blockchain confirmation (in production, use webhooks/cron jobs)
    setTimeout(async () => {
      try {
        deposit.status = 'confirmed';
        deposit.confirmations = 1;
        deposit.processedAt = new Date();
        await deposit.save();

        // Update wallet balance
        await Wallet.findByIdAndUpdate(wallet._id, {
          $inc: {
            balance: parseFloat(amount),
            totalDeposits: parseFloat(amount)
          }
        });
      } catch (error) {
        console.error('Error confirming deposit:', error);
      }
    }, 3000); // Confirm after 3 seconds for demo

    await deposit.populate('walletId');
    res.status(201).json(deposit);
  } catch (err: any) {
    console.error('Error creating deposit:', err);
    res.status(500).json({ message: err.message || 'Failed to create deposit' });
  }
});

// Get user's deposits
router.get('/deposits', async (req: AuthRequest, res) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;

    const filter: any = { userId: req.user.id };
    if (status && status !== 'all') {
      filter.status = status;
    }

    const deposits = await Deposit.find(filter)
      .populate('walletId', 'cryptocurrency network address')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit.toString()))
      .skip((parseInt(page.toString()) - 1) * parseInt(limit.toString()))
      .lean();

    const total = await Deposit.countDocuments(filter);

    res.json({
      deposits,
      pagination: {
        page: parseInt(page.toString()),
        limit: parseInt(limit.toString()),
        total,
        pages: Math.ceil(total / parseInt(limit.toString()))
      }
    });
  } catch (err: any) {
    console.error('Error fetching deposits:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ===== NETWORKS AND SUPPORTED ASSETS =====

// Get supported networks for each cryptocurrency
router.get('/networks', (req, res) => {
  const networks = {
    BTC: [
      { id: 'BTC', name: 'Bitcoin', description: 'Native Bitcoin network' }
    ],
    ETH: [
      { id: 'ERC20', name: 'ERC-20', description: 'Ethereum network' },
      { id: 'BEP20', name: 'BEP-20', description: 'Binance Smart Chain' }
    ],
    USDT: [
      { id: 'ERC20', name: 'ERC-20 (ETH)', description: 'Ethereum network' },
      { id: 'BEP20', name: 'BEP-20 (BSC)', description: 'Binance Smart Chain' },
      { id: 'TRC20', name: 'TRC-20', description: 'Tron network' }
    ],
    BNB: [
      { id: 'BEP20', name: 'BEP-20', description: 'Binance Smart Chain' }
    ],
    ADA: [
      { id: 'ADA', name: 'Cardano', description: 'Native Cardano network' }
    ],
    XRP: [
      { id: 'XRP', name: 'XRP Ledger', description: 'Native XRP network' }
    ],
    SOL: [
      { id: 'SOL', name: 'Solana', description: 'Native Solana network' }
    ],
    DOT: [
      { id: 'DOT', name: 'Polkadot', description: 'Native Polkadot network' }
    ],
    DOGE: [
      { id: 'DOGE', name: 'Dogecoin', description: 'Native Dogecoin network' }
    ],
    AVAX: [
      { id: 'AVAX', name: 'Avalanche C-Chain', description: 'Avalanche network' }
    ]
  };

  res.json(networks);
});

export default router;
