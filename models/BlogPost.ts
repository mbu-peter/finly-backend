import mongoose from 'mongoose';

const BlogPostSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    excerpt: { type: String, required: true },
    content: { type: String, required: true }, // Markdown
    coverImage: { type: String },
    authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    featured: { type: Boolean, default: false },
    published: { type: Boolean, default: true },
    publishedAt: { type: Date, default: Date.now },

    tags: [String]
  },
  { timestamps: true }
);

export default mongoose.model('BlogPost', BlogPostSchema);
