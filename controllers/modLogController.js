const ModLog = require('../models/ModLog');
const Subreddit = require('../models/Subreddit');
const User = require('../models/User');
const SubredditMembership = require('../models/SubredditMembership');
const asyncHandler = require('../middleware/async');
const ErrorResponse = require('../utils/errorResponse');
const mongoose = require('mongoose');

/**
 * @desc    Moderasyon logu oluştur
 * @route   POST /api/moderation/logs
 * @access  Private (Moderatörler ve Admin)
 */
const createModLog = asyncHandler(async (req, res, next) => {
  const {
    subredditId,
    action,
    targetType,
    targetPost,
    targetComment,
    targetUser,
    details,
    reason,
    note,
    isPublic,
  } = req.body;

  // Subreddit ID kontrolü
  if (!mongoose.Types.ObjectId.isValid(subredditId)) {
    return next(new ErrorResponse('Geçersiz subreddit ID formatı', 400));
  }

  // Zorunlu alanları kontrol et
  if (!action || !targetType) {
    return next(new ErrorResponse('Eylem ve hedef türü alanları zorunludur', 400));
  }

  // İlgili subreddit'i bul
  const subreddit = await Subreddit.findById(subredditId);
  if (!subreddit) {
    return next(new ErrorResponse('Subreddit bulunamadı', 404));
  }

  // İstekte bulunan kullanıcının moderatör yetkisini kontrol et
  const isModerator = await SubredditMembership.findOne({
    user: req.user._id,
    subreddit: subredditId,
    type: 'moderator',
  });

  // Eğer kullanıcı moderatör veya admin değilse erişimi reddet
  if (!isModerator && req.user.role !== 'admin') {
    return next(new ErrorResponse('Bu işlem için moderatör yetkiniz yok', 403));
  }

  // Hedef tür-alan eşleşmesini kontrol et
  if (
    (targetType === 'post' && !targetPost) ||
    (targetType === 'comment' && !targetComment) ||
    (targetType === 'user' && !targetUser)
  ) {
    return next(new ErrorResponse(`${targetType} türü için ilgili hedef ID gereklidir`, 400));
  }

  // Moderasyon log kaydını oluştur
  const modLog = await ModLog.create({
    subreddit: subredditId,
    moderator: req.user._id,
    action,
    targetType,
    targetPost,
    targetComment,
    targetUser,
    details: details || `${action} eylemi gerçekleştirildi`,
    reason,
    note,
    isPublic: isPublic !== undefined ? isPublic : true,
  });

  res.status(201).json({
    success: true,
    data: modLog,
  });
});

/**
 * @desc    Belirli bir moderasyon logu getir
 * @route   GET /api/moderation/logs/:id
 * @access  Private (Moderatörler ve Admin)
 */
const getModLog = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  // ID formatı kontrolü
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorResponse('Geçersiz log ID formatı', 400));
  }

  // Log kaydını bul ve ilgili alanları doldur
  const modLog = await ModLog.findById(id)
    .populate('subreddit', 'name title icon')
    .populate('moderator', 'username profilePicture')
    .populate('targetPost', 'title')
    .populate('targetComment', 'content')
    .populate('targetUser', 'username');

  if (!modLog) {
    return next(new ErrorResponse('Moderasyon logu bulunamadı', 404));
  }

  // Kullanıcının bu logu görüntüleme yetkisi var mı kontrol et
  const isModerator = await SubredditMembership.findOne({
    user: req.user._id,
    subreddit: modLog.subreddit._id,
    type: 'moderator',
  });

  // Log halka açık değilse ve kullanıcı moderatör değilse erişimi reddet
  if (!modLog.isPublic && !isModerator && req.user.role !== 'admin') {
    return next(new ErrorResponse('Bu moderasyon logunu görüntüleme yetkiniz yok', 403));
  }

  res.status(200).json({
    success: true,
    data: modLog,
  });
});

/**
 * @desc    Subreddit moderasyon loglarını listele
 * @route   GET /api/subreddits/:subredditId/moderation/logs
 * @access  Private/Public (isPublic değerine göre)
 */
