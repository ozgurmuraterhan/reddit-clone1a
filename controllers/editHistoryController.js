const mongoose = require('mongoose');
const asyncHandler = require('../middleware/async');
const ErrorResponse = require('../utils/errorResponse');
const EditHistory = require('../models/EditHistory');
const Post = require('../models/Post');
const Comment = require('../models/Comment');
const User = require('../models/User');

/**
 * @desc    İçerik düzenleme sayısını ve son düzenleme bilgisini getir
 * @route   GET /api/edit-history/count/:postId
 * @route   GET /api/edit-history/count/:commentId
 * @access  Public
 */
const getContentEditCount = asyncHandler(async (req, res, next) => {
  const { postId, commentId } = req.params;

  // Hangi içerik türü için geçmiş isteniyor kontrol et
  if (!postId && !commentId) {
    return next(new ErrorResponse('Post ID veya Comment ID gereklidir', 400));
  }

  let contentType, contentId;

  // Post geçmişi için
  if (postId) {
    if (!mongoose.Types.ObjectId.isValid(postId)) {
      return next(new ErrorResponse('Geçersiz post ID formatı', 400));
    }

    contentType = 'post';
    contentId = postId;

    // Orijinal postu kontrol et
    const post = await Post.findById(postId);
    if (!post) {
      return next(new ErrorResponse('Post bulunamadı', 404));
    }
  }

  // Yorum geçmişi için
  if (commentId) {
    if (!mongoose.Types.ObjectId.isValid(commentId)) {
      return next(new ErrorResponse('Geçersiz yorum ID formatı', 400));
    }

    contentType = 'comment';
    contentId = commentId;

    // Orijinal yorumu kontrol et
    const comment = await Comment.findById(commentId);
    if (!comment) {
      return next(new ErrorResponse('Yorum bulunamadı', 404));
    }
  }

  // Düzenleme sayısını getir
  const query = { contentType };
  contentType === 'post' ? (query.post = contentId) : (query.comment = contentId);

  const editCount = await EditHistory.countDocuments(query);

  // Son düzenleme bilgisini getir
  const lastEdit = await EditHistory.findOne(query)
    .sort({ createdAt: -1 })
    .populate('editedBy', 'username avatar');

  res.status(200).json({
    success: true,
    data: {
      editCount,
      lastEdit: lastEdit
        ? {
            editedAt: lastEdit.createdAt,
            editedBy: lastEdit.editedBy
              ? {
                  username: lastEdit.editedBy.username,
                  avatar: lastEdit.editedBy.avatar,
                }
              : null,
            reason: lastEdit.reason,
            isModerationEdit: lastEdit.isModerationEdit,
          }
        : null,
    },
  });
});

/**
 * @desc    İçerik düzenleme geçmişini getir
 * @route   GET /api/edit-history/:postId
 * @route   GET /api/edit-history/:commentId
 * @access  Public
 */
const getContentEditHistory = asyncHandler(async (req, res, next) => {
  const { postId, commentId } = req.params;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const skip = (page - 1) * limit;

  // Hangi içerik türü için geçmiş isteniyor kontrol et
  if (!postId && !commentId) {
    return next(new ErrorResponse('Post ID veya Comment ID gereklidir', 400));
  }

  let contentType, contentId, originalContent;

  // Post geçmişi için
  if (postId) {
    if (!mongoose.Types.ObjectId.isValid(postId)) {
      return next(new ErrorResponse('Geçersiz post ID formatı', 400));
    }

    contentType = 'post';
    contentId = postId;

    // Orijinal postu kontrol et
    const post = await Post.findById(postId);
    if (!post) {
      return next(new ErrorResponse('Post bulunamadı', 404));
    }

    originalContent = post;
  }

  // Yorum geçmişi için
  if (commentId) {
    if (!mongoose.Types.ObjectId.isValid(commentId)) {
      return next(new ErrorResponse('Geçersiz yorum ID formatı', 400));
    }

    contentType = 'comment';
    contentId = commentId;

    // Orijinal yorumu kontrol et
    const comment = await Comment.findById(commentId);
    if (!comment) {
      return next(new ErrorResponse('Yorum bulunamadı', 404));
    }

    originalContent = comment;
  }

  // Düzenleme geçmişini getir
  const query = { contentType };
  contentType === 'post' ? (query.post = contentId) : (query.comment = contentId);

  const editHistory = await EditHistory.find(query)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .populate('editedBy', 'username avatar');

  const totalEdits = await EditHistory.countDocuments(query);

  res.status(200).json({
    success: true,
    data: {
      originalContent: {
        id: originalContent._id,
        content: originalContent.content || originalContent.text || originalContent.body,
        createdAt: originalContent.createdAt,
        author: originalContent.author,
      },
      edits: editHistory,
      currentPage: page,
      totalPages: Math.ceil(totalEdits / limit),
      totalEdits,
    },
  });
});

