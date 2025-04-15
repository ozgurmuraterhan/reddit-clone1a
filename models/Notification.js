const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const NotificationSchema = new Schema({
  recipient: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  sender: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  },
  type: {
    type: String,
    enum: [
      'post_reply',
      'comment_reply',
      'mention',
      'post_upvote',
      'comment_upvote',
      'award',
      'mod_action',
      'subreddit_ban',
      'subreddit_invite',
      'message',
      'system'
    ],
    required: true
  },
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: [100, 'Title cannot exceed 100 characters']
  },
  content: {
    type: String,
    trim: true,
    maxlength: [500, 'Content cannot exceed 500 characters']
  },
  read: {
    type: Boolean,
    default: false
  },
  readAt: Date,
  relatedPost: {
    type: Schema.Types.ObjectId,
    ref: 'Post'
  },
  relatedComment: {
    type: Schema.Types.ObjectId,
    ref: 'Comment'
  },
  relatedSubreddit: {
    type: Schema.Types.ObjectId,
    ref: 'Subreddit'
  },
  relatedMessage: {
    type: Schema.Types.ObjectId,
    ref: 'ChatMessage'
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, {
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Middleware to update readAt when read is set to true
NotificationSchema.pre('save', function(next) {
  if (this.isModified('read') && this.read && !this.readAt) {
    this.readAt = Date.now();
  }
  next();
});

// Indexes for faster queries
NotificationSchema.index({ recipient: 1, read: 1, createdAt: -1 });
NotificationSchema.index({ recipient: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', NotificationSchema);
