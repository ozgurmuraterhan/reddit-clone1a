const mongoose = require('mongoose');
const { Vote, Post, Comment, User, Notification } = require('../models');
const asyncHandler = require('../middleware/async');
const ErrorResponse = require('../utils/errorResponse');
const { checkUserPermissions } = require('../utils/validators');
const { getLimitSettingsForAction } = require('./rateLimitController');

/**
 * @desc    Gönderi veya yorum için oy kullan
 * @route   POST /api/votes
 * @access  Private
 */
const createVote = asyncHandler(async (req, res, next) => {
  const { postId, commentId, value } = req.body;
  const userId = req.user._id;

  // Hem post hem comment veya hiçbiri belirtilmemişse hata döndür
  if ((postId && commentId) || (!postId && !commentId)) {
    return next(
      new ErrorResponse("Bir gönderi veya yorum ID'si belirtilmelidir, ikisi birden değil", 400),
    );
  }

  // Oy değeri kontrolü
  if (![1, 0, -1].includes(Number(value))) {
    return next(new ErrorResponse('Geçersiz oy değeri, -1, 0 veya 1 olmalıdır', 400));
  }

  // Oy verilen içeriğin varlığını kontrol et
  let targetType, targetId, target, targetAuthorId;
  if (postId) {
    targetType = 'post';
    targetId = postId;

    if (!mongoose.Types.ObjectId.isValid(postId)) {
      return next(new ErrorResponse('Geçersiz gönderi ID formatı', 400));
    }

    const post = await Post.findById(postId);
    if (!post) {
      return next(new ErrorResponse('Gönderi bulunamadı', 404));
    }

    if (post.isLocked) {
      return next(new ErrorResponse('Bu gönderi kilitlenmiş, oy verilemez', 403));
    }

    target = post;
    targetAuthorId = post.author;
  } else {
    targetType = 'comment';
    targetId = commentId;

    if (!mongoose.Types.ObjectId.isValid(commentId)) {
      return next(new ErrorResponse('Geçersiz yorum ID formatı', 400));
    }

    const comment = await Comment.findById(commentId).populate({
      path: 'post',
      select: 'isLocked',
    });

    if (!comment) {
      return next(new ErrorResponse('Yorum bulunamadı', 404));
    }

    if (comment.post && comment.post.isLocked) {
      return next(new ErrorResponse('Bu gönderinin yorumları kilitlenmiş, oy verilemez', 403));
    }

    target = comment;
    targetAuthorId = comment.author;
  }

  // Kullanıcının kendine oy vermesini engelle
  if (targetAuthorId.toString() === userId.toString()) {
    return next(new ErrorResponse('Kendi içeriğinize oy veremezsiniz', 400));
  }

  // Mevcut oyu kontrol et
  let vote = await Vote.findOne({
    user: userId,
    [targetType]: targetId,
  });

  const previousValue = vote ? vote.value : 0;

  if (vote) {
    // Zaten oy verilmişse, güncelle
    vote.value = value;
    vote.updatedAt = Date.now();
  } else {
    // Yeni oy oluştur
    vote = new Vote({
      user: userId,
      [targetType]: targetId,
      value,
    });
  }

  await vote.save();

  // Hedef içeriğin oy sayısını güncelle
  if (targetType === 'post') {
    await updatePostVoteCount(targetId);
  } else {
    await updateCommentVoteCount(targetId);
  }

  // Oy değişimi önemli ise bildirim gönder (0'a dönüşler hariç yeni oylar ve değer değişimleri)
  if (value !== 0 && value !== previousValue && targetAuthorId.toString() !== userId.toString()) {
    await createVoteNotification(userId, targetAuthorId, targetType, targetId, value);
  }

  res.status(200).json({
    success: true,
    data: vote,
  });
});

/**
 * @desc    Kullanıcının oylarını getir
 * @route   GET /api/votes/user
 * @access  Private
 */
const getUserVotes = asyncHandler(async (req, res, next) => {
  const userId = req.user._id;
  const { postIds, commentIds } = req.query;

  let filter = { user: userId };

  // Belirli gönderiler için oyları getir
  if (postIds) {
    const ids = postIds.split(',').filter((id) => mongoose.Types.ObjectId.isValid(id));
    if (ids.length > 0) {
      filter.post = { $in: ids };
    }
  }

  // Belirli yorumlar için oyları getir
  if (commentIds) {
    const ids = commentIds.split(',').filter((id) => mongoose.Types.ObjectId.isValid(id));
    if (ids.length > 0) {
      filter.comment = { $in: ids };
    }
  }

  const votes = await Vote.find(filter);

  res.status(200).json({
    success: true,
    count: votes.length,
    data: votes,
  });
});

