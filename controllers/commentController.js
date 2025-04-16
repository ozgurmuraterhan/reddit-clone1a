const Comment = require('../models/Comment');
const Post = require('../models/Post');
const User = require('../models/User');
const Vote = require('../models/Vote');
const Notification = require('../models/Notification');
const SavedItem = require('../models/SavedItem');
const ModLog = require('../models/ModLog');
const EditHistory = require('../models/EditHistory');
const mongoose = require('mongoose');
const asyncHandler = require('../middleware/async');
const ErrorResponse = require('../utils/errorResponse');

/**
 * @desc    Yorumu ID'ye göre getir
 * @route   GET /api/comments/:commentId
 * @access  Public
 */
const getCommentById = asyncHandler(async (req, res, next) => {
  const { commentId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(commentId)) {
    return next(new ErrorResponse('Geçersiz yorum ID formatı', 400));
  }

  const comment = await Comment.findById(commentId)
    .populate('author', 'username avatar isDeleted')
    .populate('post', 'title subreddit')
    .populate({
      path: 'post',
      populate: {
        path: 'subreddit',
        select: 'name isPrivate',
      },
    });

  if (!comment) {
    return next(new ErrorResponse('Yorum bulunamadı', 404));
  }

  // Kullanıcı oyunu kontrol et
  let userVote = null;
  let isSaved = false;

  if (req.user) {
    const vote = await Vote.findOne({
      user: req.user._id,
      comment: commentId,
    });

    userVote = vote ? vote.value : null;

    // Kaydedilme durumunu kontrol et
    const savedItem = await SavedItem.findOne({
      user: req.user._id,
      comment: commentId,
    });

    isSaved = !!savedItem;
  }

  // Yanıt verilerini dahil et ve doğru yanıt sayısını al
  const replyCount = await Comment.countDocuments({
    parent: commentId,
    isDeleted: false,
  });

  const commentData = {
    ...comment.toJSON(),
    userVote,
    isSaved,
    replyCount,
  };

  res.status(200).json({
    success: true,
    data: commentData,
  });
});

/**
 * @desc    Yeni yorum oluştur
 * @route   POST /api/comments
 * @access  Private
 */
const createComment = asyncHandler(async (req, res, next) => {
  const { content, postId, parentId } = req.body;
  const userId = req.user._id;

  if (!content || !postId) {
    return next(new ErrorResponse('İçerik ve gönderi ID zorunludur', 400));
  }

  // Post kontrolü
  const post = await Post.findById(postId);
  if (!post) {
    return next(new ErrorResponse('Gönderi bulunamadı', 404));
  }

  // Kilitli gönderiye yorum kontrolü
  if (post.isLocked) {
    return next(new ErrorResponse('Bu gönderi kilitlenmiş, yorum yapamazsınız', 403));
  }

  // Parent comment kontrolü ve derinlik hesaplaması
  let depth = 0;
  let parentComment = null;

  if (parentId) {
    if (!mongoose.Types.ObjectId.isValid(parentId)) {
      return next(new ErrorResponse('Geçersiz üst yorum ID formatı', 400));
    }

    parentComment = await Comment.findById(parentId);
    if (!parentComment) {
      return next(new ErrorResponse('Üst yorum bulunamadı', 404));
    }

    // Üst yorumun kilitli olup olmadığını kontrol et
    if (parentComment.isLocked) {
      return next(new ErrorResponse('Bu yorum kilitlenmiş, yanıt veremezsiniz', 403));
    }

    depth = parentComment.depth + 1;

    // Maksimum derinlik kontrolü
    if (depth > 10) {
      return next(new ErrorResponse('Maksimum yorum derinliği aşıldı (10)', 400));
    }
  }

  // Yeni yorum oluştur
  const comment = await Comment.create({
    content,
    author: userId,
    post: postId,
    parent: parentId || null,
    depth,
  });

  // Yanıt sayısını güncelle
  if (parentId) {
    await Comment.findByIdAndUpdate(parentId, {
      $inc: { replyCount: 1 },
    });
  }

  // Post yorum sayısını güncelle
  await Post.findByIdAndUpdate(postId, {
    $inc: { commentCount: 1 },
  });

  // Bildirim gönder (kendi yorumuna yanıt vermiyorsa)
  if (parentComment && !parentComment.author.equals(userId)) {
    await Notification.create({
      recipient: parentComment.author,
      sender: userId,
      type: 'comment_reply',
      comment: comment._id,
      post: postId,
    });
  } else if (!parentComment && !post.author.equals(userId)) {
    // Post'a yorum yapılmışsa ve kendi postu değilse bildirim oluştur
    await Notification.create({
      recipient: post.author,
      sender: userId,
      type: 'post_comment',
      comment: comment._id,
      post: postId,
    });
  }

  // Yanıt için verilen yorumu popüle et
  const populatedComment = await Comment.findById(comment._id)
    .populate('author', 'username avatar')
    .populate('post', 'title');

  res.status(201).json({
    success: true,
    data: populatedComment,
  });
});

