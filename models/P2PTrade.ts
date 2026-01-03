import mongoose from 'mongoose';

export interface IP2PTrade extends mongoose.Document {
  offerId: mongoose.Types.ObjectId;
  buyerId: mongoose.Types.ObjectId;
  sellerId: mongoose.Types.ObjectId;
  cryptocurrency: string;
  fiatCurrency: string;
  amount: number; // Amount of crypto being traded
  price: number; // Price per unit
  totalFiat: number; // Total fiat amount
  paymentMethod: string;
  status: 'pending' | 'payment_sent' | 'payment_received' | 'crypto_released' | 'completed' | 'cancelled' | 'disputed';
  escrowAmount: number; // Amount held in escrow
  escrowHeld: boolean; // Whether escrow is active
  paymentProof?: string; // URL to payment proof image
  payoutMethod?: string; // Preferred payout method for seller
  payoutDetails?: string; // Payout details (wallet address, bank account, etc.)
  notes?: string;
  completedAt?: Date;
  cancelledAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const p2pTradeSchema = new mongoose.Schema({
  offerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'P2POffer',
    required: true,
  },
  buyerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  sellerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
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
  totalFiat: {
    type: Number,
    required: true,
    min: 0,
  },
  paymentMethod: {
    type: String,
    required: true,
  },
  status: {
    type: String,
    enum: ['pending', 'payment_sent', 'payment_received', 'crypto_released', 'completed', 'cancelled', 'disputed'],
    default: 'pending',
  },
  escrowAmount: {
    type: Number,
    required: true,
    min: 0,
  },
  paymentProof: String,
  notes: {
    type: String,
    maxlength: 1000,
  },
  completedAt: Date,
  cancelledAt: Date,
}, {
  timestamps: true,
});

// Indexes for efficient queries
p2pTradeSchema.index({ buyerId: 1, status: 1 });
p2pTradeSchema.index({ sellerId: 1, status: 1 });
p2pTradeSchema.index({ offerId: 1 });
p2pTradeSchema.index({ status: 1, createdAt: -1 });

const P2PTrade = mongoose.model<IP2PTrade>('P2PTrade', p2pTradeSchema);
export default P2PTrade;
