const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const ModLogSchema = new Schema({
  subreddit: {
    type: Schema.Types.ObjectId,
    ref: 'Subreddit',
    required: true
  },
  moderator: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  action: {
    type: String,
    enum: [
      'post_remove', 'post_approve', 'post_lock', 'post_unlock', 'post_sticky', 'post_unsticky',
      'comment_remove', 'comment_approve', 'comment_lock', 'comment_unlock',
      'ban_user', 'unban_user', 'mute_user', 'unmute_user',
      'add_moderator', 'remove_moderator', 'edit_settings', 'edit_rules',
      'add_flair', 'edit_flair', 'remove_flair', 'assign_flair',
      'edit_wiki', 'lock_wiki', 'unlock_wiki',
      'other'
    ],
    required: true
  },
  targetType: {
    type: String,
    enum: ['post', 'comment', 'user', 'subreddit', 'wiki', 'flair', 'other'],
    required: true
  },
  targetPost: {
    type: Schema.Types.ObjectId,
    ref: 'Post'
  },
  targetComment: {
    type: Schema.Types.ObjectId,
    ref: 'Comment'
  },
  targetUser: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  },
  details: {
    type: String,
    maxlength: [500, 'Details cannot exceed 500 characters']
  },
  reason: {
    type: String,
    maxlength: [500, 'Reason cannot exceed 500 characters']
  },
  note: {
    type: String,
    maxlength: [500, 'Note cannot exceed 500 characters']
  },
  isPublic: {
    type: Boolean,
    default: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, {
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Validation to ensure the correct target field is provided based on targetType
ModLogSchema.pre('validate', function(next) {
  const targetTypeFieldMap = {
    'post': 'targetPost',
    'comment': 'targetComment',
    'user': 'targetUser'
  };

  const requiredField = targetTypeFieldMap[this.targetType];

  if (requiredField && !this[requiredField]) {
    return next(new Error(`${requiredField} is required when targetType is ${this.targetType}`));
  }

  next();
});

// Indexes for faster queries
ModLogSchema.index({ subreddit: 1, createdAt: -1 });
ModLogSchema.index({ moderator: 1 });
ModLogSchema.index({ action: 1 });
ModLogSchema.index({ targetType: 1 });
ModLogSchema.index({ targetPost: 1 });
ModLogSchema.index({ targetComment: 1 });
ModLogSchema.index({ targetUser: 1 });
ModLogSchema.index({ isPublic: 1 });

module.exports = mongoose.model('ModLog', ModLogSchema);