/**
 * @desc    Yorumu güncelle
 * @route   PUT /api/comments/:commentId
 * @access  Private (yorum sahibi)
 */
const updateComment = asyncHandler(async (req, res, next) => {
  const { commentId } = req.params;
  const { content } = req.body;
  const userId = req.user._id;

  if (!content) {
    return next(new ErrorResponse('İçerik zorunludur', 400));
  }

  const comment = await Comment.findById(commentId);

  if (!comment) {
    return next(new ErrorResponse('Yorum bulunamadı', 404));
  }

  // Silinen yorumlar düzenlenemez
  if (comment.isDeleted) {
    return next(new ErrorResponse('Silinmiş yorumlar düzenlenemez', 400));
  }

  // Yorum sahibi kontrolü (middleware yapıyor olsa da, güvenlik için tekrar kontrol)
  if (!comment.author.equals(userId) && req.user.role !== 'admin') {
    return next(new ErrorResponse('Bu işlem için yetkiniz bulunmamaktadır', 403));
  }

  // Orijinal içeriği kaydet
  const originalContent = comment.content;

  // Düzenleme geçmişi oluştur
  const editHistory = await EditHistory.create({
    contentType: 'comment',
    contentId: commentId,
    oldContent: originalContent,
    newContent: content,
    editedBy: userId,
    editedAt: new Date(),
  });

  // Yorumu güncelle
  comment.content = content;
  comment.editedAt = Date.now();
  comment.editHistory.push(editHistory._id);
  await comment.save();

  res.status(200).json({
    success: true,
    data: comment,
  });
});

/**
 * @desc    Yorumu sil (soft delete)
 * @route   DELETE /api/comments/:commentId
 * @access  Private (yorum sahibi)
 */
const deleteComment = asyncHandler(async (req, res, next) => {
  const { commentId } = req.params;
  const userId = req.user._id;

  const comment = await Comment.findById(commentId);

  if (!comment) {
    return next(new ErrorResponse('Yorum bulunamadı', 404));
  }

  if (comment.isDeleted) {
    return next(new ErrorResponse('Bu yorum zaten silinmiş', 400));
  }

  // Yorum sahibi kontrolü (middleware yapıyor olsa da, güvenlik için tekrar kontrol)
  if (!comment.author.equals(userId) && req.user.role !== 'admin') {
    return next(new ErrorResponse('Bu işlem için yetkiniz bulunmamaktadır', 403));
  }

  // Yorumu soft delete yap
  comment.isDeleted = true;
  comment.deletedAt = Date.now();
  comment.deletedBy = userId;
  await comment.save();

  res.status(200).json({
    success: true,
    data: { message: 'Yorum başarıyla silindi' },
  });
});

/**
 * @desc    Yoruma yanıt ver
 * @route   POST /api/comments/:commentId/replies
 * @access  Private
 */
