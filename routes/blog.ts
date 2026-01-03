import express from 'express';
import slugify from 'slugify';
import BlogPost from '../models/BlogPost.js';
import { authMiddleware } from '../middleware/auth.js';
import { adminOnly } from '../middleware/admin.js';
import { upload, blogUpload } from '../middleware/upload.js';

const router = express.Router();

/* ===== PUBLIC ===== */

// List posts
router.get('/', async (req, res) => {
  try {
    const posts = await BlogPost.find({ published: true })
      .sort({ publishedAt: -1, createdAt: -1 })
      .select('title slug excerpt coverImage publishedAt createdAt featured tags')
      .populate('authorId', 'fullName email')
      .lean();
    res.json(posts);
  } catch (err: any) {
    console.error('Error fetching blog list:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

/* ===== ADMIN CMS ===== */

// Get all posts (admin only - includes drafts) - MUST come before /:slug
router.get('/all', authMiddleware, adminOnly, async (req, res) => {
  try {
    const posts = await BlogPost.find()
      .sort({ createdAt: -1 })
      .populate('authorId', 'fullName email')
      .lean();
    res.json(posts);
  } catch (err: any) {
    console.error('Error fetching all blogs:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Single post - MUST come after /all
router.get('/:slug', async (req, res) => {
  try {
    const post = await BlogPost.findOne({
      slug: req.params.slug,
      published: true
    })
      .populate('authorId', 'fullName email')
      .lean();

    if (!post) return res.status(404).json({ message: 'Not found' });
    res.json(post);
  } catch (err: any) {
    console.error('Error fetching blog:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Create
router.post(
  '/',
  authMiddleware,
  adminOnly,
  (req, res, next) => {
    upload.single('cover')(req, res, (err: any) => {
      if (err) {
        console.error('Multer error:', err);
        return res.status(400).json({ message: err.message || 'File upload error' });
      }
      next();
    });
  },
  async (req, res) => {
    try {
      console.log('Creating blog - Body:', req.body);
      console.log('Creating blog - File:', req.file);
      
      if (!req.body.title || !req.body.excerpt || !req.body.content) {
        return res.status(400).json({ message: 'Title, excerpt, and content are required' });
      }

      const tags = req.body.tags ? (typeof req.body.tags === 'string' ? req.body.tags.split(',').map((t: string) => t.trim()).filter(Boolean) : req.body.tags) : [];
      
      const post = await BlogPost.create({
        title: req.body.title,
        slug: slugify(req.body.title, { lower: true }),
        excerpt: req.body.excerpt,
        content: req.body.content,
        coverImage: req.file ? `/uploads/${req.file.filename}` : undefined,
        featured: req.body.featured === 'true' || req.body.featured === true,
        published: req.body.published === 'true' || req.body.published === true,
        tags: tags,
        authorId: req.user.id
      });

      res.status(201).json(post);
    } catch (err: any) {
      console.error('Error creating blog:', err);
      res.status(500).json({ message: err.message || 'Failed to create blog post' });
    }
  }
);

// Update
router.put(
  '/:id',
  authMiddleware,
  adminOnly,
  (req, res, next) => {
    upload.single('cover')(req, res, (err: any) => {
      if (err) {
        console.error('Multer error:', err);
        return res.status(400).json({ message: err.message || 'File upload error' });
      }
      next();
    });
  },
  async (req, res) => {
    try {
      const update: any = {};
      
      if (req.body.title) {
        update.title = req.body.title;
        update.slug = slugify(req.body.title, { lower: true });
      }
      if (req.body.excerpt !== undefined) update.excerpt = req.body.excerpt;
      if (req.body.content !== undefined) update.content = req.body.content;
      
      if (req.file) {
        update.coverImage = `/uploads/${req.file.filename}`;
      }
      
      // Handle tags
      if (req.body.tags !== undefined) {
        update.tags = typeof req.body.tags === 'string' 
          ? req.body.tags.split(',').map((t: string) => t.trim()).filter(Boolean)
          : req.body.tags;
      }
      
      // Handle boolean fields
      if (req.body.published !== undefined) {
        update.published = req.body.published === 'true' || req.body.published === true;
      }
      if (req.body.featured !== undefined) {
        update.featured = req.body.featured === 'true' || req.body.featured === true;
      }

      const post = await BlogPost.findByIdAndUpdate(
        req.params.id,
        update,
        { new: true, runValidators: true }
      );

      if (!post) {
        return res.status(404).json({ message: 'Blog post not found' });
      }

      res.json(post);
    } catch (err: any) {
      console.error('Error updating blog:', err);
      res.status(500).json({ message: err.message || 'Failed to update blog post' });
    }
  }
);

// Upload blog content image
router.post('/upload-image', authMiddleware, adminOnly, blogUpload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No image file provided' });
    }

    const imageUrl = `/uploads/blog/${req.file.filename}`;
    res.json({ imageUrl, success: true });
  } catch (err: any) {
    console.error('Error uploading blog image:', err);
    res.status(500).json({ message: 'Failed to upload image' });
  }
});

// Delete
router.delete('/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const post = await BlogPost.findByIdAndDelete(req.params.id);
    if (!post) {
      return res.status(404).json({ message: 'Blog post not found' });
    }
    res.json({ success: true });
  } catch (err: any) {
    console.error('Error deleting blog:', err);
    res.status(500).json({ message: err.message || 'Failed to delete blog post' });
  }
});

export default router;
