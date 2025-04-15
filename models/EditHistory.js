const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const EditHistorySchema = new Schema({
  contentType: {
    type: String,
    enum: ['post', 'comment'],
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
  previousContent: {
    type: String,
    required: true
  },
  editedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  reason: {
    type: String,
    maxlength: [200, 'Edit reason cannot exceed 200 characters']
  },
  isModerationEdit: {
    type: Boolean,
    default: false
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, {
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Validation to ensure either post or comment is provided, but not both
EditHistorySchema.pre('validate', function(next) {
  if ((this.post && this.comment) || (!this.post && !this.comment)) {
    next(new Error('An edit history must be associated with either a post or a comment, but not both'));
  }
  next();
});

// Indexes for faster queries
EditHistorySchema.index({ post: 1, createdAt: -1 });
EditHistorySchema.index({ comment: 1, createdAt: -1 });
EditHistorySchema.index({ editedBy: 1 });

module.exports = mongoose.model('EditHistory', EditHistorySchema);
