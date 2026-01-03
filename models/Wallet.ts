import mongoose from 'mongoose';
import crypto from 'crypto';

export interface IWallet extends mongoose.Document {
  userId: mongoose.Types.ObjectId;
  cryptocurrency: string; // 'BTC', 'ETH', etc.
  network: string; // 'BTC', 'ERC20', 'BEP20', 'SOL', etc.
  address: string; // Generated wallet address
  privateKey: string; // Encrypted private key (in production, use HSM)
  publicKey: string; // Public key for verification
  derivationPath: string; // HD wallet derivation path
  label?: string; // Custom label for the wallet
  isDefault: boolean; // Default wallet for this crypto
  balance: number; // Available balance
  lockedBalance: number; // Amount locked in trades/escrow
  totalDeposits: number; // Total deposited
  totalWithdrawals: number; // Total withdrawn
  isActive: boolean; // Whether wallet is active
  createdAt: Date;
  updatedAt: Date;
}

const walletSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
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
  address: {
    type: String,
    required: true,
    unique: true,
  },
  privateKey: {
    type: String,
    required: true,
  },
  publicKey: {
    type: String,
    required: true,
  },
  derivationPath: {
    type: String,
    required: true,
  },
  label: {
    type: String,
    maxlength: 50,
  },
  isDefault: {
    type: Boolean,
    default: false,
  },
  balance: {
    type: Number,
    default: 0,
    min: 0,
  },
  lockedBalance: {
    type: Number,
    default: 0,
    min: 0,
  },
  totalDeposits: {
    type: Number,
    default: 0,
    min: 0,
  },
  totalWithdrawals: {
    type: Number,
    default: 0,
    min: 0,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
}, {
  timestamps: true,
});

// Ensure only one default wallet per cryptocurrency per user
walletSchema.pre('save', async function(next) {
  if (this.isDefault) {
    await this.constructor.updateMany(
      { userId: this.userId, cryptocurrency: this.cryptocurrency, _id: { $ne: this._id } },
      { isDefault: false }
    );
  }
  next();
});

// Indexes
walletSchema.index({ userId: 1, cryptocurrency: 1 });
walletSchema.index({ userId: 1, isDefault: 1 });

const Wallet = mongoose.model<IWallet>('Wallet', walletSchema);
export default Wallet;
