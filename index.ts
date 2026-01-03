/*
 * Copyright (c) 2026 [Your Name or Company Name]. All rights reserved.
 * This software is proprietary and confidential.
 * See LICENSE file for details.
 */

import 'dotenv/config';
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import User from './models/User.js';
import authRoutes from './routes/auth.js';
import transactionRoutes from './routes/transactions.js';
import profileRoutes from './routes/profile.js';
import stripeRoutes from './routes/stripe.js';
import walletRoutes from './routes/wallets.js';
import marketRoutes from './routes/market.js';
import agentRoutes from './routes/agent.js';
import adminRoutes from './routes/admin.js';
import blogRoutes from './routes/blog.js';
import contentRoutes from './routes/content.js';
import p2pRoutes from './routes/p2p.js';
import twoFactorRoutes from './routes/2fa.js';

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'));
app.use(passport.initialize());

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/vibe')
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// Google Auth Strategy
passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID || 'dummy',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || 'dummy',
    callbackURL: "/api/auth/google/callback"
  },
  async (accessToken: string, refreshToken: string, profile: any, done: any) => {
    try {
      let user: any = await User.findOne({ googleId: profile.id });
      if (!user) {
        user = await User.findOne({ email: profile.emails?.[0].value });
        if (user) {
          user.googleId = profile.id;
          await user.save();
        } else {
          user = await User.create({
            googleId: profile.id,
            email: profile.emails?.[0].value,
            fullName: profile.displayName,
          });
        }
      }
      return done(null, user);
    } catch (err) {
      return done(err as Error, undefined);
    }
  }
));

// Routes
app.get('/', (req: express.Request, res: express.Response) => {
  res.send('Vibe API is running');
});
import notificationRoutes from './routes/notifications.js';
import messageRoutes from './routes/messages.js';

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/stripe', stripeRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/wallets', walletRoutes);
app.use('/api/market', marketRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/2fa', twoFactorRoutes);
app.use('/api/agent', agentRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/blog', blogRoutes);
app.use('/api/content', contentRoutes);
app.use('/api/p2p', p2pRoutes);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