const replyToComment = asyncHandler(async (req, res, next) => {
  const { commentId } = req.params;
  const { content } = req.body;
  const userId = req.user._id;

  if (!content) {
    return next(new ErrorResponse('İçerik zorunludur', 400));
  }

  const parentComment = await Comment.findById(commentId);

  if (!parentComment) {
    return next(new ErrorResponse('Yorum bulunamadı', 404));
  }

  if (parentComment.isDeleted) {
    return next(new ErrorResponse('Silinmiş yorumlara yanıt verilemez', 400));
  }

  if (parentComment.isLocked) {
    return next(new ErrorResponse('Bu yorum kilitlenmiş, yanıt veremezsiniz', 403));
  }

  // Derinlik kontrolü
  const depth = parentComment.depth + 1;
  if (depth > 10) {
    return next(new ErrorResponse('Maksimum yorum derinliği aşıldı (10)', 400));
  }

  // Post'un kilitli olup olmadığını kontrol et
  const post = await Post.findById(parentComment.post);
  if (post.isLocked) {
    return next(new ErrorResponse('Bu gönderi kilitlenmiş, yorum yapamazsınız', 403));
  }

  // Yanıt oluştur
  const reply = await Comment.create({
    content,
    author: userId,
    post: parentComment.post,
    parent: commentId,
    depth,
  });

  // Yanıt sayısını güncelle
  await Comment.findByIdAndUpdate(commentId, {
    $inc: { replyCount: 1 },
  });

  // Post yorum sayısını güncelle
  await Post.findByIdAndUpdate(parentComment.post, {
    $inc: { commentCount: 1 },
  });

  // Bildirim oluştur (kendi yorumuna yanıt vermiyorsa)
  if (!parentComment.author.equals(userId)) {
    await Notification.create({
      recipient: parentComment.author,
      sender: userId,
      type: 'comment_reply',
      comment: reply._id,
      post: parentComment.post,
    });
  }

  // Yanıt için verilen yorumu popüle et
  const populatedReply = await Comment.findById(reply._id)
    .populate('author', 'username avatar')
    .populate('post', 'title');

  res.status(201).json({
    success: true,
    data: populatedReply,
  });
});

/**
 * @desc    Yorum yanıtlarını getir
 * @route   GET /api/comments/:commentId/replies
 * @access  Public
 */
const getCommentReplies = asyncHandler(async (req, res, next) => {
  const { commentId } = req.params;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const sortBy = req.query.sort || 'best'; // 'best', 'new', 'old', 'controversial'
  const skip = (page - 1) * limit;

  if (!mongoose.Types.ObjectId.isValid(commentId)) {
    return next(new ErrorResponse('Geçersiz yorum ID formatı', 400));
  }

  const comment = await Comment.findById(commentId);
  if (!comment) {
    return next(new ErrorResponse('Yorum bulunamadı', 404));
  }

  let sortOption = {};
  switch (sortBy) {
    case 'new':
      sortOption = { createdAt: -1 };
      break;
    case 'old':
      sortOption = { createdAt: 1 };
      break;
    case 'controversial':
      sortOption = { voteScore: 1, upvotes: -1 };
      break;
    case 'best':
    default:
      sortOption = { voteScore: -1, createdAt: -1 };
  }

  const replies = await Comment.find({
    parent: commentId,
  })
    .sort(sortOption)
    .skip(skip)
    .limit(limit)
    .populate('author', 'username avatar isDeleted')
    .populate('post', 'title');

  // Kullanıcı oylarını ekle
  const repliesWithUserData = await Promise.all(
    replies.map(async (reply) => {
      let userVote = null;
      let isSaved = false;

      if (req.user) {
        const vote = await Vote.findOne({
          user: req.user._id,
          comment: reply._id,
        });

        userVote = vote ? vote.value : null;

        // Kaydedilme durumunu kontrol et
        const savedItem = await SavedItem.findOne({
          user: req.user._id,
          comment: reply._id,
        });

        isSaved = !!savedItem;
      }

      const replyData = reply.toJSON();
      replyData.userVote = userVote;
      replyData.isSaved = isSaved;

      return replyData;
    }),
  );

  // Toplam yanıt sayısını getir
  const totalReplies = await Comment.countDocuments({
    parent: commentId,
  });

  res.status(200).json({
    success: true,
    data: repliesWithUserData,
    pagination: {
      page,
      limit,
      totalPages: Math.ceil(totalReplies / limit),
      totalItems: totalReplies,
    },
  });
});

