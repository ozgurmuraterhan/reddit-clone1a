const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const ChatMessageSchema = new Schema({
  room: {
    type: Schema.Types.ObjectId,
    ref: 'ChatRoom',
    required: true
  },
  sender: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  content: {
    type: String,
    required: [true, 'Message content is required'],
    trim: true,
    maxlength: [10000, 'Message content cannot exceed 10000 characters']
  },
  attachments: [{
    type: {
      type: String,
      enum: ['image', 'video', 'file', 'link'],
      required: true
    },
    url: {
      type: String,
      required: true
    },
    name: String,
    size: Number,
    mimeType: String,
    thumbnailUrl: String
  }],
  readBy: [{
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User'
    },
    readAt: {
      type: Date,
      default: Date.now
    }
  }],
  replyTo: {
    type: Schema.Types.ObjectId,
    ref: 'ChatMessage'
  },
  isDeleted: {
    type: Boolean,
    default: false
  },
  deletedAt: Date,
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
ChatMessageSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Middleware to handle soft delete
ChatMessageSchema.pre('find', function() {
  if (!this._conditions.includeDeleted) {
    this.where({ isDeleted: false });
  }
  if (this._conditions.includeDeleted) {
    delete this._conditions.includeDeleted;
  }
});

ChatMessageSchema.pre('findOne', function() {
  if (!this._conditions.includeDeleted) {
    this.where({ isDeleted: false });
  }
  if (this._conditions.includeDeleted) {
    delete this._conditions.includeDeleted;
  }
});

// Indexes for faster queries
ChatMessageSchema.index({ room: 1, createdAt: 1 });
ChatMessageSchema.index({ sender: 1 });
ChatMessageSchema.index({ 'readBy.user': 1 });
ChatMessageSchema.index({ replyTo: 1 });

module.exports = mongoose.model('ChatMessage', ChatMessageSchema);