/**
 * @desc    Gönderi oylarını getir
 * @route   GET /api/votes/post/:postId
 * @access  Public
 */
const getPostVotes = asyncHandler(async (req, res, next) => {
  const { postId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(postId)) {
    return next(new ErrorResponse('Geçersiz gönderi ID formatı', 400));
  }

  const post = await Post.findById(postId);
  if (!post) {
    return next(new ErrorResponse('Gönderi bulunamadı', 404));
  }

  const votes = await Vote.find({ post: postId }).populate('user', 'username profilePicture');

  res.status(200).json({
    success: true,
    count: votes.length,
    data: votes,
  });
});

/**
 * @desc    Yorum oylarını getir
 * @route   GET /api/votes/comment/:commentId
 * @access  Public
 */
const getCommentVotes = asyncHandler(async (req, res, next) => {
  const { commentId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(commentId)) {
    return next(new ErrorResponse('Geçersiz yorum ID formatı', 400));
  }

  const comment = await Comment.findById(commentId);
  if (!comment) {
    return next(new ErrorResponse('Yorum bulunamadı', 404));
  }

  const votes = await Vote.find({ comment: commentId }).populate('user', 'username profilePicture');

  res.status(200).json({
    success: true,
    count: votes.length,
    data: votes,
  });
});

/**
 * @desc    Oyu sil
 * @route   DELETE /api/votes/:id
 * @access  Private
 */
const deleteVote = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user._id;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorResponse('Geçersiz oy ID formatı', 400));
  }

  const vote = await Vote.findById(id);

  if (!vote) {
    return next(new ErrorResponse('Oy bulunamadı', 404));
  }

  // Kullanıcının kendi oyunu silmesi kontrolü
  if (vote.user.toString() !== userId.toString() && req.user.role !== 'admin') {
    return next(new ErrorResponse('Bu işlem için yetkiniz yok', 403));
  }

  // Hedef içeriğin referansını al
  const targetType = vote.post ? 'post' : 'comment';
  const targetId = vote.post || vote.comment;

  await vote.remove();

  // Hedef içeriğin oy sayısını güncelle
  if (targetType === 'post') {
    await updatePostVoteCount(targetId);
  } else {
    await updateCommentVoteCount(targetId);
  }

  res.status(200).json({
    success: true,
    data: {},
  });
});

/**
 * Gönderi oy sayısını güncelleme yardımcı fonksiyonu
 */
const updatePostVoteCount = async (postId) => {
  const upvotes = await Vote.countDocuments({ post: postId, value: 1 });
  const downvotes = await Vote.countDocuments({ post: postId, value: -1 });
  const voteScore = upvotes - downvotes;

  await Post.findByIdAndUpdate(postId, {
    upvoteCount: upvotes,
    downvoteCount: downvotes,
    voteScore: voteScore,
  });
};

/**
 * Yorum oy sayısını güncelleme yardımcı fonksiyonu
 */
const updateCommentVoteCount = async (commentId) => {
  const upvotes = await Vote.countDocuments({ comment: commentId, value: 1 });
  const downvotes = await Vote.countDocuments({ comment: commentId, value: -1 });
  const voteScore = upvotes - downvotes;

  await Comment.findByIdAndUpdate(commentId, {
    upvoteCount: upvotes,
    downvoteCount: downvotes,
    voteScore: voteScore,
  });
};

/**
 * Oy bildirimini oluşturan yardımcı fonksiyon
 */
const createVoteNotification = async (userId, targetUserId, targetType, targetId, value) => {
  const notificationType = value === 1 ? 'upvote' : 'downvote';

  await Notification.create({
    type: notificationType,
    sender: userId,
    recipient: targetUserId,
    [`related${targetType.charAt(0).toUpperCase() + targetType.slice(1)}`]: targetId,
    message: value === 1 ? 'Gönderinize pozitif oy verdi' : 'Gönderinize negatif oy verdi',
  });
};

module.exports = {
  createVote,
  getUserVotes,
  getPostVotes,
  getCommentVotes,
  deleteVote,
};
