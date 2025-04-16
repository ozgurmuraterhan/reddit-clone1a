const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const MediaAssetSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    type: {
      type: String,
      enum: ['image', 'video', 'gif', 'audio', 'document'],
      required: true,
    },
    originalFilename: {
      type: String,
      required: true,
    },
    filename: {
      type: String,
      required: true,
    },
    mimeType: {
      type: String,
      required: true,
    },
    size: {
      type: Number, // in bytes
      required: true,
    },
    width: Number,
    height: Number,
    duration: Number, // for videos/audio
    cdnUrl: {
      type: String,
      required: true,
    },
    thumbnailUrl: String,
    usageContext: {
      type: String,
      enum: ['post', 'comment', 'subreddit', 'profile', 'message', 'other'],
      required: true,
    },
    postId: {
      type: Schema.Types.ObjectId,
      ref: 'Post',
    },
    commentId: {
      type: Schema.Types.ObjectId,
      ref: 'Comment',
    },
    subredditId: {
      type: Schema.Types.ObjectId,
      ref: 'Subreddit',
    },
    isPublic: {
      type: Boolean,
      default: true,
    },
    metadata: {
      type: Map,
      of: Schema.Types.Mixed,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// Middleware to update timestamps
MediaAssetSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
});

// Indexes for faster queries
MediaAssetSchema.index({ user: 1, createdAt: -1 });
MediaAssetSchema.index({ usageContext: 1 });
MediaAssetSchema.index({ type: 1 });
MediaAssetSchema.index({ filename: 1 }, { unique: true });

module.exports = mongoose.model('MediaAsset', MediaAssetSchema);
