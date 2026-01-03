import express from 'express';
import Transaction from '../models/Transaction.js';
import User from '../models/User.js';
import Notification from '../models/Notification.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';

const router = express.Router();

// Get all transactions for logged in user
router.get('/', authMiddleware, async (req: AuthRequest, res: express.Response) => { // Added express.Response type
  try {
    const transactions = await Transaction.find({ userId: req.user.id }).sort({ createdAt: -1 });
    res.json(transactions);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Create a transaction
router.post('/', authMiddleware, async (req: AuthRequest, res: express.Response) => {
  try {
    const { type, amount, currency, description, assetId, assetSymbol } = req.body;
    
    const transaction = await Transaction.create({
      userId: req.user.id,
      type,
      amount,
      currency,
      description,
      assetId,
      assetSymbol,
    });

    // Update User Balance/Portfolio
    const user = await User.findById(req.user.id);
    if (user) {
      if (type === 'deposit') {
        user.fiatBalance = (user.fiatBalance || 0) + amount;
      } else if (type === 'withdrawal' || type === 'card_spend') {
        user.fiatBalance = (user.fiatBalance || 0) - amount;
      } else if (type === 'crypto_buy') {
        user.fiatBalance = (user.fiatBalance || 0) - amount;
        const currentAmount = user.portfolio.get(assetSymbol) || 0;
        // Basic calculation: amount is USD, we should ideally store asset amount
        // For now, let's keep it simple or store the USD value invested
        user.portfolio.set(assetSymbol, currentAmount + amount);
      } else if (type === 'crypto_sell') {
        user.fiatBalance = (user.fiatBalance || 0) + amount;
        const currentAmount = user.portfolio.get(assetSymbol) || 0;
        user.portfolio.set(assetSymbol, Math.max(0, currentAmount - amount));
      }
      await user.save();
    }

    // Create transaction notification
    const notificationType = type === 'deposit' ? 'success' : type === 'withdrawal' ? 'warning' : 'info';
    const notificationTitle = type === 'deposit' ? 'Deposit Successful' :
                             type === 'withdrawal' ? 'Withdrawal Processed' :
                             type === 'card_spend' ? 'Card Transaction' :
                             type === 'crypto_buy' ? 'Crypto Purchase' :
                             type === 'crypto_sell' ? 'Crypto Sale' : 'Transaction Completed';

    await Notification.create({
      userId: req.user.id,
      type: notificationType,
      title: notificationTitle,
      message: `${description} - ${amount} ${currency}`,
      read: false,
      data: {
        action: 'transaction',
        transactionId: transaction._id,
        type,
        amount,
        currency
      }
    });

    // Notify admins about significant transactions (large amounts)
    if (Math.abs(amount) >= 1000) { // Notify for transactions >= $1000
      const admins = await User.find({ role: 'admin' });
      for (const admin of admins) {
        await Notification.create({
          userId: admin._id,
          type: 'info',
          title: 'Large Transaction Alert',
          message: `User ${user?.email} made a ${type} transaction of ${amount} ${currency}`,
          read: false,
          data: {
            action: 'large_transaction',
            userId: req.user.id,
            transactionId: transaction._id,
            amount,
            currency
          }
        });
      }
    }

    res.status(201).json(transaction);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;