/**
 * @desc    Yeni düzenleme geçmişi ekle (internal kullanım için)
 * @access  Private
 */
const createEditHistory = asyncHandler(
  async (
    contentType,
    contentId,
    previousContent,
    editedBy,
    reason = null,
    isModerationEdit = false,
  ) => {
    // Girdileri doğrula
    if (!contentType || !contentId || !previousContent || !editedBy) {
      throw new Error(
        'Eksik parametreler: contentType, contentId, previousContent, editedBy gereklidir',
      );
    }

    if (contentType !== 'post' && contentType !== 'comment') {
      throw new Error('Geçersiz içerik türü. "post" veya "comment" olmalıdır');
    }

    if (!mongoose.Types.ObjectId.isValid(contentId) || !mongoose.Types.ObjectId.isValid(editedBy)) {
      throw new Error('Geçersiz ID formatı');
    }

    // Düzenleme geçmişi oluştur
    const editHistory = await EditHistory.create({
      contentType,
      [contentType]: contentId, // dynamic field: post or comment
      previousContent,
      editedBy,
      reason,
      isModerationEdit,
    });

    return editHistory;
  },
);

/**
 * @desc    Moderatör/admin: Düzenleme geçmişi kaydını göster
 * @route   GET /api/edit-history/record/:id
 * @access  Private (Moderator or Admin)
 */
const getEditHistoryRecord = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user._id;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorResponse('Geçersiz düzenleme kaydı ID formatı', 400));
  }

  const editRecord = await EditHistory.findById(id)
    .populate('editedBy', 'username avatar')
    .populate({
      path: 'post',
      select: 'title author subreddit',
      populate: {
        path: 'subreddit',
        select: 'name',
      },
    })
    .populate({
      path: 'comment',
      select: 'content author post',
      populate: {
        path: 'post',
        select: 'title subreddit',
      },
    });

  if (!editRecord) {
    return next(new ErrorResponse('Düzenleme kaydı bulunamadı', 404));
  }

  // Yetki kontrolü - admin, içerik sahibi veya moderatör olmalı
  const isAdmin = req.user.role === 'admin';
  const isContentAuthor =
    (editRecord.post && editRecord.post.author.equals(userId)) ||
    (editRecord.comment && editRecord.comment.author.equals(userId));

  let isModerator = false;

  if (!isAdmin && !isContentAuthor) {
    // Moderatör kontrolü
    const subredditId =
      (editRecord.post && editRecord.post.subreddit) ||
      (editRecord.comment && editRecord.comment.post && editRecord.comment.post.subreddit);

    if (subredditId) {
      isModerator = await isModeratorOf(userId, subredditId);
    }

    if (!isModerator) {
      return next(new ErrorResponse('Bu düzenleme kaydını görüntüleme yetkiniz yok', 403));
    }
  }

  res.status(200).json({
    success: true,
    data: editRecord,
  });
});

/**
 * @desc    Kullanıcı düzenleme istatistiklerini getir
 * @route   GET /api/edit-history/stats/user/:userId
 * @access  Private (Admin or Same User)
 */
