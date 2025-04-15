const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const CommentSchema = new Schema({
  content: {
    type: String,
    required: [true, 'Comment content is required'],
    trim: true,
    maxlength: [10000, 'Comment cannot exceed 10000 characters']
  },
  author: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  post: {
    type: Schema.Types.ObjectId,
    ref: 'Post',
    required: true
  },
  parent: {
    type: Schema.Types.ObjectId,
    ref: 'Comment',
    default: null
  },
  upvotes: {
    type: Number,
    default: 0
  },
  downvotes: {
    type: Number,
    default: 0
  },
  voteScore: {
    type: Number,
    default: 0
  },
  replyCount: {
    type: Number,
    default: 0
  },
  depth: {
    type: Number,
    default: 0,
    min: 0,
    max: 10 // Limit nesting depth
  },
  isDeleted: {
    type: Boolean,
    default: false
  },
  deletedAt: Date,
  deletedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  },
  isLocked: {
    type: Boolean,
    default: false
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  editedAt: Date,
  editHistory: [{
    type: Schema.Types.ObjectId,
    ref: 'EditHistory'
  }]
}, {
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Middleware to update timestamps and vote score
CommentSchema.pre('save', function(next) {
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
CommentSchema.pre('find', function() {
  // Don't filter deleted comments by default, as we want to show
  // "[deleted]" placeholders in comment threads
  if (this._conditions.filterDeleted) {
    this.where({ isDeleted: false });
    delete this._conditions.filterDeleted;
  }
});

// Virtual for replies
CommentSchema.virtual('replies', {
  ref: 'Comment',
  localField: '_id',
  foreignField: 'parent',
  justOne: false
});

// Virtual for votes
CommentSchema.virtual('votes', {
  ref: 'Vote',
  localField: '_id',
  foreignField: 'comment',
  justOne: false
});

// Indexes for faster queries
CommentSchema.index({ post: 1, createdAt: 1 });
CommentSchema.index({ author: 1 });
CommentSchema.index({ parent: 1 });
CommentSchema.index({ voteScore: -1 });
CommentSchema.index({ content: 'text' });

module.exports = mongoose.model('Comment', CommentSchema);
