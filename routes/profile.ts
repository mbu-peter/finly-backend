import express from 'express';
import User from '../models/User.js';
import Stripe from 'stripe';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';
import { sendOtpEmail } from '../utils/mailer.js';
import Notification from '../models/Notification.js';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2023-10-16' as any,
});

const router = express.Router();

// Get profile
router.get('/', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Convert portfolio map to object for frontend
    const profile = user.toObject();
    if (user.portfolio) {
      profile.portfolio = Object.fromEntries(user.portfolio);
    }
    // Ensure role is included (should be included by default, but making it explicit)
    profile.role = user.role || 'user';
    
    res.json(profile);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Update profile
router.put('/', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { fullName, planTier } = req.body;
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (fullName) user.fullName = fullName;
    if (planTier) user.planTier = planTier;

    // Handle Card Status toggle via Stripe
    if (req.body.cardStatus && user.issuingCardId) {
      const newStatus = req.body.cardStatus === 'active' ? 'active' : 'inactive';
      await stripe.issuing.cards.update(user.issuingCardId, {
        status: newStatus,
      });
      user.cardStatus = newStatus;
      console.log(`Updated Stripe Card ${user.issuingCardId} status to ${newStatus}`);
    }

    await user.save();
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Upload Avatar
router.post('/avatar', authMiddleware, upload.single('avatar'), async (req: AuthRequest, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    // Store relative path
    // Assuming server serves 'uploads' via static middleware
    const avatarUrl = `/uploads/${req.file.filename}`;
    user.avatar = avatarUrl;
    await user.save();

    res.json({ avatar: avatarUrl, message: 'Avatar updated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Upload failed' });
  }
});

// Request OTP for Password Change
router.post('/request-otp', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    // Generate 6 digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Hash OTP for security before saving
    const salt = await bcrypt.genSalt(10);
    const hashedOtp = await bcrypt.hash(otp, salt);

    user.otp = hashedOtp;
    user.otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 mins
    await user.save();

    // Log OTP for Dev/Demo (keep for backup)
    console.log(`[OTP] Password Change Code for ${user.email}: ${otp}`);

    // Send Real Email
    await sendOtpEmail(user.email, otp);

    res.json({ message: 'OTP sent to your email' });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ message: err.message || 'Failed to send OTP' });
  }
});

// Change Password with OTP
router.put('/change-password', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { otp, newPassword } = req.body;
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (!user.otp || !user.otpExpires || user.otpExpires < new Date()) {
        return res.status(400).json({ message: 'OTP expired or invalid' });
    }

    const isMatch = await bcrypt.compare(otp, user.otp);
    if (!isMatch) {
         return res.status(400).json({ message: 'Invalid OTP' });
    }

    // Update Password
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);
    
    // Clear OTP
    user.otp = undefined;
    user.otpExpires = undefined;
    await user.save();

    // Create Notification
    await Notification.create({
        userId: user._id,
        type: 'warning',
        title: 'Security Alert',
        message: 'Your password was changed successfully.',
        read: false
    });

    res.json({ message: 'Password changed successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Update Notifications
router.put('/notifications', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ message: 'User not found' });

        if (req.body.marketing !== undefined) user.notifications.marketing = req.body.marketing;
        if (req.body.securityAlerts !== undefined) user.notifications.securityAlerts = req.body.securityAlerts;
        if (req.body.emailAlerts !== undefined) user.notifications.emailAlerts = req.body.emailAlerts;

        await user.save();
        res.json(user.notifications);
    } catch (err) {
        res.status(500).json({ message: 'Server error' });
    }
});

export default router;