const getUserEditStats = asyncHandler(async (req, res, next) => {
  const { userId } = req.params;
  const requestingUserId = req.user._id;

  if (!mongoose.Types.ObjectId.isValid(userId)) {
    return next(new ErrorResponse('Geçersiz kullanıcı ID formatı', 400));
  }

  // Yetki kontrolü
  if (!requestingUserId.equals(userId) && req.user.role !== 'admin') {
    return next(
      new ErrorResponse('Bu kullanıcının düzenleme istatistiklerini görüntüleme yetkiniz yok', 403),
    );
  }

  // Kullanıcıyı kontrol et
  const user = await User.findById(userId);
  if (!user) {
    return next(new ErrorResponse('Kullanıcı bulunamadı', 404));
  }

  // Toplam düzenleme sayısı
  const totalEdits = await EditHistory.countDocuments({ editedBy: userId });

  // Post düzenlemeleri
  const postEdits = await EditHistory.countDocuments({
    editedBy: userId,
    contentType: 'post',
  });

  // Yorum düzenlemeleri
  const commentEdits = await EditHistory.countDocuments({
    editedBy: userId,
    contentType: 'comment',
  });

  // Moderasyon düzenlemeleri
  const moderationEdits = await EditHistory.countDocuments({
    editedBy: userId,
    isModerationEdit: true,
  });

  // Son 30 gündeki düzenlemeler  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const recentEdits = await EditHistory.countDocuments({
    editedBy: userId,
    createdAt: { $gte: thirtyDaysAgo },
  });

  // En çok düzenlenen içerik türü
  const postEditCount = await EditHistory.countDocuments({
    editedBy: userId,
    contentType: 'post',
  });

  const commentEditCount = await EditHistory.countDocuments({
    editedBy: userId,
    contentType: 'comment',
  });

  const mostEditedContentType = postEditCount > commentEditCount ? 'post' : 'comment';

  res.status(200).json({
    success: true,
    data: {
      totalEdits,
      postEdits,
      commentEdits,
      moderationEdits,
      recentEdits,
      mostEditedContentType,
      editRate: totalEdits > 0 ? (moderationEdits / totalEdits) * 100 : 0,
    },
  });
});

/**
 * @desc    Subreddit düzenleme istatistiklerini getir
 * @route   GET /api/edit-history/stats/subreddit/:subredditId
 * @access  Private (Admin or Moderator)
 */
const getSubredditEditStats = asyncHandler(async (req, res, next) => {
  const { subredditId } = req.params;
  const userId = req.user._id;

  if (!mongoose.Types.ObjectId.isValid(subredditId)) {
    return next(new ErrorResponse('Geçersiz subreddit ID formatı', 400));
  }

  // Subreddit kontrolü
  const subreddit = await mongoose.model('Subreddit').findById(subredditId);
  if (!subreddit) {
    return next(new ErrorResponse('Subreddit bulunamadı', 404));
  }

  // Yetki kontrolü
  const isAdmin = req.user.role === 'admin';
  let isModerator = false;

  if (!isAdmin) {
    isModerator = await isModeratorOf(userId, subredditId);
    if (!isModerator) {
      return next(
        new ErrorResponse(
          "Bu subreddit'in düzenleme istatistiklerini görüntüleme yetkiniz yok",
          403,
        ),
      );
    }
  }

  // Subreddit'te bulunan postları bul
  const posts = await Post.find({ subreddit: subredditId }).select('_id');
  const postIds = posts.map((post) => post._id);

  // Subreddit'te bulunan yorumları bul
  const comments = await Comment.find({ post: { $in: postIds } }).select('_id');
  const commentIds = comments.map((comment) => comment._id);

  // Toplam düzenleme sayısı
  const postEdits = await EditHistory.countDocuments({
    post: { $in: postIds },
    contentType: 'post',
  });

  const commentEdits = await EditHistory.countDocuments({
    comment: { $in: commentIds },
    contentType: 'comment',
  });

  const totalEdits = postEdits + commentEdits;

  // Moderatör düzenlemeleri
  const moderationEdits = await EditHistory.countDocuments({
    $or: [
      { post: { $in: postIds }, contentType: 'post' },
      { comment: { $in: commentIds }, contentType: 'comment' },
    ],
    isModerationEdit: true,
  });

  // Son 30 gündeki düzenlemeler
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const recentEdits = await EditHistory.countDocuments({
    $or: [
      { post: { $in: postIds }, contentType: 'post' },
      { comment: { $in: commentIds }, contentType: 'comment' },
    ],
    createdAt: { $gte: thirtyDaysAgo },
  });

  // En aktif düzenleyiciler
  const topEditors = await EditHistory.aggregate([
    {
      $match: {
        $or: [
          { post: { $in: postIds }, contentType: 'post' },
          { comment: { $in: commentIds }, contentType: 'comment' },
        ],
      },
    },
    {
      $group: {
        _id: '$editedBy',
        editCount: { $sum: 1 },
      },
    },
    {
      $sort: { editCount: -1 },
    },
    {
      $limit: 5,
    },
    {
      $lookup: {
        from: 'users',
        localField: '_id',
        foreignField: '_id',
        as: 'userInfo',
      },
    },
    {
      $unwind: '$userInfo',
    },
    {
      $project: {
        _id: 1,
        username: '$userInfo.username',
        avatar: '$userInfo.avatar',
        editCount: 1,
      },
    },
  ]);

  res.status(200).json({
    success: true,
    data: {
      totalEdits,
      postEdits,
      commentEdits,
      moderationEdits,
      recentEdits,
      moderationEditRate: totalEdits > 0 ? (moderationEdits / totalEdits) * 100 : 0,
      topEditors,
    },
  });
});

