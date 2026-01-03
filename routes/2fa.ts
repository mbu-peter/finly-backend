import express from 'express';
import speakeasy from 'speakeasy';
import qrcode from 'qrcode';
import User from '../models/User.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';

const router = express.Router();

// Generate 2FA secret and QR code
router.post('/generate', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const secret = speakeasy.generateSecret({
      name: `Finly (${req.user.email})`,
      issuer: 'Finly'
    });

    // Generate QR code as data URL
    const qrCodeUrl = await qrcode.toDataURL(secret.otpauth_url!);

    res.json({
      secret: secret.base32,
      qrCode: qrCodeUrl,
      otpauth_url: secret.otpauth_url
    });
  } catch (err) {
    console.error('Error generating 2FA secret:', err);
    res.status(500).json({ message: 'Failed to generate 2FA secret' });
  }
});

// Enable 2FA after verification
router.post('/enable', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { secret, token } = req.body;

    if (!secret || !token) {
      return res.status(400).json({ message: 'Secret and token are required' });
    }

    // Verify the token
    const verified = speakeasy.totp.verify({
      secret: secret,
      encoding: 'base32',
      token: token,
      window: 2 // Allow 2 codes before/after for clock skew
    });

    if (!verified) {
      return res.status(400).json({ message: 'Invalid 2FA token' });
    }

    // Generate backup codes
    const backupCodes = [];
    for (let i = 0; i < 8; i++) {
      backupCodes.push(Math.random().toString(36).substring(2, 10).toUpperCase());
    }

    // Update user
    await User.findByIdAndUpdate(req.user.id, {
      twoFactorEnabled: true,
      twoFactorSecret: secret,
      twoFactorBackupCodes: backupCodes
    });

    res.json({
      message: '2FA enabled successfully',
      backupCodes: backupCodes
    });
  } catch (err) {
    console.error('Error enabling 2FA:', err);
    res.status(500).json({ message: 'Failed to enable 2FA' });
  }
});

// Disable 2FA
router.post('/disable', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ message: 'Current 2FA token is required' });
    }

    const user = await User.findById(req.user.id);
    if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) {
      return res.status(400).json({ message: '2FA is not enabled' });
    }

    // Verify the token
    const verified = speakeasy.totp.verify({
      secret: user.twoFactorSecret,
      encoding: 'base32',
      token: token,
      window: 2
    });

    if (!verified) {
      return res.status(400).json({ message: 'Invalid 2FA token' });
    }

    // Disable 2FA
    await User.findByIdAndUpdate(req.user.id, {
      twoFactorEnabled: false,
      twoFactorSecret: undefined,
      twoFactorBackupCodes: undefined
    });

    res.json({ message: '2FA disabled successfully' });
  } catch (err) {
    console.error('Error disabling 2FA:', err);
    res.status(500).json({ message: 'Failed to disable 2FA' });
  }
});

// Verify 2FA token (used during login)
router.post('/verify', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { token, backupCode } = req.body;

    const user = await User.findById(req.user.id);
    if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) {
      return res.status(400).json({ message: '2FA is not enabled for this user' });
    }

    let verified = false;

    // Check backup code first
    if (backupCode && user.twoFactorBackupCodes?.includes(backupCode)) {
      // Remove used backup code
      const updatedCodes = user.twoFactorBackupCodes.filter(code => code !== backupCode);
      await User.findByIdAndUpdate(req.user.id, {
        twoFactorBackupCodes: updatedCodes
      });
      verified = true;
    } else if (token) {
      // Verify TOTP token
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

    res.json({ message: '2FA verification successful' });
  } catch (err) {
    console.error('Error verifying 2FA:', err);
    res.status(500).json({ message: 'Failed to verify 2FA' });
  }
});

// Get 2FA status
router.get('/status', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const user = await User.findById(req.user.id).select('twoFactorEnabled');
    res.json({
      enabled: user?.twoFactorEnabled || false
    });
  } catch (err) {
    console.error('Error getting 2FA status:', err);
    res.status(500).json({ message: 'Failed to get 2FA status' });
  }
});

// Regenerate backup codes
router.post('/regenerate-backup', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { token } = req.body;

    const user = await User.findById(req.user.id);
    if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) {
      return res.status(400).json({ message: '2FA is not enabled' });
    }

    // Verify current token
    const verified = speakeasy.totp.verify({
      secret: user.twoFactorSecret,
      encoding: 'base32',
      token: token,
      window: 2
    });

    if (!verified) {
      return res.status(400).json({ message: 'Invalid 2FA token' });
    }

    // Generate new backup codes
    const backupCodes = [];
    for (let i = 0; i < 8; i++) {
      backupCodes.push(Math.random().toString(36).substring(2, 10).toUpperCase());
    }

    // Update user
    await User.findByIdAndUpdate(req.user.id, {
      twoFactorBackupCodes: backupCodes
    });

    res.json({
      message: 'Backup codes regenerated',
      backupCodes: backupCodes
    });
  } catch (err) {
    console.error('Error regenerating backup codes:', err);
    res.status(500).json({ message: 'Failed to regenerate backup codes' });
  }
});

export default router;
