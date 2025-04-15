const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const UserSettingsSchema = new Schema({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  // Content preferences
  contentPreferences: {
    adultContent: {
      type: Boolean,
      default: false
    },
    autoplayMedia: {
      type: Boolean,
      default: true
    },
    showNSFWContent: {
      type: Boolean,
      default: false
    },
    blurNSFWImages: {
      type: Boolean,
      default: true
    },
    showSpoilers: {
      type: Boolean,
      default: true
    },
    highlightNewComments: {
      type: Boolean,
      default: true
    },
    defaultCommentSort: {
      type: String,
      enum: ['best', 'top', 'new', 'controversial', 'old', 'qa'],
      default: 'best'
    },
    defaultPostSort: {
      type: String,
      enum: ['hot', 'new', 'top', 'rising', 'controversial'],
      default: 'hot'
    }
  },
  // Feed settings
  feedSettings: {
    showVotedPosts: {
      type: Boolean,
      default: true
    },
    showPostsFromSubreddits: {
      type: Boolean,
      default: true
    },
    contentFilters: {
      hideByKeyword: [String],
      hideSubreddits: [{
        type: Schema.Types.ObjectId,
        ref: 'Subreddit'
      }]
    }
  },
  // Privacy settings
  privacySettings: {
    profileVisibility: {
      type: String,
      enum: ['public', 'private'],
      default: 'public'
    },
    showActiveInCommunities: {
      type: Boolean,
      default: true
    },
    allowDirectMessages: {
      type: Boolean,
      default: true
    },
    allowMentions: {
      type: Boolean,
      default: true
    },
    allowFollowers: {
      type: Boolean,
      default: true
    }
  },
  // Email notification settings
  emailNotifications: {
    newMessages: {
      type: Boolean,
      default: true
    },
    newCommentReplies: {
      type: Boolean,
      default: true
    },
    newPostReplies: {
      type: Boolean,
      default: true
    },
    mentions: {
      type: Boolean,
      default: true
    },
    upvotesOnPosts: {
      type: Boolean,
      default: false
    },
    upvotesOnComments: {
      type: Boolean,
      default: false
    },
    newsletterAndUpdates: {
      type: Boolean,
      default: false
    }
  },
  // Push notification settings
  pushNotifications: {
    enabled: {
      type: Boolean,
      default: true
    },
    newMessages: {
      type: Boolean,
      default: true
    },
    newCommentReplies: {
      type: Boolean,
      default: true
    },
    newPostReplies: {
      type: Boolean,
      default: true
    },
    mentions: {
      type: Boolean,
      default: true
    },
    upvotesOnPosts: {
      type: Boolean,
      default: false
    },
    upvotesOnComments: {
      type: Boolean,
      default: false
    }
  },
  // Chat settings
  chatSettings: {
    allowChatRequests: {
      type: Boolean,
      default: true
    },
    showOnlineStatus: {
      type: Boolean,
      default: true
    },
    readReceipts: {
      type: Boolean,
      default: true
    }
  },
  // Display settings
  displaySettings: {
    theme: {
      type: String,
      enum: ['light', 'dark', 'auto'],
      default: 'auto'
    },
    compactView: {
      type: Boolean,
      default: false
    },
    language: {
      type: String,
      default: 'en'
    },
    timezone: {
      type: String,
      default: 'UTC'
    }
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
UserSettingsSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('UserSettings', UserSettingsSchema);
