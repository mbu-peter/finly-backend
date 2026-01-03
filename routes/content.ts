import express from 'express';
import Content from '../models/Content.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { adminOnly } from '../middleware/admin.js';
import { upload } from '../middleware/upload.js';

const router = express.Router();

// All routes require admin authentication
router.use(authMiddleware);
router.use(adminOnly);

// Get all content
router.get('/', async (req: AuthRequest, res) => {
  try {
    const content = await Content.find({ isActive: true }).sort({ updatedAt: -1 });
    res.json(content);
  } catch (err: any) {
    console.error('Error fetching content:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get content by key
router.get('/:key', async (req: AuthRequest, res) => {
  try {
    const content = await Content.findOne({ key: req.params.key, isActive: true });
    if (!content) {
      return res.status(404).json({ message: 'Content not found' });
    }
    res.json(content);
  } catch (err: any) {
    console.error('Error fetching content:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update or create content
router.put('/:key', upload.single('image'), async (req: AuthRequest, res) => {
  try {
    const { key } = req.params;
    const updateData: any = { ...req.body };

    // Handle file upload
    if (req.file) {
      updateData.imageUrl = `/uploads/${req.file.filename}`;
    }

    // Handle metadata
    if (req.body.metadata) {
      try {
        updateData.metadata = JSON.parse(req.body.metadata);
      } catch {
        updateData.metadata = {};
      }
    }

    const content = await Content.findOneAndUpdate(
      { key },
      updateData,
      { upsert: true, new: true, runValidators: true }
    );

    res.json(content);
  } catch (err: any) {
    console.error('Error updating content:', err);
    res.status(500).json({ message: err.message || 'Failed to update content' });
  }
});

// Delete content
router.delete('/:key', async (req: AuthRequest, res) => {
  try {
    const content = await Content.findOneAndUpdate(
      { key: req.params.key },
      { isActive: false },
      { new: true }
    );

    if (!content) {
      return res.status(404).json({ message: 'Content not found' });
    }

    res.json({ success: true });
  } catch (err: any) {
    console.error('Error deleting content:', err);
    res.status(500).json({ message: err.message || 'Failed to delete content' });
  }
});

// Public endpoint to get content by key (for frontend)
router.get('/public/:key', async (req, res) => {
  try {
    const content = await Content.findOne({ key: req.params.key, isActive: true });
    if (!content) {
      return res.json(null); // Return null instead of 404 for optional content
    }
    res.json(content);
  } catch (err: any) {
    console.error('Error fetching public content:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;