const getSubredditModLogs = asyncHandler(async (req, res, next) => {
  const { subredditId } = req.params;
  const {
    page = 1,
    limit = 20,
    action,
    targetType,
    moderator,
    isPublic,
    startDate,
    endDate,
    sort = '-createdAt',
  } = req.query;

  // Subreddit ID formatı kontrolü
  if (!mongoose.Types.ObjectId.isValid(subredditId)) {
    return next(new ErrorResponse('Geçersiz subreddit ID formatı', 400));
  }

  // Subreddit'i kontrol et
  const subreddit = await Subreddit.findById(subredditId);
  if (!subreddit) {
    return next(new ErrorResponse('Subreddit bulunamadı', 404));
  }

  // Kullanıcının moderatör olup olmadığını kontrol et
  let isModerator = false;
  if (req.user) {
    isModerator = await SubredditMembership.findOne({
      user: req.user._id,
      subreddit: subredditId,
      type: 'moderator',
    });
  }

  // Sorgu filtresini oluştur
  const filter = { subreddit: subredditId };

  // Eğer kullanıcı moderatör değilse, sadece public logları göster
  if (!isModerator && req.user?.role !== 'admin') {
    filter.isPublic = true;
  } else if (isPublic !== undefined) {
    // Moderatörler ve adminler için isPublic filtresi
    filter.isPublic = isPublic === 'true';
  }

  // Eylem filtresi
  if (action) {
    filter.action = action;
  }

  // Hedef tür filtresi
  if (targetType) {
    filter.targetType = targetType;
  }

  // Moderatör filtresi
  if (moderator && mongoose.Types.ObjectId.isValid(moderator)) {
    filter.moderator = moderator;
  }

  // Tarih aralığı filtresi
  if (startDate || endDate) {
    filter.createdAt = {};

    if (startDate) {
      filter.createdAt.$gte = new Date(startDate);
    }

    if (endDate) {
      filter.createdAt.$lte = new Date(endDate);
    }
  }

  // Sayfalama ayarları
  const options = {
    page: parseInt(page, 10),
    limit: parseInt(limit, 10),
    sort,
    populate: [
      { path: 'moderator', select: 'username profilePicture' },
      { path: 'targetPost', select: 'title' },
      { path: 'targetComment', select: 'content' },
      { path: 'targetUser', select: 'username' },
    ],
  };

  // Moderasyon loglarını getir
  const result = await ModLog.paginate(filter, options);

  res.status(200).json({
    success: true,
    count: result.docs.length,
    pagination: {
      total: result.totalDocs,
      page: result.page,
      pages: result.totalPages,
      limit: result.limit,
    },
    data: result.docs,
  });
});

/**
 * @desc    Moderatör tarafından gerçekleştirilen işlemleri listele
 * @route   GET /api/users/:userId/moderation/logs
 * @access  Private (Moderatörler ve Admin)
 */
const getModeratorLogs = asyncHandler(async (req, res, next) => {
  const { userId } = req.params;
  const {
    page = 1,
    limit = 20,
    subredditId,
    action,
    targetType,
    startDate,
    endDate,
    sort = '-createdAt',
  } = req.query;

  // User ID formatı kontrolü
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    return next(new ErrorResponse('Geçersiz kullanıcı ID formatı', 400));
  }

  // Kullanıcıyı kontrol et
  const user = await User.findById(userId);
  if (!user) {
    return next(new ErrorResponse('Kullanıcı bulunamadı', 404));
  }

  // Yetki kontrolü
  // Eğer kullanıcı kendisi değilse ve admin değilse, erişimi reddet
  if (userId !== req.user._id.toString() && req.user.role !== 'admin') {
    // Subreddit moderatörleri kendi subredditlerindeki moderasyon loglarını görebilir
    let hasPermission = false;

    if (subredditId && mongoose.Types.ObjectId.isValid(subredditId)) {
      const isModerator = await SubredditMembership.findOne({
        user: req.user._id,
        subreddit: subredditId,
        type: 'moderator',
      });

      if (isModerator) {
        hasPermission = true;
      }
    }

    if (!hasPermission) {
      return next(
        new ErrorResponse('Bu kullanıcının moderasyon loglarını görüntüleme yetkiniz yok', 403),
      );
    }
  }

  // Sorgu filtresini oluştur
  const filter = { moderator: userId };

  // Subreddit filtresi
  if (subredditId && mongoose.Types.ObjectId.isValid(subredditId)) {
    filter.subreddit = subredditId;
  }

  // Eylem filtresi
  if (action) {
    filter.action = action;
  }

  // Hedef tür filtresi
  if (targetType) {
    filter.targetType = targetType;
  }

  // Tarih aralığı filtresi
  if (startDate || endDate) {
    filter.createdAt = {};

    if (startDate) {
      filter.createdAt.$gte = new Date(startDate);
    }

    if (endDate) {
      filter.createdAt.$lte = new Date(endDate);
    }
  }

  // İstek sahibi admin değilse sadece public logları göster
  if (req.user.role !== 'admin') {
    filter.isPublic = true;
  }

  // Sayfalama ayarları
  const options = {
    page: parseInt(page, 10),
    limit: parseInt(limit, 10),
    sort,
    populate: [
      { path: 'subreddit', select: 'name title icon' },
      { path: 'targetPost', select: 'title' },
      { path: 'targetComment', select: 'content' },
      { path: 'targetUser', select: 'username' },
    ],
  };

  // Moderasyon loglarını getir
  const result = await ModLog.paginate(filter, options);

  res.status(200).json({
    success: true,
    count: result.docs.length,
    pagination: {
      total: result.totalDocs,
      page: result.page,
      pages: result.totalPages,
      limit: result.limit,
    },
    data: result.docs,
  });
});

