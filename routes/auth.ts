import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import passport from 'passport';
import crypto from 'crypto';
import speakeasy from 'speakeasy';
import qrcode from 'qrcode';
import User from '../models/User.js';
import Notification from '../models/Notification.js';
import { sendResetEmail } from '../utils/mailer.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

// Signup
router.post('/signup', async (req, res) => {
  try {
    const { email, password, fullName } = req.body;

    let user = await User.findOne({ email });
    if (user) {
      return res.status(400).json({ message: 'User already exists' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    user = await User.create({
      email,
      password: hashedPassword,
      fullName,
    });

    // Create welcome notification for new user
    await Notification.create({
      userId: user._id,
      type: 'success',
      title: 'Welcome to Finly!',
      message: `Welcome ${fullName}! Your account has been created successfully. Start exploring our features and managing your finances.`,
      read: false,
      data: { action: 'welcome' }
    });

    // Notify all admins about new user registration
    const admins = await User.find({ role: 'admin' });
    for (const admin of admins) {
      await Notification.create({
        userId: admin._id,
        type: 'info',
        title: 'New User Registration',
        message: `New user ${fullName} (${email}) has registered an account.`,
        read: false,
        data: { action: 'new_user', userId: user._id, userEmail: email }
      });
    }

    const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET || 'secret', { expiresIn: '7d' });
    res.json({ token, user: { id: user._id, email: user.email, fullName: user.fullName, role: user.role } });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user || !user.password) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    // Check if 2FA is enabled
    if (user.twoFactorEnabled) {
      // Return partial login response requiring 2FA
      const tempToken = jwt.sign(
        { id: user._id, email: user.email, requires2FA: true },
        process.env.JWT_SECRET || 'fallback-secret',
        { expiresIn: '5m' } // Short-lived token for 2FA verification
      );

      return res.json({
        requires2FA: true,
        tempToken,
        user: {
          id: user._id,
          email: user.email,
          fullName: user.fullName,
          role: user.role,
        },
      });
    }

    // Create login notification for security
    await Notification.create({
      userId: user._id,
      type: 'info',
      title: 'Account Login',
      message: `You logged in to your Finly account from a new session.`,
      read: false,
      data: { action: 'login' }
    });

    // Notify admins about user logins (optional - could be too noisy)
    // Uncomment if you want admin notifications for all logins
    /*
    if (user.role !== 'admin') {
      const admins = await User.find({ role: 'admin' });
      for (const admin of admins) {
        await Notification.create({
          userId: admin._id,
          type: 'info',
          title: 'User Login',
          message: `User ${user.fullName} (${user.email}) logged in.`,
          read: false,
          data: { action: 'user_login', userId: user._id }
        });
      }
    }
    */

    const token = jwt.sign(
      { id: user._id, email: user.email, role: user.role },
      process.env.JWT_SECRET || 'fallback-secret',
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: {
        id: user._id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        planTier: user.planTier,
      },
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Google Auth
router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

router.get('/google/callback', passport.authenticate('google', { session: false }), (req: any, res) => {
  const token = jwt.sign({ id: req.user._id, role: req.user.role }, process.env.JWT_SECRET || 'secret', { expiresIn: '7d' });
  // Redirect to frontend with token
  res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/login?token=${token}`);
});

// Gift Deposit (Temporary for demo/testing)
router.post('/gift', async (req, res) => {
  try {
    const { userId } = req.body;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    user.fiatBalance = (user.fiatBalance || 0) + 10000;
    await user.save();
    
    res.json({ message: 'Gift of $10,000 added!', balance: user.fiatBalance });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Forgot Password
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Create a reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');

    // Set token and expiry on user model
    user.resetPasswordToken = hashedToken;
    user.resetPasswordExpires = new Date(Date.now() + 3600000); // 1 hour
    await user.save();

    // Send email
    await sendResetEmail(user.email, resetToken);

    res.json({ message: 'Password reset link sent to your email' });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Reset Password
router.post('/reset-password/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const { password } = req.body;

    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: new Date() }
    });

    if (!user) {
      return res.status(400).json({ message: 'Invalid or expired reset token' });
    }

    // Hash new password
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(password, salt);
    
    // Clear reset token and expiry
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    res.json({ message: 'Password has been reset successfully' });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Complete 2FA verification after initial login
router.post('/verify-2fa', async (req, res) => {
  try {
    const { tempToken, token, backupCode } = req.body;

    if (!tempToken) {
      return res.status(400).json({ message: 'Temporary token is required' });
    }

    // Verify the temporary token
    const decoded = jwt.verify(tempToken, process.env.JWT_SECRET || 'fallback-secret') as any;

    if (!decoded.requires2FA) {
      return res.status(400).json({ message: 'Invalid temporary token' });
    }

    const user = await User.findById(decoded.id);
    if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) {
      return res.status(400).json({ message: '2FA is not enabled for this user' });
    }

    let verified = false;

    // Check backup code first
    if (backupCode && user.twoFactorBackupCodes?.includes(backupCode)) {
      // Remove used backup code
      const updatedCodes = user.twoFactorBackupCodes.filter(code => code !== backupCode);
      await User.findByIdAndUpdate(user._id, {
        twoFactorBackupCodes: updatedCodes
      });
      verified = true;
    } else if (token) {
      // Verify TOTP token
      const speakeasy = await import('speakeasy');
      verified = speakeasy.totp.verify({
        secret: user.twoFactorSecret,
        encoding: 'base32',
        token: token,
        window: 2
      });
    }

    if (!verified) {
      return res.status(400).json({ message: 'Invalid 2FA token or backup code' });
    }

    // Create login notification for security
    await Notification.create({
      userId: user._id,
      type: 'info',
      title: 'Account Login',
      message: `You logged in to your Finly account with 2FA verification.`,
      read: false,
      data: { action: 'login_2fa' }
    });

    // Generate full access token
    const fullToken = jwt.sign(
      { id: user._id, email: user.email, role: user.role },
      process.env.JWT_SECRET || 'fallback-secret',
      { expiresIn: '7d' }
    );

    res.json({
      token: fullToken,
      user: {
        id: user._id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        planTier: user.planTier,
      },
    });
  } catch (err) {
    console.error('Error verifying 2FA:', err);
    res.status(500).json({ message: 'Failed to verify 2FA' });
  }
});

// Enable 2FA - Generate secret and QR code
router.post('/enable-2fa', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.twoFactorEnabled) {
      return res.status(400).json({ message: '2FA is already enabled' });
    }

    // Generate secret
    const secret = speakeasy.generateSecret({
      name: `Finly (${user.email})`,
      issuer: 'Finly'
    });

    // Generate QR code
    const qrCodeUrl = await qrcode.toDataURL(secret.otpauth_url);

    // Generate backup codes
    const backupCodes = [];
    for (let i = 0; i < 8; i++) {
      backupCodes.push(crypto.randomBytes(4).toString('hex').toUpperCase());
    }

    // Save temp secret (will be confirmed later)
    user.twoFactorSecret = secret.base32;
    user.twoFactorBackupCodes = backupCodes;
    await user.save();

    res.json({
      secret: secret.base32,
      qrCode: qrCodeUrl,
      backupCodes
    });
  } catch (err) {
    console.error('Error enabling 2FA:', err);
    res.status(500).json({ message: 'Failed to enable 2FA' });
  }
});

// Confirm 2FA setup
router.post('/confirm-2fa', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { token } = req.body;
    const user = await User.findById(req.user.id);

    if (!user || !user.twoFactorSecret) {
      return res.status(400).json({ message: '2FA setup not initiated' });
    }

    // Verify the token
    const verified = speakeasy.totp.verify({
      secret: user.twoFactorSecret,
      encoding: 'base32',
      token: token,
      window: 2
    });

    if (!verified) {
      return res.status(400).json({ message: 'Invalid token' });
    }

    // Enable 2FA
    user.twoFactorEnabled = true;
    await user.save();

    // Create notification
    await Notification.create({
      userId: user._id,
      type: 'success',
      title: '2FA Enabled',
      message: 'Two-factor authentication has been successfully enabled for your account.',
      read: false
    });

    res.json({ message: '2FA enabled successfully' });
  } catch (err) {
    console.error('Error confirming 2FA:', err);
    res.status(500).json({ message: 'Failed to confirm 2FA' });
  }
});

// Disable 2FA
router.post('/disable-2fa', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { password } = req.body;
    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (!user.twoFactorEnabled) {
      return res.status(400).json({ message: '2FA is not enabled' });
    }

    // Verify password for security
    if (!user.password || !(await bcrypt.compare(password, user.password))) {
      return res.status(400).json({ message: 'Invalid password' });
    }

    // Disable 2FA
    user.twoFactorEnabled = false;
    user.twoFactorSecret = undefined;
    user.twoFactorBackupCodes = undefined;
    await user.save();

    // Create notification
    await Notification.create({
      userId: user._id,
      type: 'warning',
      title: '2FA Disabled',
      message: 'Two-factor authentication has been disabled for your account.',
      read: false
    });

    res.json({ message: '2FA disabled successfully' });
  } catch (err) {
    console.error('Error disabling 2FA:', err);
    res.status(500).json({ message: 'Failed to disable 2FA' });
  }
});

// Get 2FA status
router.get('/2fa-status', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const user = await User.findById(req.user.id).select('twoFactorEnabled');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({
      enabled: user.twoFactorEnabled || false
    });
  } catch (err) {
    console.error('Error getting 2FA status:', err);
    res.status(500).json({ message: 'Failed to get 2FA status' });
  }
});

export default router;