/**
 * @desc    Moderatör: İçerik düzenleme geçmişinden bir kaydı sil
 * @route   DELETE /api/edit-history/:id
 * @access  Private (Admin only)
 */
const deleteEditHistoryRecord = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorResponse('Geçersiz düzenleme kaydı ID formatı', 400));
  }

  // Sadece admin bu işlemi yapabilir
  if (req.user.role !== 'admin') {
    return next(
      new ErrorResponse('Düzenleme geçmişi kayıtlarını silmek için admin yetkileri gerekiyor', 403),
    );
  }

  // Kaydı kontrol et
  const editRecord = await EditHistory.findById(id);

  if (!editRecord) {
    return next(new ErrorResponse('Düzenleme kaydı bulunamadı', 404));
  }

  // Kaydı sil
  await EditHistory.findByIdAndDelete(id);

  res.status(200).json({
    success: true,
    data: {},
    message: 'Düzenleme geçmişi kaydı başarıyla silindi',
  });
});

/**
 * @desc    Düzenleme geçmişi arama
 * @route   GET /api/edit-history/search
 * @access  Private (Admin only)
 */
const searchEditHistory = asyncHandler(async (req, res, next) => {
  // Sadece admin bu işlemi yapabilir
  if (req.user.role !== 'admin') {
    return next(new ErrorResponse('Düzenleme geçmişi araması için admin yetkileri gerekiyor', 403));
  }

  const { contentType, userId, subredditId, isModerationEdit, startDate, endDate, searchTerm } =
    req.query;

  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const skip = (page - 1) * limit;

  // Arama sorgusu oluştur
  const query = {};

  if (contentType) {
    if (contentType !== 'post' && contentType !== 'comment') {
      return next(new ErrorResponse('Geçersiz içerik türü. "post" veya "comment" olmalıdır', 400));
    }
    query.contentType = contentType;
  }

  if (userId && mongoose.Types.ObjectId.isValid(userId)) {
    query.editedBy = userId;
  }

  if (isModerationEdit !== undefined) {
    query.isModerationEdit = isModerationEdit === 'true';
  }

  // Tarih aralığı filtreleme
  if (startDate || endDate) {
    query.createdAt = {};

    if (startDate) {
      const startDateTime = new Date(startDate);
      if (isNaN(startDateTime.getTime())) {
        return next(new ErrorResponse('Geçersiz başlangıç tarihi formatı', 400));
      }
      query.createdAt.$gte = startDateTime;
    }

    if (endDate) {
      const endDateTime = new Date(endDate);
      if (isNaN(endDateTime.getTime())) {
        return next(new ErrorResponse('Geçersiz bitiş tarihi formatı', 400));
      }
      // Günün sonuna ayarla
      endDateTime.setHours(23, 59, 59, 999);
      query.createdAt.$lte = endDateTime;
    }
  }

  // Metin araması
  if (searchTerm) {
    query.previousContent = { $regex: searchTerm, $options: 'i' };
  }

  // Subreddit filtreleme
  if (subredditId && mongoose.Types.ObjectId.isValid(subredditId)) {
    // İlişkili postları bul
    const posts = await Post.find({ subreddit: subredditId }).select('_id');
    const postIds = posts.map((post) => post._id);

    // İlişkili yorumları bul
    const comments = await Comment.find({ post: { $in: postIds } }).select('_id');
    const commentIds = comments.map((comment) => comment._id);

    // Post veya comment eşleşmesine göre filtrele
    query.$or = [{ post: { $in: postIds } }, { comment: { $in: commentIds } }];
  }

  // Sonuçları getir
  const results = await EditHistory.find(query)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .populate('editedBy', 'username avatar')
    .populate({
      path: 'post',
      select: 'title author subreddit',
      populate: {
        path: 'subreddit',
        select: 'name',
      },
    })
    .populate({
      path: 'comment',
      select: 'content author post',
      populate: {
        path: 'post',
        select: 'title subreddit',
      },
    });

  // Toplam sonuç sayısı
  const total = await EditHistory.countDocuments(query);

  res.status(200).json({
    success: true,
    data: results,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  });
});