/**
 * @desc    Yorumu oyla
 * @route   POST /api/comments/:commentId/vote
 * @access  Private
 */
const voteComment = asyncHandler(async (req, res, next) => {
  const { commentId } = req.params;
  const { value } = req.body; // 1 veya -1
  const userId = req.user._id;

  if (value !== 1 && value !== -1 && value !== 0) {
    return next(new ErrorResponse('Geçersiz oy değeri. 1, -1 veya 0 olmalıdır', 400));
  }

  const comment = await Comment.findById(commentId);
  if (!comment) {
    return next(new ErrorResponse('Yorum bulunamadı', 404));
  }

  if (comment.isDeleted) {
    return next(new ErrorResponse('Silinmiş yorumlar oylanamaz', 400));
  }

  // Mevcut oyu kontrol et
  let vote = await Vote.findOne({
    user: userId,
    comment: commentId,
  });

  let oldValue = 0;

  if (vote) {
    // Mevcut oy değerini sakla
    oldValue = vote.value;

    if (value === 0) {
      // Oyu kaldır
      await Vote.findByIdAndDelete(vote._id);
    } else {
      // Oyu güncelle
      vote.value = value;
      await vote.save();
    }
  } else if (value !== 0) {
    // Yeni oy oluştur
    vote = await Vote.create({
      user: userId,
      comment: commentId,
      value,
    });
  }

  // Yorum oy sayılarını güncelle
  if (oldValue === 1 && value !== 1) {
    // Olumlu oyu kaldır
    await Comment.findByIdAndUpdate(commentId, {
      $inc: { upvotes: -1, voteScore: -1 },
    });
  }

  if (oldValue === -1 && value !== -1) {
    // Olumsuz oyu kaldır
    await Comment.findByIdAndUpdate(commentId, {
      $inc: { downvotes: -1, voteScore: 1 },
    });
  }

  if (value === 1 && oldValue !== 1) {
    // Olumlu oy ekle
    await Comment.findByIdAndUpdate(commentId, {
      $inc: { upvotes: 1, voteScore: 1 },
    });
  }

  if (value === -1 && oldValue !== -1) {
    // Olumsuz oy ekle
    await Comment.findByIdAndUpdate(commentId, {
      $inc: { downvotes: 1, voteScore: -1 },
    });
  }

  // Güncellenmiş yorumu getir
  const updatedComment = await Comment.findById(commentId).select('upvotes downvotes voteScore');

  // Kullanıcının bir başkasının yorumunu ilk kez olumlu oyladıysa bildirim gönder
  if (value === 1 && oldValue !== 1 && !comment.author.equals(userId)) {
    await Notification.create({
      recipient: comment.author,
      sender: userId,
      type: 'comment_upvote',
      comment: commentId,
      post: comment.post,
    });
  }

  res.status(200).json({
    success: true,
    data: {
      userVote: value,
      ...updatedComment.toJSON(),
    },
  });
});

/**
 * @desc    Yorumu kaydet
 * @route   POST /api/comments/:commentId/save
 * @access  Private
 */
const saveComment = asyncHandler(async (req, res, next) => {
  const { commentId } = req.params;
  const userId = req.user._id;

  const comment = await Comment.findById(commentId);
  if (!comment) {
    return next(new ErrorResponse('Yorum bulunamadı', 404));
  }

  if (comment.isDeleted) {
    return next(new ErrorResponse('Silinmiş yorumlar kaydedilemez', 400));
  }

  // Zaten kaydedilmiş mi kontrol et
  const existingSave = await SavedItem.findOne({
    user: userId,
    comment: commentId,
  });

  if (existingSave) {
    return next(new ErrorResponse('Bu yorum zaten kaydedilmiş', 400));
  }

  // Kaydet
  await SavedItem.create({
    user: userId,
    comment: commentId,
    savedAt: Date.now(),
  });

  res.status(200).json({
    success: true,
    data: { message: 'Yorum başarıyla kaydedildi' },
  });
});

/**
 * @desc    Yorum kaydını kaldır
 * @route   DELETE /api/comments/:commentId/save
 * @access  Private
 */
