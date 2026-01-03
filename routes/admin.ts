import express from 'express';
import User from '../models/User.js';
import Transaction from '../models/Transaction.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { adminOnly } from '../middleware/admin.js';

const router = express.Router();

// All routes require admin authentication
router.use(authMiddleware);
router.use(adminOnly);

// Get all users with pagination
router.get('/users', async (req: AuthRequest, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const search = req.query.search as string || '';
    const skip = (page - 1) * limit;

    const query: any = {};
    if (search) {
      query.$or = [
        { email: { $regex: search, $options: 'i' } },
        { fullName: { $regex: search, $options: 'i' } },
      ];
    }

    const [users, total] = await Promise.all([
      User.find(query)
        .select('-password -encryptedPrivateKey')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      User.countDocuments(query),
    ]);

    // Get transaction counts for each user
    const userIds = users.map((u: any) => u._id);
    const transactionCounts = await Transaction.aggregate([
      { $match: { userId: { $in: userIds } } },
      { $group: { _id: '$userId', count: { $sum: 1 } } },
    ]);

    const countMap = new Map(transactionCounts.map((tc: any) => [tc._id.toString(), tc.count]));

    const usersWithCounts = users.map((user: any) => ({
      ...user,
      id: user._id.toString(),
      transactions: countMap.get(user._id.toString()) || 0,
      createdAt: user.createdAt?.toISOString().split('T')[0] || new Date().toISOString().split('T')[0],
    }));

    res.json({
      users: usersWithCounts,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (err: any) {
    console.error('Error fetching users:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get user statistics - MUST come before /users/:id to avoid route conflict
router.get('/users/stats', async (req: AuthRequest, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const verifiedUsers = await User.countDocuments({ identityVerified: true });
    
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const newUsers7d = await User.countDocuments({ createdAt: { $gte: sevenDaysAgo } });
    const newUsers30d = await User.countDocuments({ createdAt: { $gte: thirtyDaysAgo } });

    // Active users (users with transactions in last 30 days)
    const activeUserIds = await Transaction.distinct('userId', {
      createdAt: { $gte: thirtyDaysAgo },
    });
    const activeUsers = activeUserIds.length;

    res.json({
      total: totalUsers,
      verified: verifiedUsers,
      newUsers7d,
      newUsers30d,
      activeUsers,
    });
  } catch (err: any) {
    console.error('Error fetching user stats:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get single user - MUST come after /users/stats
router.get('/users/:id', async (req: AuthRequest, res) => {
  try {
    const userId = req.params.id;
    
    // Validate ObjectId format
    if (!userId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ message: 'Invalid user ID format' });
    }

    const user = await User.findById(userId).select('-password -encryptedPrivateKey').lean();
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const transactionCount = await Transaction.countDocuments({ userId });

    res.json({
      ...user,
      id: user._id.toString(),
      transactions: transactionCount,
    });
  } catch (err: any) {
    console.error('Error fetching user:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Promote user to admin
router.put('/users/:id/promote', async (req: AuthRequest, res) => {
  try {
    const userId = req.params.id;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    user.role = 'admin';
    await user.save();

    res.json({ success: true, message: 'User promoted to admin', user: { id: user._id, email: user.email, role: user.role } });
  } catch (err: any) {
    console.error('Error promoting user:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Demote admin to user
router.put('/users/:id/demote', async (req: AuthRequest, res) => {
  try {
    const userId = req.params.id;

    // Prevent demoting yourself
    if (userId === req.user.id) {
      return res.status(400).json({ message: 'Cannot demote your own account' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    user.role = 'user';
    await user.save();

    res.json({ success: true, message: 'Admin demoted to user', user: { id: user._id, email: user.email, role: user.role } });
  } catch (err: any) {
    console.error('Error demoting user:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete user
router.delete('/users/:id', async (req: AuthRequest, res) => {
  try {
    const userId = req.params.id;

    // Prevent deleting yourself
    if (userId === req.user.id) {
      return res.status(400).json({ message: 'Cannot delete your own account' });
    }

    // Delete user and related data
    await Promise.all([
      User.findByIdAndDelete(userId),
      Transaction.deleteMany({ userId }),
    ]);

    res.json({ success: true, message: 'User deleted successfully' });
  } catch (err: any) {
    console.error('Error deleting user:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get platform statistics
router.get('/stats', async (req: AuthRequest, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const totalTransactions = await Transaction.countDocuments();
    
    // Calculate total transaction volume
    const volumeResult = await Transaction.aggregate([
      { $match: { status: 'completed' } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    const totalVolume = volumeResult[0]?.total || 0;

    // Get transaction counts by type
    const transactionsByType = await Transaction.aggregate([
      { $group: { _id: '$type', count: { $sum: 1 } } },
    ]);

    // Get last 6 months data for chart
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const monthlyUsers = await User.aggregate([
      { $match: { createdAt: { $gte: sixMonthsAgo } } },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
    ]);

    const monthlyTransactions = await Transaction.aggregate([
      { $match: { createdAt: { $gte: sixMonthsAgo } } },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
    ]);

    res.json({
      totalUsers,
      totalTransactions,
      totalVolume,
      transactionsByType,
      monthlyUsers,
      monthlyTransactions,
    });
  } catch (err: any) {
    console.error('Error fetching stats:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;
