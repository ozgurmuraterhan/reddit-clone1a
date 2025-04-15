const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const SubredditSettingsSchema = new Schema({
  subreddit: {
    type: Schema.Types.ObjectId,
    ref: 'Subreddit',
    required: true,
    unique: true
  },
  // Content settings
  allowPostTypes: {
    text: { type: Boolean, default: true },
    link: { type: Boolean, default: true },
    image: { type: Boolean, default: true },
    video: { type: Boolean, default: true },
    poll: { type: Boolean, default: true }
  },
  requirePostFlair: {
    type: Boolean,
    default: false
  },
  allowUserFlair: {
    type: Boolean,
    default: true
  },
  // Moderation settings
  spamFilter: {
    posts: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
    comments: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' }
  },
  contentOptions: {
    allowSpoilers: { type: Boolean, default: true },
    allowImageUploads: { type: Boolean, default: true },
    allowMultipleImages: { type: Boolean, default: true },
    allowPolls: { type: Boolean, default: true },
    allowCrossposting: { type: Boolean, default: true },
    allowArchiving: { type: Boolean, default: true }
  },
  // Community settings
  communityOptions: {
    allowDownvotes: { type: Boolean, default: true },
    showPostKarma: { type: Boolean, default: true },
    showCommentKarma: { type: Boolean, default: true },
    restrictPostingToMods: { type: Boolean, default: false },
    approvePostsManually: { type: Boolean, default: false },
    suggestedSortOption: {
      type: String,
      enum: ['best', 'top', 'new', 'controversial', 'old', 'qa'],
      default: 'best'
    }
  },
  // Appearance settings
  appearance: {
    primaryColor: { type: String, default: '#0079D3' },
    bannerColor: { type: String, default: '#33a8ff' },
    bannerHeight: {
      type: String,
      enum: ['small', 'medium', 'large'],
      default: 'medium'
    },
    showSubredditIcon: { type: Boolean, default: true },
    allowCustomTheme: { type: Boolean, default: false },
    customCSS: { type: String, default: '' }
  },
  // Automod settings
  automod: {
    enabled: { type: Boolean, default: false },
    config: { type: String, default: '' }
  },
  // Update tracking
  updatedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User'
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

// Middleware to update timestamps
SubredditSettingsSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('SubredditSettings', SubredditSettingsSchema);
