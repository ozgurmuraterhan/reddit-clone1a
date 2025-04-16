const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const slugify = require('slugify');

const PostSchema = new Schema(
  {
    title: {
      type: String,
      required: [true, 'Please provide a title'],
      trim: true,
      maxlength: [300, 'Title cannot exceed 300 characters'],
    },
    content: {
      type: String,
      trim: true,
      maxlength: [40000, 'Content cannot exceed 40000 characters'],
    },
    wikiPage: {
      type: Schema.Types.ObjectId,
      ref: 'WikiPage',
    },
    type: {
      type: String,
      enum: ['text', 'link', 'image', 'video', 'poll', 'wiki_discussion'],
      default: 'text',
      required: true,
    },
    url: {
      type: String,
      trim: true,
      validate: {
        validator: function (v) {
          return this.type !== 'link' || (this.type === 'link' && v);
        },
        message: 'URL is required for link posts',
      },
    },
    mediaUrl: {
      type: String,
      trim: true,
      validate: {
        validator: function (v) {
          return (
            !['image', 'video'].includes(this.type) || (['image', 'video'].includes(this.type) && v)
          );
        },
        message: 'Media URL is required for image and video posts',
      },
    },
    author: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    subreddit: {
      type: Schema.Types.ObjectId,
      ref: 'Subreddit',
      required: true,
    },
    flair: {
      type: Schema.Types.ObjectId,
      ref: 'Flair',
    },
    upvotes: {
      type: Number,
      default: 0,
    },
    downvotes: {
      type: Number,
      default: 0,
    },
    voteScore: {
      type: Number,
      default: 0,
    },
    commentCount: {
      type: Number,
      default: 0,
    },
    isNSFW: {
      type: Boolean,
      default: false,
    },
    isSpoiler: {
      type: Boolean,
      default: false,
    },
    isLocked: {
      type: Boolean,
      default: false,
    },
    isPinned: {
      type: Boolean,
      default: false,
    },
    isArchived: {
      type: Boolean,
      default: false,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
    deletedAt: Date,
    deletedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    slug: String,
    createdAt: {
      type: Date,
      default: Date.now,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
    editedAt: Date,
    editHistory: [
      {
        type: Schema.Types.ObjectId,
        ref: 'EditHistory',
      },
    ],
  },
  {
    toJSON: { virtues: true },
    toObject: { virtues: true },
    id: false,
  },
);

// Create slug from title
PostSchema.pre('save', function (next) {
  if (this.isModified('title')) {
    this.slug = slugify(this.title.substring(0, 60), {
      lower: true,
      strict: true,
    });

    // Add random string to ensure uniqueness
    this.slug += '-' + Math.random().toString(36).substring(2, 8);
  }

  if (this.isModified('upvotes') || this.isModified('downvotes')) {
    this.voteScore = this.upvotes - this.downvotes;
  }

  if (this.isModified() && !this.isNew && !this.isModified('editedAt')) {
    this.editedAt = Date.now();
  }

  this.updatedAt = Date.now();
  next();
});

// Middleware to handle soft delete
PostSchema.pre('find', function () {
  if (!this._conditions.isDeleted) {
    this.where({ isDeleted: false });
  }
});

PostSchema.pre('findOne', function () {
  if (!this._conditions.isDeleted) {
    this.where({ isDeleted: false });
  }
});

// Virtual for comments
PostSchema.virtual('comments', {
  ref: 'Comment',
  localField: '_id',
  foreignField: 'post',
  justOne: false,
});

// Virtual for votes
PostSchema.virtual('votes', {
  ref: 'Vote',
  localField: '_id',
  foreignField: 'post',
  justOne: false,
});

// Virtual for poll (if post type is poll)
PostSchema.virtual('poll', {
  ref: 'Poll',
  localField: '_id',
  foreignField: 'post',
  justOne: true,
});

// Indexes for faster queries
PostSchema.index({ author: 1, createdAt: -1 });
PostSchema.index({ subreddit: 1, createdAt: -1 });
PostSchema.index({ voteScore: -1 });
PostSchema.index({ createdAt: -1 });
PostSchema.index({ slug: 1 });
PostSchema.index({ title: 'text', content: 'text' });

module.exports = mongoose.model('Post', PostSchema);