const unsaveComment = asyncHandler(async (req, res, next) => {
  const { commentId } = req.params;
  const userId = req.user._id;

  const comment = await Comment.findById(commentId);
  if (!comment) {
    return next(new ErrorResponse('Yorum bulunamadı', 404));
  }

  // Kaydı kontrol et
  const savedItem = await SavedItem.findOne({
    user: userId,
    comment: commentId,
  });

  if (!savedItem) {
    return next(new ErrorResponse('Bu yorum kaydedilmemiş', 404));
  }

  // Kaydı kaldır
  await SavedItem.findByIdAndDelete(savedItem._id);

  res.status(200).json({
    success: true,
    data: { message: 'Yorum kaydı başarıyla kaldırıldı' },
  });
});

/**
 * @desc    Moderatör: Yorumu kaldır
 * @route   PUT /api/comments/:commentId/remove
 * @access  Private (Moderatör)
 */
const removeComment = asyncHandler(async (req, res, next) => {
  const { commentId } = req.params;
  const { reason } = req.body;
  const userId = req.user._id;

  const comment = await Comment.findById(commentId).populate('post', 'subreddit');
  if (!comment) {
    return next(new ErrorResponse('Yorum bulunamadı', 404));
  }

  if (comment.isDeleted) {
    return next(new ErrorResponse('Bu yorum zaten silinmiş', 400));
  }

  // Yorumu kaldır (soft delete)
  comment.isDeleted = true;
  comment.deletedAt = Date.now();
  comment.deletedBy = userId;
  await comment.save();

  // Moderasyon log kaydı oluştur
  await ModLog.create({
    subreddit: comment.post.subreddit,
    moderator: userId,
    action: 'remove_comment',
    targetType: 'comment',
    targetId: commentId,
    reason: reason || 'Kuralları ihlal eden içerik',
  });

  // Kullanıcıya bildirim gönder
  if (!comment.author.equals(userId)) {
    await Notification.create({
      recipient: comment.author,
      sender: userId,
      type: 'comment_removed',
      comment: commentId,
      post: comment.post._id,
      message: reason || 'Yorumunuz topluluk kurallarını ihlal ettiği için kaldırıldı.',
    });
  }

  res.status(200).json({
    success: true,
    data: { message: 'Yorum başarıyla kaldırıldı' },
  });
});

/**
 * @desc    Moderatör: Yorumu onayla
 * @route   PUT /api/comments/:commentId/approve
 * @access  Private (Moderatör)
 */
const approveComment = asyncHandler(async (req, res, next) => {
  const { commentId } = req.params;
  const userId = req.user._id;

  const comment = await Comment.findById(commentId).populate('post', 'subreddit');
  if (!comment) {
    return next(new ErrorResponse('Yorum bulunamadı', 404));
  }

  if (!comment.isDeleted || !comment.deletedBy) {
    return next(new ErrorResponse('Bu yorum kaldırılmamış, onaylanamaz', 400));
  }

  // Yorumu onayla (soft delete'i geri al)
  comment.isDeleted = false;
  comment.deletedAt = undefined;
  comment.deletedBy = undefined;
  await comment.save();

  // Moderasyon log kaydı oluştur
  await ModLog.create({
    subreddit: comment.post.subreddit,
    moderator: userId,
    action: 'approve_comment',
    targetType: 'comment',
    targetId: commentId,
  });

  // Kullanıcıya bildirim gönder
  if (!comment.author.equals(userId)) {
    await Notification.create({
      recipient: comment.author,
      sender: userId,
      type: 'comment_approved',
      comment: commentId,
      post: comment.post._id,
      message: 'Yorumunuz onaylandı ve toplulukta tekrar görünür hale geldi.',
    });
  }

  res.status(200).json({
    success: true,
    data: { message: 'Yorum başarıyla onaylandı' },
  });
});

module.exports = {
  getCommentById,
  createComment,
  updateComment,
  deleteComment,
  replyToComment,
  getCommentReplies,
  voteComment,
  saveComment,
  unsaveComment,
  removeComment,
  approveComment,
};
