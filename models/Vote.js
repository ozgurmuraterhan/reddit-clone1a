const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const VoteSchema = new Schema({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  post: {
    type: Schema.Types.ObjectId,
    ref: 'Post'
  },
  comment: {
    type: Schema.Types.ObjectId,
    ref: 'Comment'
  },
  value: {
    type: Number,
    enum: [-1, 0, 1], // -1: downvote, 0: no vote, 1: upvote
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now 
  }
}, {
  toJSON: { virtuals: true },
  toObject: { virtuals: true }});

// Middleware to update timestamps
VoteSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Validation to ensure either post or comment is provided, but not both
VoteSchema.pre('validate', function(next) {
  if ((this.post && this.comment) || (!this.post && !this.comment)) {
    next(new Error('A vote must be associated with either a post or a comment, but not both'));
  }
  next();
});

// Compound indexes for uniqueness
VoteSchema.index({ user: 1, post: 1 }, { unique: true, sparse: true });
VoteSchema.index({ user: 1, comment: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('Vote', VoteSchema);
