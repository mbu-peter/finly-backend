import mongoose from 'mongoose';

interface IContent extends mongoose.Document {
  key: string;
  type: 'hero_image' | 'featured_blog' | 'tutorial_content' | 'settings';
  title?: string;
  content?: string;
  imageUrl?: string;
  blogSlug?: string;
  metadata?: Map<string, any>;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const contentSchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
    unique: true,
  },
  type: {
    type: String,
    required: true,
    enum: ['hero_image', 'featured_blog', 'tutorial_content', 'settings'],
  },
  title: String,
  content: String,
  imageUrl: String,
  blogSlug: String,
  metadata: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
    default: {},
  },
  isActive: {
    type: Boolean,
    default: true,
  },
}, {
  timestamps: true,
});

const Content = mongoose.model<IContent>('Content', contentSchema);
export default Content;