/**
 * @desc    Moderatör: İçerik düzenleme geçmişi özetini getir
 * @route   GET /api/edit-history/summary/:contentType/:contentId
 * @access  Private (Admin, Mod, or Content Owner)
 */
const getContentEditSummary = asyncHandler(async (req, res, next) => {
  const { contentType, contentId } = req.params;
  const userId = req.user._id;

  if (!contentType || !contentId) {
    return next(new ErrorResponse('İçerik türü ve ID gereklidir', 400));
  }

  if (contentType !== 'post' && contentType !== 'comment') {
    return next(new ErrorResponse('Geçersiz içerik türü. "post" veya "comment" olmalıdır', 400));
  }

  if (!mongoose.Types.ObjectId.isValid(contentId)) {
    return next(new ErrorResponse('Geçersiz içerik ID formatı', 400));
  }

  // İçeriği kontrol et
  let content, subredditId;

  if (contentType === 'post') {
    content = await Post.findById(contentId);
    if (!content) {
      return next(new ErrorResponse('Post bulunamadı', 404));
    }
    subredditId = content.subreddit;
  } else {
    content = await Comment.findById(contentId).populate('post', 'subreddit');
    if (!content) {
      return next(new ErrorResponse('Yorum bulunamadı', 404));
    }
    subredditId = content.post.subreddit;
  }

  // Yetki kontrolü
  const isAdmin = req.user.role === 'admin';
  const isAuthor = content.author.equals(userId);
  let isModerator = false;

  if (!isAdmin && !isAuthor) {
    // Moderatör kontrolü
    isModerator = await isModeratorOf(userId, subredditId);
    if (!isModerator) {
      return next(new ErrorResponse('Bu içeriğin düzenleme özetini görüntüleme yetkiniz yok', 403));
    }
  }

  // Sorgu oluştur
  const query = { contentType };
  query[contentType] = contentId;

  // Düzenleme sayısı
  const editCount = await EditHistory.countDocuments(query);

  // Son düzenleme
  const lastEdit = await EditHistory.findOne(query)
    .sort({ createdAt: -1 })
    .populate('editedBy', 'username avatar');

  // Moderasyon düzenlemeleri
  const moderationEdits = await EditHistory.countDocuments({
    ...query,
    isModerationEdit: true,
  });

  // Benzersiz düzenleyiciler
  const uniqueEditors = await EditHistory.distinct('editedBy', query);

  // Düzenleme sebepleri
  const reasons = await EditHistory.aggregate([
    { $match: { ...query, reason: { $ne: null, $ne: '' } } },
    { $group: { _id: '$reason', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 5 },
  ]);

  res.status(200).json({
    success: true,
    data: {
      contentType,
      contentId,
      editCount,
      lastEdit,
      moderationEdits,
      uniqueEditorCount: uniqueEditors.length,
      topReasons: reasons.map((r) => ({ reason: r._id, count: r.count })),
    },
  });
});

module.exports = {
  getContentEditCount,
  getContentEditHistory,
  createEditHistory,
  getEditHistoryRecord,
  getUserEditStats,
  getSubredditEditStats,
  deleteEditHistoryRecord,
  searchEditHistory,
  getContentEditSummary,
};
