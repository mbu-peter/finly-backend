import mongoose from 'mongoose';

export interface IMessage extends mongoose.Document {
  senderId: mongoose.Types.ObjectId;
  receiverId: mongoose.Types.ObjectId;
  subject: string;
  content: string;
  isRead: boolean;
  messageType: 'user_to_admin' | 'admin_to_user' | 'admin_broadcast';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  attachments?: string[];
  replyTo?: mongoose.Types.ObjectId; // Reference to parent message if it's a reply
  createdAt: Date;
  updatedAt: Date;
}

const messageSchema = new mongoose.Schema({
  senderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  receiverId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  subject: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200,
  },
  content: {
    type: String,
    required: true,
    maxlength: 5000,
  },
  isRead: {
    type: Boolean,
    default: false,
  },
  messageType: {
    type: String,
    enum: ['user_to_admin', 'admin_to_user', 'admin_broadcast'],
    required: true,
  },
  priority: {
    type: String,
    enum: ['low', 'normal', 'high', 'urgent'],
    default: 'normal',
  },
  attachments: [{
    type: String,
  }],
  replyTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message',
  },
}, {
  timestamps: true,
});

// Index for efficient queries
messageSchema.index({ senderId: 1, createdAt: -1 });
messageSchema.index({ receiverId: 1, createdAt: -1 });
messageSchema.index({ messageType: 1 });
messageSchema.index({ isRead: 1 });

export default mongoose.model<IMessage>('Message', messageSchema);
