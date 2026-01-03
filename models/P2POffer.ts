import mongoose from 'mongoose';

export interface IP2POffer extends mongoose.Document {
  userId: mongoose.Types.ObjectId;
  type: 'buy' | 'sell';
  cryptocurrency: string; // e.g., 'BTC', 'ETH', 'USDT'
  fiatCurrency: string; // e.g., 'USD', 'EUR', 'NGN'
  amount: number; // Amount of crypto to buy/sell
  price: number; // Price per unit in fiat
  minLimit: number; // Minimum trade amount
  maxLimit: number; // Maximum trade amount
  paymentMethods: string[]; // ['bank_transfer', 'paypal', 'cash_app', etc.]
  terms?: string; // Optional terms and conditions
  status: 'active' | 'completed' | 'cancelled' | 'expired';
  completedAt?: Date;
  expiresAt: Date; // When the offer expires
  createdAt: Date;
  updatedAt: Date;
}

const p2pOfferSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  type: {
    type: String,
    enum: ['buy', 'sell'],
    required: true,
  },
  cryptocurrency: {
    type: String,
    required: true,
    uppercase: true,
  },
  fiatCurrency: {
    type: String,
    required: true,
    uppercase: true,
  },
  amount: {
    type: Number,
    required: true,
    min: 0,
  },
  price: {
    type: Number,
    required: true,
    min: 0,
  },
  minLimit: {
    type: Number,
    required: true,
    min: 0,
  },
  maxLimit: {
    type: Number,
    required: true,
    min: 0,
  },
  paymentMethods: [{
    type: String,
    required: true,
  }],
  terms: {
    type: String,
    maxlength: 1000,
  },
  status: {
    type: String,
    enum: ['active', 'completed', 'cancelled', 'expired'],
    default: 'active',
  },
  completedAt: Date,
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours from now
  },
}, {
  timestamps: true,
});

// Indexes for efficient queries
p2pOfferSchema.index({ type: 1, cryptocurrency: 1, fiatCurrency: 1, status: 1 });
p2pOfferSchema.index({ userId: 1, status: 1 });
p2pOfferSchema.index({ expiresAt: 1 });
p2pOfferSchema.index({ createdAt: -1 });

// Virtual for total value
p2pOfferSchema.virtual('totalValue').get(function() {
  return this.amount * this.price;
});

// Pre-save middleware to ensure maxLimit >= minLimit
p2pOfferSchema.pre('save', function(next) {
  if (this.maxLimit < this.minLimit) {
    next(new Error('Maximum limit must be greater than or equal to minimum limit'));
  }
  next();
});

const P2POffer = mongoose.model<IP2POffer>('P2POffer', p2pOfferSchema);
export default P2POffer;
