import express from 'express';
import Message from '../models/Message.js';
import User from '../models/User.js';
import Notification from '../models/Notification.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';

const router = express.Router();

// Apply auth middleware to all routes
router.use(authMiddleware);

// Get user's messages
router.get('/', async (req: AuthRequest, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    let messages = await Message.find({
      $or: [
        { senderId: req.user.id },
        { receiverId: req.user.id }
      ]
    })
    .populate('senderId', 'fullName email role')
    .populate('receiverId', 'fullName email role')
    .populate('replyTo', 'subject')
    .sort({ createdAt: -1 })
    .lean();

    // Deduplicate sent messages (user-to-admin messages that were sent to multiple admins)
    const seenSentMessages = new Set();
    messages = messages.filter(message => {
      if (message.senderId._id.toString() === req.user.id.toString() && message.messageType === 'user_to_admin') {
        // This is a sent user-to-admin message
        const messageKey = `${message.subject}-${message.content}-${message.createdAt.getTime()}`;
        if (seenSentMessages.has(messageKey)) {
          return false; // Duplicate, filter out
        }
        seenSentMessages.add(messageKey);
      }
      return true;
    });

    // Apply pagination after deduplication
    const total = messages.length;
    messages = messages.slice(skip, skip + limit);

    // Mark messages as read when fetched (for received messages)
    await Message.updateMany(
      { receiverId: req.user.id, isRead: false },
      { isRead: true }
    );

    res.json({
      messages,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    console.error('Error fetching messages:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Send a message
router.post('/', async (req: AuthRequest, res) => {
  try {
    const { receiverId, subject, content, messageType, priority, replyTo } = req.body;

    if (!subject || !content) {
      return res.status(400).json({ message: 'Subject and content are required' });
    }

    // Validate message type based on user role
    const sender = await User.findById(req.user.id);
    if (!sender) return res.status(404).json({ message: 'Sender not found' });

    let validMessageType = messageType;
    let finalReceiverId = receiverId;

    if (sender.role === 'admin') {
      // Admins can send to users or broadcast
      if (!['admin_to_user', 'admin_broadcast'].includes(messageType)) {
        validMessageType = 'admin_to_user';
      }
      if (!receiverId) {
        return res.status(400).json({ message: 'Receiver ID is required for admin messages' });
      }
      finalReceiverId = receiverId;
    } else {
      // Regular users can only send to admins
      validMessageType = 'user_to_admin';
      // For user_to_admin messages, we need to send to ALL admins
      // We'll create separate message records for each admin
      const admins = await User.find({ role: 'admin' });
      if (admins.length === 0) return res.status(500).json({ message: 'No admin available' });

      // Create messages for all admins
      const messages = [];
      for (const admin of admins) {
        const message = await Message.create({
          senderId: req.user.id,
          receiverId: admin._id,
          subject: subject.trim(),
          content: content.trim(),
          messageType: validMessageType,
          priority: priority || 'normal',
          replyTo: replyTo || null,
          isRead: false,
        });

        // Create notification for each admin
        await Notification.create({
          userId: admin._id,
          type: 'info',
          title: 'New User Message',
          message: `New message from ${sender.fullName}: ${subject}`,
          read: false,
          data: {
            action: 'new_user_message',
            messageId: message._id,
            senderId: req.user.id,
            subject
          }
        });

        messages.push(message);
      }

      // Return success response with the first message as reference
      const populatedMessage = await Message.findById(messages[0]._id)
        .populate('senderId', 'fullName email role')
        .populate('receiverId', 'fullName email role');

      return res.status(201).json({
        ...populatedMessage?.toObject(),
        sentToAdmins: messages.length
      });
    }

    // Handle admin sending to specific user
    const message = await Message.create({
      senderId: req.user.id,
      receiverId: finalReceiverId,
      subject: subject.trim(),
      content: content.trim(),
      messageType: validMessageType,
      priority: priority || 'normal',
      replyTo: replyTo || null,
      isRead: false,
    });

    // Create notification for receiver
    await Notification.create({
      userId: finalReceiverId,
      type: 'info',
      title: 'New Admin Message',
      message: `Message from admin: ${subject}`,
      read: false,
      data: {
        action: 'admin_message',
        messageId: message._id,
        senderId: req.user.id,
        subject
      }
    });

    const populatedMessage = await Message.findById(message._id)
      .populate('senderId', 'fullName email role')
      .populate('receiverId', 'fullName email role');

    res.status(201).json(populatedMessage);
  } catch (err) {
    console.error('Error sending message:', err);
    res.status(500).json({ message: 'Failed to send message' });
  }
});

// Mark message as read
router.put('/:id/read', async (req: AuthRequest, res) => {
  try {
    const message = await Message.findOneAndUpdate(
      {
        _id: req.params.id,
        receiverId: req.user.id
      },
      { isRead: true },
      { new: true }
    ).populate('senderId', 'fullName email role')
     .populate('receiverId', 'fullName email role');

    if (!message) {
      return res.status(404).json({ message: 'Message not found' });
    }

    res.json(message);
  } catch (err) {
    console.error('Error marking message as read:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get conversation between user and admin
router.get('/conversation/:userId', async (req: AuthRequest, res) => {
  try {
    const otherUserId = req.params.userId;

    const messages = await Message.find({
      $or: [
        { senderId: req.user.id, receiverId: otherUserId },
        { senderId: otherUserId, receiverId: req.user.id }
      ]
    })
    .populate('senderId', 'fullName email role')
    .populate('receiverId', 'fullName email role')
    .populate('replyTo', 'subject')
    .sort({ createdAt: 1 }) // Oldest first for conversation view
    .lean();

    // Mark received messages as read
    await Message.updateMany(
      { senderId: otherUserId, receiverId: req.user.id, isRead: false },
      { isRead: true }
    );

    res.json(messages);
  } catch (err) {
    console.error('Error fetching conversation:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Admin routes
// Get all users with their message status (only users who have sent messages)
router.get('/admin/users', async (req: AuthRequest, res) => {
  try {
    // Check if user is admin
    const admin = await User.findById(req.user.id);
    if (admin?.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }

    // Get users who have sent messages to admins
    const usersWithMessages = await Message.distinct('senderId', {
      messageType: 'user_to_admin'
    });

    const users = await User.find({
      role: { $ne: 'admin' },
      _id: { $in: usersWithMessages }
    })
      .select('fullName email _id createdAt')
      .sort({ createdAt: -1 })
      .lean();

    // Get unread message counts for each user
    const userMessageStats = await Promise.all(
      users.map(async (user) => {
        const unreadCount = await Message.countDocuments({
          senderId: user._id,
          receiverId: { $in: await User.find({ role: 'admin' }).distinct('_id') },
          isRead: false
        });

        const lastMessage = await Message.findOne({
          $or: [
            { senderId: user._id, receiverId: { $in: await User.find({ role: 'admin' }).distinct('_id') } },
            { receiverId: user._id, senderId: { $in: await User.find({ role: 'admin' }).distinct('_id') } }
          ]
        }).sort({ createdAt: -1 });

        return {
          ...user,
          unreadMessages: unreadCount,
          lastMessageAt: lastMessage?.createdAt || null,
        };
      })
    );

    res.json(userMessageStats);
  } catch (err) {
    console.error('Error fetching admin user list:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get admin unread message count
router.get('/admin/unread-count', async (req: AuthRequest, res) => {
  try {
    // Check if user is admin
    const admin = await User.findById(req.user.id);
    if (admin?.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }

    const unreadCount = await Message.countDocuments({
      receiverId: req.user.id,
      isRead: false
    });

    res.json({ unreadCount });
  } catch (err) {
    console.error('Error fetching unread count:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Search all users for recipient selection
router.get('/admin/search-users', async (req: AuthRequest, res) => {
  try {
    // Check if user is admin
    const admin = await User.findById(req.user.id);
    if (admin?.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }

    const { q } = req.query;
    let query = { role: { $ne: 'admin' } };

    if (q && typeof q === 'string') {
      query = {
        ...query,
        $or: [
          { fullName: { $regex: q, $options: 'i' } },
          { email: { $regex: q, $options: 'i' } }
        ]
      };
    }

    const users = await User.find(query)
      .select('fullName email _id')
      .sort({ fullName: 1 })
      .limit(50) // Limit results
      .lean();

    res.json(users);
  } catch (err) {
    console.error('Error searching users:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Admin broadcast message to all users
router.post('/admin/broadcast', async (req: AuthRequest, res) => {
  try {
    const admin = await User.findById(req.user.id);
    if (admin?.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }

    const { subject, content, priority } = req.body;
    if (!subject || !content) {
      return res.status(400).json({ message: 'Subject and content are required' });
    }

    const users = await User.find({ role: { $ne: 'admin' } });
    const messages = [];

    for (const user of users) {
      const message = await Message.create({
        senderId: req.user.id,
        receiverId: user._id,
        subject: subject.trim(),
        content: content.trim(),
        messageType: 'admin_broadcast',
        priority: priority || 'normal',
        isRead: false,
      });

      // Create notification for each user
      await Notification.create({
        userId: user._id,
        type: 'info',
        title: 'Admin Broadcast',
        message: `Important message from admin: ${subject}`,
        read: false,
        data: {
          action: 'admin_broadcast',
          messageId: message._id,
          subject
        }
      });

      messages.push(message);
    }

    res.status(201).json({
      message: `Broadcast sent to ${messages.length} users`,
      count: messages.length
    });
  } catch (err) {
    console.error('Error sending broadcast:', err);
    res.status(500).json({ message: 'Failed to send broadcast' });
  }
});

export default router;
