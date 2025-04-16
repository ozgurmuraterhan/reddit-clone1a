const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const SavedItemSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    post: {
      type: Schema.Types.ObjectId,
      ref: 'Post',
    },
    comment: {
      type: Schema.Types.ObjectId,
      ref: 'Comment',
    },
    savedAt: {
      type: Date,
      default: Date.now,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
    notes: {
      type: String,
      maxlength: [500, 'Notes cannot exceed 500 characters'],
    },
    category: {
      type: String,
      default: 'uncategorized',
    },
  },
  {
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// Middleware to update timestamps
SavedItemSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
});

// Validation to ensure either post or comment is provided, but not both
SavedItemSchema.pre('validate', function (next) {
  if ((this.post && this.comment) || (!this.post && !this.comment)) {
    next(
      new Error('A saved item must be associated with either a post or a comment, but not both'),
    );
  }
  next();
});

// Virtual fields for accessing related subreddit information
SavedItemSchema.virtual('subreddit', {
  ref: 'Subreddit',
  localField: 'post.subreddit',
  foreignField: '_id',
  justOne: true,
});

// Compound indexes for uniqueness and efficient querying
SavedItemSchema.index({ user: 1, post: 1 }, { unique: true, sparse: true });
SavedItemSchema.index({ user: 1, comment: 1 }, { unique: true, sparse: true });
SavedItemSchema.index({ user: 1, savedAt: -1 }); // For efficiently retrieving user's saved items by date
SavedItemSchema.index({ user: 1, category: 1, savedAt: -1 }); // For categorized views

module.exports = mongoose.model('SavedItem', SavedItemSchema);
