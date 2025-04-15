const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const ChatRoomSchema = new Schema({
  type: {
    type: String,
    enum: ['direct', 'group'],
    required: true
  },
  name: {
    type: String,
    trim: true,
    maxlength: [100, 'Chat room name cannot exceed 100 characters'],
    validate: {
      validator: function(v) {
        return this.type !== 'group' || (this.type === 'group' && v);
      },
      message: 'Name is required for group chats'
    }
  },
  participants: [{
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    joinedAt: {
      type: Date,
      default: Date.now
    },
    isAdmin: {
      type: Boolean,
      default: false
    },
    lastSeen: Date,
    muted: {
      type: Boolean,
      default: false
    }
  }],
  creator: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  },
  icon: {
    type: String,
    default: 'default-chat-icon.png'
  },
  lastMessage: {
    type: Schema.Types.ObjectId,
    ref: 'ChatMessage'
  },
  lastActivity: {
    type: Date,
    default: Date.now
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
ChatRoomSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Validation for direct chats (must have exactly 2 participants)
ChatRoomSchema.pre('validate', function(next) {
  if (this.type === 'direct' && this.participants.length !== 2) {
    return next(new Error('Direct chat rooms must have exactly 2 participants'));
  }

  if (this.type === 'group' && !this.creator) {
    return next(new Error('Group chat rooms must have a creator'));
  }

  next();
});

// Virtual for messages
ChatRoomSchema.virtual('messages', {
  ref: 'ChatMessage',
  localField: '_id',
  foreignField: 'room',
  justOne: false
});

// Indexes for faster queries
ChatRoomSchema.index({ 'participants.user': 1 });
ChatRoomSchema.index({ type: 1 });
ChatRoomSchema.index({ lastActivity: -1 });

// Compound index for direct chats to prevent duplicates
ChatRoomSchema.index(
  { type: 1, 'participants.user': 1 },
  { unique: true, sparse: true, partialFilterExpression: { type: 'direct' } }
);

module.exports = mongoose.model('ChatRoom', ChatRoomSchema);
