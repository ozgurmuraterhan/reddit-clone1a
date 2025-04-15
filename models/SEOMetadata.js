const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const SEOMetadataSchema = new Schema({
  targetType: {
    type: String,
    enum: ['post', 'subreddit'],
    required: true
  },
  post: {
    type: Schema.Types.ObjectId,
    ref: 'Post'
  },
  subreddit: {
    type: Schema.Types.ObjectId,
    ref: 'Subreddit'
  },
  title: {
    type: String,
    maxlength: [70, 'SEO title cannot exceed 70 characters']
  },
  description: {
    type: String,
    maxlength: [160, 'SEO description cannot exceed 160 characters']
  },
  keywords: [String],
  ogImage: {
    type: String
  },
  ogTitle: {
    type: String,
    maxlength: [70, 'OG title cannot exceed 70 characters']
  },
  ogDescription: {
    type: String,
    maxlength: [200, 'OG description cannot exceed 200 characters']
  },
  twitterCard: {
    type: String,
    enum: ['summary', 'summary_large_image', 'app', 'player'],
    default: 'summary_large_image'
  },
  canonicalUrl: {
    type: String
  },
  robots: {
    type: String,
    default: 'index, follow'
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
  toObject: { virtuals: true }
});

// Validation to ensure the correct reference field is provided based on targetType
SEOMetadataSchema.pre('validate', function(next) {
  const targetTypeFieldMap = {
    'post': 'post',
    'subreddit': 'subreddit'
  };

  const requiredField = targetTypeFieldMap[this.targetType];

  if (!this[requiredField]) {
    return next(new Error(`${requiredField} is required when targetType is ${this.targetType}`));
  }

  // Ensure only the correct field is set
  Object.keys(targetTypeFieldMap).forEach(type => {
    const field = targetTypeFieldMap[type];
    if (field !== requiredField && this[field]) {
      this[field] = undefined;
    }
  });

  next();
});

// Middleware to update timestamps
SEOMetadataSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Compound index for uniqueness
SEOMetadataSchema.index(
  { targetType: 1, post: 1, subreddit: 1 },
  { unique: true, sparse: true }
);

module.exports = mongoose.model('SEOMetadata', SEOMetadataSchema);
