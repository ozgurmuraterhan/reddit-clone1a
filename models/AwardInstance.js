const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const AwardInstanceSchema = new Schema({
  award: {
    type: Schema.Types.ObjectId,
    ref: 'Award',
    required: true
  },
  giver: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  recipient: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  },
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
  message: {
    type: String,
    maxlength: [500, 'Award message cannot exceed 500 characters']
  },
  isAnonymous: {
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

// Validation to ensure the correct reference field is provided based on contentType
AwardInstanceSchema.pre('validate', function(next) {
  const contentTypeFieldMap = {
    'post': 'post',
    'comment': 'comment'
  };

  const requiredField = contentTypeFieldMap[this.contentType];

  if (!this[requiredField]) {
    return next(new Error(`${requiredField} is required when contentType is ${this.contentType}`));
  }

  // Ensure only the correct field is set
  Object.keys(contentTypeFieldMap).forEach(type => {
    const field = contentTypeFieldMap[type];
    if (field !== requiredField && this[field]) {
      this[field] = undefined;
    }
  });

  next();
});

// Indexes for faster queries
AwardInstanceSchema.index({ award: 1 });
AwardInstanceSchema.index({ giver: 1 });
AwardInstanceSchema.index({ recipient: 1 });
AwardInstanceSchema.index({ post: 1 });
AwardInstanceSchema.index({ comment: 1 });
AwardInstanceSchema.index({ createdAt: -1 });

module.exports = mongoose.model('AwardInstance', AwardInstanceSchema);
