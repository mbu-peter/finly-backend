import express from 'express';
import Stripe from 'stripe';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import User from '../models/User.js';

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2023-10-16' as any,
});

/**
 * @route POST /api/stripe/create-identity-verification-session
 * @desc Create a Stripe Identity Verification Session for KYC
 */
router.post('/create-identity-verification-session', authMiddleware, async (req: AuthRequest, res: express.Response) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // If already verified, return
    if (user.identityVerified) {
      return res.json({ status: 'verified', message: 'User already verified' });
    }

    // Create session
    const verificationSession = await stripe.identity.verificationSessions.create({
      type: 'document',
      metadata: {
        userId: user._id.toString(),
      },
      options: {
        document: {
          allowed_types: ['driving_license', 'passport', 'id_card'],
          require_live_capture: true,
          require_matching_selfie: true,
        },
      },
      return_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/cards?verified=true`,
    });

    // Save session ID to user
    user.stripeIdentityVerificationSessionId = verificationSession.id;
    await user.save();

    res.json({
      clientSecret: verificationSession.client_secret,
      status: verificationSession.status,
    });
  } catch (err: any) {
    console.error('Stripe Identity Error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @route GET /api/stripe/check-identity-verification
 * @desc Check status of verification
 */
router.get('/check-identity-verification', authMiddleware, async (req: AuthRequest, res: express.Response) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (user.identityVerified) {
      return res.json({ status: 'verified' });
    }

    if (!user.stripeIdentityVerificationSessionId) {
      return res.json({ status: 'requires_input' });
    }

    const session = await stripe.identity.verificationSessions.retrieve(user.stripeIdentityVerificationSessionId);

    if (session.status === 'verified') {
      user.identityVerified = true;
      await user.save();
    }

    res.json({ status: session.status });
  } catch (err: any) {
    console.error('Check Verification Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// --- Existing Routes ---

router.post('/create-charge', authMiddleware, async (req: AuthRequest, res: express.Response) => {
  try {
    const { plan, paymentMethodId } = req.body;
    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Determine amount based on plan
    const amounts: { [key: string]: number } = {
      standard: 1200,
      premium: 2900,
    };
    const amount = amounts[plan as string] || 1200;

    // Create or get Stripe customer
    let stripeCustomerId = user.stripeCustomerId;
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { userId: user.id.toString() },
      });
      stripeCustomerId = customer.id;
      user.stripeCustomerId = stripeCustomerId;
      await user.save();
    }

    // Create PaymentIntent
    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency: 'usd',
      customer: stripeCustomerId,
      payment_method: paymentMethodId,
      off_session: false,
      confirm: true,
      return_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/dashboard`,
      metadata: { userId: user._id.toString(), plan },
    });

    console.log(`PaymentIntent status for user ${user.email}: ${paymentIntent.status}`);

    if (paymentIntent.status === 'succeeded') {
      user.planTier = plan as 'basic' | 'standard' | 'premium';
      await user.save();
      // ... (Issue card logic logic kept for now, but should ideally rely on webhook)
      // I'm keeping the existing logic here for backward compatibility flow
      // But logically, cards should gate on identityVerified now. 
      // For this step I'll leave the payment flow 'as is' but add the check in the Card Issuance flow later.
    }

    res.json({
      status: paymentIntent.status,
      clientSecret: paymentIntent.client_secret,
      plan: user.planTier,
      card: {
        last4: user.cardNumber,
        brand: user.cardBrand,
        expiryMonth: user.cardExpiryMonth,
        expiryYear: user.cardExpiryYear,
        status: user.cardStatus
      }
    });
  } catch (err: any) {
    console.error('Stripe Error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/confirm-payment', authMiddleware, async (req: AuthRequest, res: express.Response) => {
  try {
    const { paymentIntentId, plan } = req.body;
    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (paymentIntent.status === 'succeeded') {
      if (user.planTier !== plan) {
        user.planTier = plan as 'basic' | 'standard' | 'premium';
        await user.save();
      }
       return res.json({
        status: 'succeeded',
        plan: user.planTier,
        card: {
          last4: user.cardNumber,
          brand: user.cardBrand,
          expiryMonth: user.cardExpiryMonth,
          expiryYear: user.cardExpiryYear,
          status: user.cardStatus
        }
      });
    }

    res.status(400).json({ status: paymentIntent.status, error: 'Payment not successful' });
  } catch (err: any) {
    console.error('Confirm Payment Error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
