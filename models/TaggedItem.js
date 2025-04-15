const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const TaggedItemSchema = new Schema({
  tag: {
    type: Schema.Types.ObjectId,
    ref: 'Tag',
    required: true
  },
  itemType: {
    type: String,
    enum: ['post', 'comment', 'subreddit', 'user'],
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
  subreddit: {
    type: Schema.Types.ObjectId,
    ref: 'Subreddit'
  },
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  },
  addedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, {
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Validation to ensure the correct reference field is provided based on itemType
TaggedItemSchema.pre('validate', function(next) {
  const itemTypeFieldMap = {
    'post': 'post',
    'comment': 'comment',
    'subreddit': 'subreddit',
    'user': 'user'
  };

  const requiredField = itemTypeFieldMap[this.itemType];

  if (!this[requiredField]) {
    return next(new Error(`${requiredField} is required when itemType is ${this.itemType}`));
  }

  // Ensure only the correct field is set
  Object.keys(itemTypeFieldMap).forEach(type => {
    const field = itemTypeFieldMap[type];
    if (field !== requiredField && this[field]) {
      this[field] = undefined;
    }
  });

  next();
});

// Compound index for uniqueness
TaggedItemSchema.index(
  { tag: 1, itemType: 1, post: 1, comment: 1, subreddit: 1, user: 1 },
  { unique: true, sparse: true }
);

module.exports = mongoose.model('TaggedItem', TaggedItemSchema);
