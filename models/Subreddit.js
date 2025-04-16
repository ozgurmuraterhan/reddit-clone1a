const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const slugify = require('slugify');

const SubredditSchema = new Schema(
  {
    name: {
      type: String,
      required: [true, 'Please provide a subreddit name'],
      trim: true,
      minlength: [3, 'Subreddit name must be at least 3 characters'],
      maxlength: [21, 'Subreddit name cannot exceed 21 characters'],
      match: [
        /^[a-zA-Z0-9_]+$/,
        'Subreddit name can only contain letters, numbers and underscores',
      ],
    },
    title: {
      type: String,
      required: [true, 'Please provide a title'],
      trim: true,
      minlength: [3, 'Title must be at least 3 characters'],
      maxlength: [100, 'Title cannot exceed 100 characters'],
    },
    description: {
      type: String,
      maxlength: [500, 'Description cannot exceed 500 characters'],
    },
    sidebar: {
      type: String,
      maxlength: [10000, 'Sidebar content cannot exceed 10000 characters'],
    },
    icon: {
      type: String,
      default: 'default-subreddit-icon.png',
    },
    banner: {
      type: String,
      default: 'default-subreddit-banner.png',
    },
    creator: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    type: {
      type: String,
      enum: ['public', 'restricted', 'private'],
      default: 'public',
    },
    nsfw: {
      type: Boolean,
      default: false,
    },
    memberCount: {
      type: Number,
      default: 1, // Creator is automatically a member
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
    isDeleted: {
      type: Boolean,
      default: false,
    },
    deletedAt: Date,
  },
  {
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// Create slug from name
SubredditSchema.pre('save', function (next) {
  if (this.isModified('name')) {
    this.slug = slugify(this.name, { lower: true });
  }
  this.updatedAt = Date.now();
  next();
});

// Middleware to handle soft delete
SubredditSchema.pre('find', function () {
  this.where({ isDeleted: false });
});

SubredditSchema.pre('findOne', function () {
  this.where({ isDeleted: false });
});

// Virtual for subreddit's posts
SubredditSchema.virtual('posts', {
  ref: 'Post',
  localField: '_id',
  foreignField: 'subreddit',
  justOne: false,
});

// Virtual for subreddit's rules
SubredditSchema.virtual('rules', {
  ref: 'SubredditRule',
  localField: '_id',
  foreignField: 'subreddit',
  justOne: false,
});

// Virtual for subreddit's memberships
SubredditSchema.virtual('memberships', {
  ref: 'SubredditMembership',
  localField: '_id',
  foreignField: 'subreddit',
  justOne: false,
});

// Virtual for subreddit's flairs
SubredditSchema.virtual('flairs', {
  ref: 'Flair',
  localField: '_id',
  foreignField: 'subreddit',
  justOne: false,
});

// Virtual for subreddit's settings
SubredditSchema.virtual('settings', {
  ref: 'SubredditSettings',
  localField: '_id',
  foreignField: 'subreddit',
  justOne: true,
});

// Index for faster queries
SubredditSchema.index({ name: 1 }, { unique: true });
SubredditSchema.index({ slug: 1 });
SubredditSchema.index({ creator: 1 });
SubredditSchema.index({ type: 1 });
SubredditSchema.index({ nsfw: 1 });
SubredditSchema.index({ memberCount: -1 });
SubredditSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Subreddit', SubredditSchema);