/**
 * @desc    Belirli bir hedefin moderasyon loglarını listele
 * @route   GET /api/moderation/logs/target/:targetType/:targetId
 * @access  Private (Moderatörler ve Admin)
 */
const getTargetModLogs = asyncHandler(async (req, res, next) => {
  const { targetType, targetId } = req.params;
  const { page = 1, limit = 20 } = req.query;

  // Hedef ID formatı kontrolü
  if (!mongoose.Types.ObjectId.isValid(targetId)) {
    return next(new ErrorResponse('Geçersiz hedef ID formatı', 400));
  }

  // Hedef tür kontrolü
  if (!['post', 'comment', 'user', 'subreddit'].includes(targetType)) {
    return next(new ErrorResponse('Geçersiz hedef türü', 400));
  }

  // Sorgu filtresini oluştur
  const targetField = `target${targetType.charAt(0).toUpperCase() + targetType.slice(1)}`;
  const filter = {};
  filter[targetField] = targetId;

  // Hedef bir subreddit ise, kullanıcının o subredditin moderatörü olduğunu kontrol et
  if (targetType === 'subreddit') {
    const isModerator = await SubredditMembership.findOne({
      user: req.user._id,
      subreddit: targetId,
      type: 'moderator',
    });

    if (!isModerator && req.user.role !== 'admin') {
      filter.isPublic = true;
    }
  } else {
    // Diğer hedef türleri için subreddit bağlantısını kontrol et
    const modLogs = await ModLog.find(filter).select('subreddit');

    // Kullanıcının moderatör olduğu subreddit'lerin ID'lerini topla
    let moderatorSubreddits = [];
    if (req.user.role !== 'admin') {
      const moderatorships = await SubredditMembership.find({
        user: req.user._id,
        type: 'moderator',
      });

      moderatorSubreddits = moderatorships.map((m) => m.subreddit.toString());
    }

    // Hedef objenin tüm logları için kullanıcı erişim hakkı yok ise
    // sadece erişim hakkı olan subreddit'lerin loglarını ve public logları göster
    if (req.user.role !== 'admin') {
      filter.$or = [{ isPublic: true }, { subreddit: { $in: moderatorSubreddits } }];
    }
  }

  // Sayfalama ayarları
  const options = {
    page: parseInt(page, 10),
    limit: parseInt(limit, 10),
    sort: '-createdAt',
    populate: [
      { path: 'subreddit', select: 'name title icon' },
      { path: 'moderator', select: 'username profilePicture' },
    ],
  };

  // Moderasyon loglarını getir
  const result = await ModLog.paginate(filter, options);

  res.status(200).json({
    success: true,
    count: result.docs.length,
    pagination: {
      total: result.totalDocs,
      page: result.page,
      pages: result.totalPages,
      limit: result.limit,
    },
    data: result.docs,
  });
});

/**
 * @desc    Moderasyon logunu güncelle (not ekle/değiştir, görünürlük değiştir)
 * @route   PUT /api/moderation/logs/:id
 * @access  Private (Sadece log sahibi veya üst düzey moderatörler)
 */
