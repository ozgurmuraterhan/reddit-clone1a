const mongoose = require('mongoose');
const asyncHandler = require('../middleware/async');
const ErrorResponse = require('../utils/errorResponse');
const Vote = require('../models/Vote');
const Post = require('../models/Post');
const Comment = require('../models/Comment');
const User = require('../models/User');
const Notification = require('../models/Notification');
const SubredditMembership = require('../models/SubredditMembership');
const Subreddit = require('../models/Subreddit');

/**
 * @desc    Oy kullan (upvote veya downvote)
 * @route   POST /api/posts/:postId/vote veya /api/comments/:commentId/vote
 * @access  Private
 */
const castVote = asyncHandler(async (req, res, next) => {
  const { postId, commentId } = req.params;
  const { value } = req.body;
  const userId = req.user._id;

  // Oy değeri kontrolü
  if (value !== 1 && value !== -1 && value !== 0) {
    return next(new ErrorResponse('Oy değeri 1, -1 veya 0 olmalıdır', 400));
  }

  // Oy verilecek öğe tipini belirle
  let voteTarget = {};
  let targetModel;
  let targetItem;

  if (postId) {
    voteTarget.post = postId;
    targetModel = Post;

    // Post'un var olup olmadığını kontrol et
    if (!mongoose.Types.ObjectId.isValid(postId)) {
      return next(new ErrorResponse('Geçersiz post ID formatı', 400));
    }

    targetItem = await Post.findById(postId);
    if (!targetItem) {
      return next(new ErrorResponse('Post bulunamadı', 404));
    }

    // Post'un olduğu subreddit'i kontrol et
    const subreddit = await Subreddit.findById(targetItem.subreddit);
    if (!subreddit) {
      return next(new ErrorResponse('Subreddit bulunamadı', 404));
    }

    // Subreddit özel ise, kullanıcının üye olup olmadığını kontrol et
    if (subreddit.type === 'private') {
      const membership = await SubredditMembership.findOne({
        user: userId,
        subreddit: subreddit._id,
        type: 'member'  // SubredditM
