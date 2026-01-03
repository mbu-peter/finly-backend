import mongoose from 'mongoose';

interface IUser extends mongoose.Document {
  email: string;
  password?: string;
  fullName?: string;
  googleId?: string;
  planTier: 'basic' | 'standard' | 'premium';
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  identityVerified?: boolean;
  stripeIdentityVerificationSessionId?: string;
  issuingCardholderId?: string;
  issuingCardId?: string;
  treasuryFinancialAccountId?: string;
  cardNumber?: string;
  cardExpiryMonth?: number;
  cardExpiryYear?: number;
  cardBrand?: string;
  cardStatus: 'active' | 'inactive' | 'canceled';
  fiatBalance: number;
  portfolio: Map<string, number>;
  encryptedPrivateKey?: string;
  walletAddresses: Map<string, string>;
  role: 'user' | 'admin';
  resetPasswordToken?: string;
  resetPasswordExpires?: Date;
  otp?: string;
  otpExpires?: Date;
  avatar?: string;
  twoFactorEnabled: boolean;
  twoFactorSecret?: string;
  twoFactorBackupCodes?: string[];
  notifications: {
    emailAlerts: boolean;
    securityAlerts: boolean;
    marketing: boolean;
  };
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
  },
  password: {
    type: String,
    required: function(this: any) {
      return !this.googleId;
    },
  },
  fullName: {
    type: String,
    trim: true,
  },
  googleId: {
    type: String,
    unique: true,
    sparse: true,
  },
  planTier: {
    type: String,
    enum: ['basic', 'standard', 'premium'],
    default: 'basic',
  },
  stripeCustomerId: String,
  stripeSubscriptionId: String,
  identityVerified: { type: Boolean, default: false },
  stripeIdentityVerificationSessionId: String,
  issuingCardholderId: String,
  issuingCardId: String,
  treasuryFinancialAccountId: String,
  cardNumber: String,
  cardExpiryMonth: Number,
  cardExpiryYear: Number,
  cardBrand: String,
  cardStatus: {
    type: String,
    enum: ['active', 'inactive', 'canceled'],
    default: 'inactive',
  },
  fiatBalance: {
    type: Number,
    default: 0,
  },
  portfolio: {
    type: Map,
    of: Number,
    default: {},
  },
  encryptedPrivateKey: {
    type: String,
  },
  walletAddresses: {
    type: Map,
    of: String,
    default: {},
  },
  resetPasswordToken: String,
  resetPasswordExpires: Date,
  otp: String,
  otpExpires: Date,
  avatar: String,
  twoFactorEnabled: {
    type: Boolean,
    default: false,
  },
  twoFactorSecret: String,
  twoFactorBackupCodes: [String],
  notifications: {
    emailAlerts: { type: Boolean, default: true },
    securityAlerts: { type: Boolean, default: true },
    marketing: { type: Boolean, default: false }
  },
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user'
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

userSchema.pre('save', function(this: any, next) {
  this.updatedAt = new Date();
  next();
});

const User = mongoose.model<IUser>('User', userSchema);
export default User;