const updateModLog = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { note, isPublic } = req.body;

  // ID formatı kontrolü
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorResponse('Geçersiz log ID formatı', 400));
  }

  // Log kaydını bul
  const modLog = await ModLog.findById(id);

  if (!modLog) {
    return next(new ErrorResponse('Moderasyon logu bulunamadı', 404));
  }

  // Yetkiyi kontrol et: Log sahibi veya admin olmalı
  if (modLog.moderator.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
    // Üst düzey moderatör kontrolü (kurucu moderatör veya daha önce atanmış moderatör)
    const currentModMembership = await SubredditMembership.findOne({
      user: req.user._id,
      subreddit: modLog.subreddit,
      type: 'moderator',
    });

    const logOwnerMembership = await SubredditMembership.findOne({
      user: modLog.moderator,
      subreddit: modLog.subreddit,
      type: 'moderator',
    });

    const isFounder = currentModMembership && currentModMembership.isFounder;
    const isSenior =
      currentModMembership &&
      logOwnerMembership &&
      currentModMembership.joinedAt < logOwnerMembership.joinedAt;

    if (!isFounder && !isSenior) {
      return next(new ErrorResponse('Bu log kaydını güncelleme yetkiniz yok', 403));
    }
  }

  // Sadece belirli alanların güncellenmesine izin ver
  const updateData = {};

  if (note !== undefined) {
    updateData.note = note;

    // Log bir güncelleme logu oluştur (log seviyesinde audit trail)
    await ModLog.create({
      subreddit: modLog.subreddit,
      moderator: req.user._id,
      action: 'edit_log',
      targetType: 'other',
      details: `Log ID #${modLog._id} için not güncellendi`,
      isPublic: false,
    });
  }

  if (isPublic !== undefined) {
    updateData.isPublic = isPublic;

    // Görünürlük değişikliği logu
    await ModLog.create({
      subreddit: modLog.subreddit,
      moderator: req.user._id,
      action: 'edit_log',
      targetType: 'other',
      details: `Log ID #${modLog._id} için görünürlük ${isPublic ? 'açık' : 'gizli'} olarak ayarlandı`,
      isPublic: false,
    });
  }

  // Güncellemeyi gerçekleştir
  const updatedModLog = await ModLog.findByIdAndUpdate(id, updateData, {
    new: true,
    runValidators: true,
  });

  res.status(200).json({
    success: true,
    data: updatedModLog,
  });
});

/**
 * @desc    Moderasyon eylem tipleri ve istatistikleri
 * @route   GET /api/subreddits/:subredditId/moderation/stats
 * @access  Private (Moderatörler ve Admin)
 */
