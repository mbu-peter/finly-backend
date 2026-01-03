import mongoose from 'mongoose';

export interface IDeposit extends mongoose.Document {
  userId: mongoose.Types.ObjectId;
  walletId: mongoose.Types.ObjectId;
  cryptocurrency: string;
  network: string;
  amount: number;
  txHash?: string; // Blockchain transaction hash
  status: 'pending' | 'confirmed' | 'failed' | 'cancelled';
  confirmations?: number;
  requiredConfirmations?: number;
  depositAddress: string; // Address where user sent funds
  notes?: string;
  processedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const depositSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  walletId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Wallet',
    required: true,
  },
  cryptocurrency: {
    type: String,
    required: true,
    uppercase: true,
  },
  network: {
    type: String,
    required: true,
  },
  amount: {
    type: Number,
    required: true,
    min: 0,
  },
  txHash: {
    type: String,
    sparse: true, // Allow null but ensure uniqueness when present
  },
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'failed', 'cancelled'],
    default: 'pending',
  },
  confirmations: {
    type: Number,
    default: 0,
  },
  requiredConfirmations: {
    type: Number,
    default: 1,
  },
  depositAddress: {
    type: String,
    required: true,
  },
  notes: String,
  processedAt: Date,
}, {
  timestamps: true,
});

// Indexes
depositSchema.index({ userId: 1, status: 1 });
depositSchema.index({ walletId: 1 });
depositSchema.index({ status: 1, createdAt: -1 });

const Deposit = mongoose.model<IDeposit>('Deposit', depositSchema);
export default Deposit;