const getModeratorStats = asyncHandler(async (req, res, next) => {
  const { subredditId } = req.params;
  const { startDate, endDate } = req.query;

  // Subreddit ID formatı kontrolü
  if (!mongoose.Types.ObjectId.isValid(subredditId)) {
    return next(new ErrorResponse('Geçersiz subreddit ID formatı', 400));
  }

  // Subreddit'i kontrol et
  const subreddit = await Subreddit.findById(subredditId);
  if (!subreddit) {
    return next(new ErrorResponse('Subreddit bulunamadı', 404));
  }

  // Kullanıcının moderatör olup olmadığını kontrol et
  const isModerator = await SubredditMembership.findOne({
    user: req.user._id,
    subreddit: subredditId,
    type: 'moderator',
  });

  if (!isModerator && req.user.role !== 'admin') {
    return next(new ErrorResponse('Bu işlem için moderatör yetkiniz yok', 403));
  }

  // Tarih filtresini ayarla
  const dateFilter = {};
  if (startDate) {
    dateFilter.$gte = new Date(startDate);
  }
  if (endDate) {
    dateFilter.$lte = new Date(endDate);
  }

  // Temel sorgu filtresini oluştur
  const filter = { subreddit: subredditId };
  if (Object.keys(dateFilter).length > 0) {
    filter.createdAt = dateFilter;
  }

  // Toplam log sayısı
  const totalLogs = await ModLog.countDocuments(filter);

  // Eylem tiplerine göre sayılar
  const actionStats = await ModLog.aggregate([
    { $match: filter },
    { $group: { _id: '$action', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);

  // Hedef tiplerine göre sayılar
  const targetTypeStats = await ModLog.aggregate([
    { $match: filter },
    { $group: { _id: '$targetType', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);

  // Moderatörlere göre sayılar
  const moderatorStats = await ModLog.aggregate([
    { $match: filter },
    { $group: { _id: '$moderator', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);

  // Moderatör bilgilerini getir
  const moderatorIds = moderatorStats.map((stat) => stat._id);
  const moderators = await User.find({ _id: { $in: moderatorIds } }).select(
    'username profilePicture',
  );

  const moderatorMap = {};
  moderators.forEach((mod) => {
    moderatorMap[mod._id.toString()] = {
      username: mod.username,
      profilePicture: mod.profilePicture,
    };
  });

  // Moderatör istatistiklerine kullanıcı bilgilerini ekle
  const moderatorStatsWithUserInfo = moderatorStats.map((stat) => ({
    moderator: {
      _id: stat._id,
      ...moderatorMap[stat._id.toString()],
    },
    count: stat.count,
  }));

  // Günlük işlem sayıları (son 30 gün)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const dailyStats = await ModLog.aggregate([
    {
      $match: {
        ...filter,
        createdAt: { $gte: thirtyDaysAgo },
      },
    },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
        count: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  res.status(200).json({
    success: true,
    data: {
      totalLogs,
      actionStats,
      targetTypeStats,
      moderatorStats: moderatorStatsWithUserInfo,
      dailyStats,
    },
  });
});

/**
 * @desc    Subreddit'teki etkili moderatörleri listele
 * @route   GET /api/subreddits/:subredditId/moderation/active
 * @access  Public (sadece istatistikler)
 */
const getActiveModeratorsList = asyncHandler(async (req, res, next) => {
  const { subredditId } = req.params;
  const { days = 30 } = req.query;

  // Subreddit ID formatı kontrolü
  if (!mongoose.Types.ObjectId.isValid(subredditId)) {
    return next(new ErrorResponse('Geçersiz subreddit ID formatı', 400));
  }

  // Subreddit'i kontrol et
  const subreddit = await Subreddit.findById(subredditId);
  if (!subreddit) {
    return next(new ErrorResponse('Subreddit bulunamadı', 404));
  }

  // Belirtilen gün sayısı için tarih hesapla
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - parseInt(days));

  // Aktif moderatör verilerini getir
  const activeModeratorStats = await ModLog.aggregate([
    {
      $match: {
        subreddit: mongoose.Types.ObjectId(subredditId),
        createdAt: { $gte: startDate },
        isPublic: true,
      },
    },
    {
      $group: {
        _id: '$moderator',
        actions: { $sum: 1 },
        postActions: {
          $sum: {
            $cond: [{ $eq: ['$targetType', 'post'] }, 1, 0],
          },
        },
        commentActions: {
          $sum: {
            $cond: [{ $eq: ['$targetType', 'comment'] }, 1, 0],
          },
        },
        userActions: {
          $sum: {
            $cond: [{ $eq: ['$targetType', 'user'] }, 1, 0],
          },
        },
        lastAction: { $max: '$createdAt' },
      },
    },
    { $sort: { actions: -1 } },
  ]);

  // Moderatör bilgilerini getir
  const moderatorIds = activeModeratorStats.map((stat) => stat._id);
  const moderators = await User.find({ _id: { $in: moderatorIds } }).select(
    'username profilePicture',
  );

  const moderatorMap = {};
  moderators.forEach((mod) => {
    moderatorMap[mod._id.toString()] = {
      username: mod.username,
      profilePicture: mod.profilePicture,
    };
  });

  // Sonuçları formatla
  const formattedStats = activeModeratorStats.map((stat) => ({
    moderator: {
      _id: stat._id,
      ...moderatorMap[stat._id.toString()],
    },
    actions: stat.actions,
    postActions: stat.postActions,
    commentActions: stat.commentActions,
    userActions: stat.userActions,
    lastAction: stat.lastAction,
  }));

  res.status(200).json({
    success: true,
    days: parseInt(days),
    count: formattedStats.length,
    data: formattedStats,
  });
});

module.exports = {
  createModLog,
  getModLog,
  getSubredditModLogs,
  getModeratorLogs,
  getTargetModLogs,
  updateModLog,
  getModeratorStats,
  getActiveModeratorsList,
};
