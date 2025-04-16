const Report = require('../models/Report');
const Post = require('../models/Post');
const Comment = require('../models/Comment');
const User = require('../models/User');
const Subreddit = require('../models/Subreddit');
const SubredditRule = require('../models/SubredditRule');
const SubredditMembership = require('../models/SubredditMembership');
const ModLog = require('../models/ModLog');
const mongoose = require('mongoose');
const asyncHandler = require('../middleware/async');
const ErrorResponse = require('../utils/errorResponse');

/**
 * @desc    Rapor oluştur
 * @route   POST /api/reports
 * @access  Private
 */
const createReport = asyncHandler(async (req, res, next) => {
  const { contentType, postId, commentId, userId, subredditId, reason, subredditRuleId } = req.body;

  // contentType kontrolü
  if (!['post', 'comment', 'user', 'subreddit'].includes(contentType)) {
    return next(new ErrorResponse('Geçersiz içerik tipi', 400));
  }

  // ID formatı kontrolü
  let contentId;
  let contentModel;

  switch (contentType) {
    case 'post':
      contentId = postId;
      contentModel = Post;
      break;
    case 'comment':
      contentId = commentId;
      contentModel = Comment;
      break;
    case 'user':
      contentId = userId;
      contentModel = User;
      break;
    case 'subreddit':
      contentId = subredditId;
      contentModel = Subreddit;
      break;
  }

  if (!contentId || !mongoose.Types.ObjectId.isValid(contentId)) {
    return next(new ErrorResponse(`Geçerli bir ${contentType} ID'si belirtilmelidir`, 400));
  }

  // Raporlanan içeriğin varlığını kontrol et
  const content = await contentModel.findById(contentId);
  if (!content) {
    return next(new ErrorResponse(`Raporlanan ${contentType} bulunamadı`, 404));
  }

  // Rapor sebebi kontrolü
  if (!reason || reason.trim().length === 0) {
    return next(new ErrorResponse('Rapor sebebi gereklidir', 400));
  }

  // Subreddit kuralı kontrolü
  if (subredditRuleId) {
    if (!mongoose.Types.ObjectId.isValid(subredditRuleId)) {
      return next(new ErrorResponse('Geçersiz subreddit kuralı ID formatı', 400));
    }

    const rule = await SubredditRule.findById(subredditRuleId);
    if (!rule) {
      return next(new ErrorResponse('Belirtilen subreddit kuralı bulunamadı', 404));
    }
  }

  // Kendi içeriğini raporlamayı engelle
  if (
    (contentType === 'post' && content.author.toString() === req.user._id.toString()) ||
    (contentType === 'comment' && content.author.toString() === req.user._id.toString()) ||
    (contentType === 'user' && contentId === req.user._id.toString())
  ) {
    return next(new ErrorResponse('Kendi içeriğinizi raporlayamazsınız', 400));
  }

  // Önceden yapılmış rapor var mı kontrol et
  const existingReport = await Report.findOne({
    reporter: req.user._id,
    contentType,
    [contentType]: contentId,
  });

  if (existingReport) {
    return next(new ErrorResponse('Bu içeriği zaten raporlamışsınız', 400));
  }

  // Rapor verisini hazırla
  const reportData = {
    reporter: req.user._id,
    contentType,
    reason,
    status: 'pending',
  };

  // İçerik tipine göre ilgili alanı ekle
  reportData[contentType] = contentId;

  // Subreddit kuralı varsa ekle
  if (subredditRuleId) {
    reportData.subredditRule = subredditRuleId;
  }

  // Subreddit bilgisini ekle (post veya comment için)
  if (contentType === 'post') {
    reportData.subreddit = content.subreddit;
  } else if (contentType === 'comment') {
    const post = await Post.findById(content.post);
    if (post) {
      reportData.subreddit = post.subreddit;
    }
  }

  // Raporu oluştur
  const report = await Report.create(reportData);

  res.status(201).json({
    success: true,
    data: report,
    message: 'Rapor başarıyla oluşturuldu',
  });
});

/**
 * @desc    Raporları listele (filtreleme ve sayfalama ile)
 * @route   GET /api/reports
 * @access  Private (Admin/Moderatör)
 */
const getReports = asyncHandler(async (req, res, next) => {
  const { contentType, status, subredditId, reporterId } = req.query;

  // Sayfalama için
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 25;
  const startIndex = (page - 1) * limit;

  // Filtreleme sorgusu
  let query = {};

  // İçerik tipi filtresi
  if (contentType && ['post', 'comment', 'user', 'subreddit'].includes(contentType)) {
    query.contentType = contentType;
  }

  // Durum filtresi
  if (status && ['pending', 'approved', 'rejected', 'spam'].includes(status)) {
    query.status = status;
  }

  // Subreddit filtresi
  if (subredditId && mongoose.Types.ObjectId.isValid(subredditId)) {
    query.subreddit = subredditId;
  }

  // Raporlayan kullanıcı filtresi
  if (reporterId && mongoose.Types.ObjectId.isValid(reporterId)) {
    query.reporter = reporterId;
  }

  // Admin veya global moderatör değilse, sadece moderatör olduğu subredditlerin raporlarını görebilir
  if (req.user.role !== 'admin') {
    // Kullanıcının moderatör olduğu subreddit ID'lerini bul
    const moderatedSubreddits = await SubredditMembership.find({
      user: req.user._id,
      type: { $in: ['moderator', 'admin'] },
      status: 'active',
    }).select('subreddit');

    const subredditIds = moderatedSubreddits.map((membership) => membership.subreddit);

    if (subredditIds.length === 0) {
      return res.status(200).json({
        success: true,
        count: 0,
        pagination: {
          page,
          limit,
          totalPages: 0,
          totalDocs: 0,
        },
        data: [],
      });
    }

    // Mevcut sorguya moderatör olduğu subreddit filtresi ekle
    query.subreddit = { $in: subredditIds };
  }

  // Toplam rapor sayısını al
  const total = await Report.countDocuments(query);

  // Raporları getir
  const reports = await Report.find(query)
    .sort({ createdAt: -1 })
    .skip(startIndex)
    .limit(limit)
    .populate('reporter', 'username profilePicture')
    .populate('post', 'title type')
    .populate('comment', 'content')
    .populate('user', 'username')
    .populate('subreddit', 'name title')
    .populate('subredditRule', 'title description')
    .populate('handledBy', 'username');

  // Sayfalama bilgisi
  const pagination = {
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    totalDocs: total,
  };

  if (startIndex + limit < total) {
    pagination.next = {
      page: page + 1,
      limit,
    };
  }

  if (startIndex > 0) {
    pagination.prev = {
      page: page - 1,
      limit,
    };
  }

  res.status(200).json({
    success: true,
    count: reports.length,
    pagination,
    data: reports,
  });
});

/**
 * @desc    Rapor detayını getir
 * @route   GET /api/reports/:id
 * @access  Private (Admin/Moderatör)
 */
const getReportById = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorResponse('Geçersiz rapor ID formatı', 400));
  }

  const report = await Report.findById(id)
    .populate('reporter', 'username profilePicture email')
    .populate({
      path: 'post',
      select: 'title content type url mediaUrl author subreddit createdAt',
      populate: [
        { path: 'author', select: 'username profilePicture' },
        { path: 'subreddit', select: 'name title' },
      ],
    })
    .populate({
      path: 'comment',
      select: 'content post author createdAt',
      populate: [
        { path: 'author', select: 'username profilePicture' },
        {
          path: 'post',
          select: 'title subreddit',
          populate: { path: 'subreddit', select: 'name' },
        },
      ],
    })
    .populate('user', 'username email profilePicture createdAt karma')
    .populate('subreddit', 'name title description createdAt subscriberCount')
    .populate('subredditRule', 'title description')
    .populate('handledBy', 'username email');

  if (!report) {
    return next(new ErrorResponse('Rapor bulunamadı', 404));
  }

  // Yetki kontrolü
  if (req.user.role !== 'admin') {
    // Kullanıcının bu raporun bağlı olduğu subreddit için moderatör yetkisi var mı?
    const isModerator = await SubredditMembership.findOne({
      user: req.user._id,
      subreddit: report.subreddit._id,
      type: { $in: ['moderator', 'admin'] },
      status: 'active',
    });

    if (!isModerator) {
      return next(new ErrorResponse('Bu raporu görüntüleme yetkiniz yok', 403));
    }
  }

  res.status(200).json({
    success: true,
    data: report,
  });
});

/**
 * @desc    Rapor durumunu güncelle
 * @route   PUT /api/reports/:id
 * @access  Private (Admin/Moderatör)
 */
const updateReportStatus = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { status, actionTaken, actionDetails } = req.body;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorResponse('Geçersiz rapor ID formatı', 400));
  }

  // Status kontrolü
  if (!['pending', 'approved', 'rejected', 'spam'].includes(status)) {
    return next(new ErrorResponse('Geçersiz rapor durumu', 400));
  }

  // Action kontrolü
  if (actionTaken && !['none', 'removed', 'banned', 'warned', 'other'].includes(actionTaken)) {
    return next(new ErrorResponse('Geçersiz işlem türü', 400));
  }

  const report = await Report.findById(id);

  if (!report) {
    return next(new ErrorResponse('Rapor bulunamadı', 404));
  }

  // Yetki kontrolü
  if (req.user.role !== 'admin') {
    // Kullanıcının bu raporun bağlı olduğu subreddit için moderatör yetkisi var mı?
    const isModerator = await SubredditMembership.findOne({
      user: req.user._id,
      subreddit: report.subreddit,
      type: { $in: ['moderator', 'admin'] },
      status: 'active',
    });

    if (!isModerator) {
      return next(new ErrorResponse('Bu raporu güncelleme yetkiniz yok', 403));
    }
  }

  // Raporu güncelle
  report.status = status;

  // Eğer işlem alındıysa
  if (actionTaken) {
    report.actionTaken = actionTaken;
  }

  // Eğer işlem detayı varsa
  if (actionDetails) {
    report.actionDetails = actionDetails;
  }

  // İşleyen kişi ve zaman bilgisini güncelle
  report.handledBy = req.user._id;
  report.handledAt = Date.now();

  await report.save();

  // Eğer bir admin işlemi ise, admin loguna kaydet
  if (req.user.role === 'admin') {
    await ModLog.create({
      user: req.user._id,
      subreddit: report.subreddit, // Raporun bağlı olduğu subreddit veya global eylemler için null
      action: 'update_report_status',
      targetType: 'report',
      targetId: report._id,
      details: `Rapor ID: ${id}, Durum: ${status}, İşlem: ${actionTaken || 'none'}`,
    });
  } else {
    // Moderasyon logu
    await ModLog.create({
      user: req.user._id,
      subreddit: report.subreddit,
      action: 'update_report',
      targetType: report.contentType,
      targetId: report[report.contentType],
      details: `Rapor durumu "${status}" olarak güncellendi. İşlem: ${actionTaken || 'none'}`,
    });
  }

  // Güncellenmiş raporu gönder
  const updatedReport = await Report.findById(id)
    .populate('reporter', 'username profilePicture')
    .populate('handledBy', 'username');

  res.status(200).json({
    success: true,
    data: updatedReport,
    message: 'Rapor durumu başarıyla güncellendi',
  });
});

/**
 * @desc    Belirli bir subreddit için raporları getir
 * @route   GET /api/subreddits/:subredditId/reports
 * @access  Private (Subreddit Moderatörü/Admin)
 */
const getSubredditReports = asyncHandler(async (req, res, next) => {
  const { subredditId } = req.params;
  const { status, contentType } = req.query;

  if (!mongoose.Types.ObjectId.isValid(subredditId)) {
    return next(new ErrorResponse('Geçersiz subreddit ID formatı', 400));
  }

  // Subreddit'in varlığını kontrol et
  const subreddit = await Subreddit.findById(subredditId);
  if (!subreddit) {
    return next(new ErrorResponse('Subreddit bulunamadı', 404));
  }

  // Yetki kontrolü - Admin veya moderatör olmalı
  if (req.user.role !== 'admin') {
    const isModerator = await SubredditMembership.findOne({
      user: req.user._id,
      subreddit: subredditId,
      type: { $in: ['moderator', 'admin'] },
      status: 'active',
    });

    if (!isModerator) {
      return next(new ErrorResponse('Bu subreddit raporlarını görüntüleme yetkiniz yok', 403));
    }
  }

  // Sayfalama için
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 25;
  const startIndex = (page - 1) * limit;

  // Filtreleme sorgusu
  let query = { subreddit: subredditId };

  // Durum filtresi
  if (status && ['pending', 'approved', 'rejected', 'spam'].includes(status)) {
    query.status = status;
  }

  // İçerik tipi filtresi
  if (contentType && ['post', 'comment', 'user'].includes(contentType)) {
    query.contentType = contentType;
  }

  // Toplam rapor sayısını al
  const total = await Report.countDocuments(query);

  // Raporları getir
  const reports = await Report.find(query)
    .sort({ createdAt: -1 })
    .skip(startIndex)
    .limit(limit)
    .populate('reporter', 'username profilePicture')
    .populate('post', 'title type')
    .populate('comment', 'content')
    .populate('user', 'username')
    .populate('subredditRule', 'title')
    .populate('handledBy', 'username');

  // Sayfalama bilgisi
  const pagination = {
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    totalDocs: total,
  };

  if (startIndex + limit < total) {
    pagination.next = {
      page: page + 1,
      limit,
    };
  }

  if (startIndex > 0) {
    pagination.prev = {
      page: page - 1,
      limit,
    };
  }

  res.status(200).json({
    success: true,
    count: reports.length,
    pagination,
    data: reports,
  });
});

/**
 * @desc    Kullanıcının oluşturduğu raporları getir
 * @route   GET /api/users/:userId/reports
 * @access  Private (Kendisi veya Admin)
 */
const getUserReports = asyncHandler(async (req, res, next) => {
  const { userId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(userId)) {
    return next(new ErrorResponse('Geçersiz kullanıcı ID formatı', 400));
  }

  // Yetki kontrolü - Kendisi veya admin olmalı
  if (userId !== req.user._id.toString() && req.user.role !== 'admin') {
    return next(
      new ErrorResponse('Başka bir kullanıcının raporlarını görüntüleme yetkiniz yok', 403),
    );
  }

  // Sayfalama için
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 25;
  const startIndex = (page - 1) * limit;

  // Toplam rapor sayısını al
  const total = await Report.countDocuments({ reporter: userId });

  // Raporları getir
  const reports = await Report.find({ reporter: userId })
    .sort({ createdAt: -1 })
    .skip(startIndex)
    .limit(limit)
    .populate('post', 'title type')
    .populate('comment', 'content')
    .populate('user', 'username')
    .populate('subreddit', 'name title')
    .populate('subredditRule', 'title')
    .populate('handledBy', 'username');

  // Sayfalama bilgisi
  const pagination = {
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    totalDocs: total,
  };

  if (startIndex + limit < total) {
    pagination.next = {
      page: page + 1,
      limit,
    };
  }

  if (startIndex > 0) {
    pagination.prev = {
      page: page - 1,
      limit,
    };
  }

  res.status(200).json({
    success: true,
    count: reports.length,
    pagination,
    data: reports,
  });
});

/**
 * @desc    Subreddit rapor istatistiklerini getir
 * @route   GET /api/subreddits/:subredditId/reports/stats
 * @access  Private (Moderatör/Admin)
 */
const getSubredditReportStats = asyncHandler(async (req, res, next) => {
  const { subredditId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(subredditId)) {
    return next(new ErrorResponse('Geçersiz subreddit ID formatı', 400));
  }

  // Subreddit'in varlığını kontrol et
  const subreddit = await Subreddit.findById(subredditId);
  if (!subreddit) {
    return next(new ErrorResponse('Subreddit bulunamadı', 404));
  }

  // Yetki kontrolü
  if (req.user.role !== 'admin') {
    const isModerator = await SubredditMembership.findOne({
      user: req.user._id,
      subreddit: subredditId,
      type: { $in: ['moderator', 'admin'] },
      status: 'active',
    });

    if (!isModerator) {
      return next(new ErrorResponse('Bu subreddit istatistiklerini görüntüleme yetkiniz yok', 403));
    }
  }

  // Durum bazlı rapor sayıları
  const statusCounts = await Report.aggregate([
    { $match: { subreddit: mongoose.Types.ObjectId(subredditId) } },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);

  // İçerik tipi bazlı rapor sayıları
  const contentTypeCounts = await Report.aggregate([
    { $match: { subreddit: mongoose.Types.ObjectId(subredditId) } },
    { $group: { _id: '$contentType', count: { $sum: 1 } } },
  ]);

  // Alınan aksiyon bazlı rapor sayıları
  const actionCounts = await Report.aggregate([
    { $match: { subreddit: mongoose.Types.ObjectId(subredditId) } },
    { $group: { _id: '$actionTaken', count: { $sum: 1 } } },
  ]);

  // Zaman içindeki rapor trendi (son 30 gün)
  const reportTrend = await Report.aggregate([
    { $match: { subreddit: mongoose.Types.ObjectId(subredditId) } },
    {
      $group: {
        _id: {
          $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
        },
        count: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
    { $limit: 30 },
  ]);

  // En çok raporlanan kurallar
  const topRules = await Report.aggregate([
    {
      $match: {
        subreddit: mongoose.Types.ObjectId(subredditId),
        subredditRule: { $exists: true, $ne: null },
      },
    },
    { $group: { _id: '$subredditRule', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 10 },
  ]);

  // Kural ID'lerini çek
  const ruleIds = topRules.map((rule) => rule._id);

  // Kural detaylarını getir
  const ruleDetails = await SubredditRule.find({
    _id: { $in: ruleIds },
  }).select('title description');

  // Kural detaylarını istatistiklere ekle
  const rulesWithDetails = topRules.map((rule) => {
    const ruleDetail = ruleDetails.find((detail) => detail._id.toString() === rule._id.toString());
    return {
      _id: rule._id,
      count: rule.count,
      title: ruleDetail ? ruleDetail.title : 'Silinmiş Kural',
      description: ruleDetail ? ruleDetail.description : '',
    };
  });

  // En aktif moderatörler
  const topModerators = await Report.aggregate([
    {
      $match: {
        subreddit: mongoose.Types.ObjectId(subredditId),
        handledBy: { $exists: true, $ne: null },
      },
    },
    { $group: { _id: '$handledBy', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 10 },
  ]);

  // Moderatör ID'lerini çek
  const moderatorIds = topModerators.map((mod) => mod._id);

  // Moderatör detaylarını getir
  const moderatorDetails = await User.find({
    _id: { $in: moderatorIds },
  }).select('username profilePicture');

  // Moderatör detaylarını istatistiklere ekle
  const moderatorsWithDetails = topModerators.map((mod) => {
    const modDetail = moderatorDetails.find(
      (detail) => detail._id.toString() === mod._id.toString(),
    );
    return {
      _id: mod._id,
      count: mod.count,
      username: modDetail ? modDetail.username : 'Silinmiş Kullanıcı',
      profilePicture: modDetail ? modDetail.profilePicture : null,
    };
  });

  res.status(200).json({
    success: true,
    data: {
      statusCounts: statusCounts.reduce((obj, item) => {
        obj[item._id] = item.count;
        return obj;
      }, {}),
      contentTypeCounts: contentTypeCounts.reduce((obj, item) => {
        obj[item._id] = item.count;
        return obj;
      }, {}),
      actionCounts: actionCounts.reduce((obj, item) => {
        obj[item._id || 'none'] = item.count;
        return obj;
      }, {}),
      reportTrend,
      topRules: rulesWithDetails,
      topModerators: moderatorsWithDetails,
      total: await Report.countDocuments({ subreddit: subredditId }),
    },
  });
});

/**
 * @desc    Toplu rapor işlemi (çoklu rapor durumunu güncelle)
 * @route   PUT /api/reports/bulk
 * @access  Private (Admin/Moderatör)
 */
const bulkUpdateReports = asyncHandler(async (req, res, next) => {
  const { reportIds, status, actionTaken, actionDetails } = req.body;

  if (!reportIds || !Array.isArray(reportIds) || reportIds.length === 0) {
    return next(new ErrorResponse('Geçerli rapor ID listesi gereklidir', 400));
  }

  // Status kontrolü
  if (!['pending', 'approved', 'rejected', 'spam'].includes(status)) {
    return next(new ErrorResponse('Geçersiz rapor durumu', 400));
  }

  // Action kontrolü
  if (actionTaken && !['none', 'removed', 'banned', 'warned', 'other'].includes(actionTaken)) {
    return next(new ErrorResponse('Geçersiz işlem türü', 400));
  }

  // ID formatlarını kontrol et
  const validIds = reportIds.filter((id) => mongoose.Types.ObjectId.isValid(id));

  if (validIds.length !== reportIds.length) {
    return next(new ErrorResponse("Listedeki bazı rapor ID'leri geçersiz", 400));
  }

  // Raporları bul
  const reports = await Report.find({ _id: { $in: validIds } });

  if (reports.length === 0) {
    return next(new ErrorResponse("Belirtilen ID'lerle eşleşen rapor bulunamadı", 404));
  }

  // Admin değilse, sadece yetki sahibi olduğu subreddit raporlarını güncelleyebilir
  if (req.user.role !== 'admin') {
    // Kullanıcının moderatör olduğu subreddit ID'lerini bul
    const moderatedSubreddits = await SubredditMembership.find({
      user: req.user._id,
      type: { $in: ['moderator', 'admin'] },
      status: 'active',
    }).select('subreddit');

    const subredditIds = moderatedSubreddits.map((membership) => membership.subreddit.toString());

    // Kullanıcının moderatör olmadığı subreddit raporları var mı kontrol et
    const unauthorizedReports = reports.filter(
      (report) => report.subreddit && !subredditIds.includes(report.subreddit.toString()),
    );

    if (unauthorizedReports.length > 0) {
      return next(new ErrorResponse('Bazı raporları güncelleme yetkiniz yok', 403));
    }
  }

  // Transaction başlat
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Raporları güncelle
    const updatePromises = reports.map((report) => {
      report.status = status;
      if (actionTaken) report.actionTaken = actionTaken;
      if (actionDetails) report.actionDetails = actionDetails;
      report.handledBy = req.user._id;
      report.handledAt = Date.now();

      return report.save({ session });
    });

    await Promise.all(updatePromises);

    // Moderasyon logları oluştur
    const logPromises = reports.map((report) => {
      return ModLog.create(
        [
          {
            user: req.user._id,
            subreddit: report.subreddit,
            action: 'bulk_update_reports',
            targetType: report.contentType,
            targetId: report[report.contentType],
            details: `Rapor durumu "${status}" olarak güncellendi. İşlem: ${actionTaken || 'none'}`,
          },
        ],
        { session },
      );
    });

    await Promise.all(logPromises);

    // Admin işlemi kaydı
    if (req.user.role === 'admin') {
      await AdminLog.create(
        [
          {
            user: req.user._id,
            action: 'bulk_update_reports',
            details: `${reports.length} rapor durumu "${status}" olarak güncellendi. İşlem: ${actionTaken || 'none'}`,
            ip: req.ip,
          },
        ],
        { session },
      );
    }

    await session.commitTransaction();

    res.status(200).json({
      success: true,
      message: `${reports.length} rapor başarıyla güncellendi`,
      data: {
        count: reports.length,
        status,
        actionTaken: actionTaken || 'none',
      },
    });
  } catch (error) {
    await session.abortTransaction();
    return next(new ErrorResponse('Raporlar güncellenirken bir hata oluştu', 500));
  } finally {
    session.endSession();
  }
});

/**
 * @desc    Raporu sil (sadece admin)
 * @route   DELETE /api/reports/:id
 * @access  Private (Admin)
 */
const deleteReport = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorResponse('Geçersiz rapor ID formatı', 400));
  }

  const report = await Report.findById(id);

  if (!report) {
    return next(new ErrorResponse('Rapor bulunamadı', 404));
  }

  // Sadece adminler rapor silebilir
  if (req.user.role !== 'admin') {
    return next(new ErrorResponse('Rapor silme işlemi için admin yetkisi gereklidir', 403));
  }

  await report.remove();

  // Admin log kaydı
  await AdminLog.create({
    user: req.user._id,
    action: 'delete_report',
    details: `Rapor silindi: ID ${id}, İçerik Tipi: ${report.contentType}`,
    ip: req.ip,
  });

  res.status(200).json({
    success: true,
    data: {},
    message: 'Rapor başarıyla silindi',
  });
});

/**
 * @desc    Genel rapor istatistiklerini getir (admin için)
 * @route   GET /api/reports/stats
 * @access  Private (Admin)
 */
const getReportStats = asyncHandler(async (req, res, next) => {
  // Durum bazlı rapor sayıları
  const statusCounts = await Report.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]);

  // İçerik tipi bazlı rapor sayıları
  const contentTypeCounts = await Report.aggregate([
    { $group: { _id: '$contentType', count: { $sum: 1 } } },
  ]);

  // Alınan aksiyon bazlı rapor sayıları
  const actionCounts = await Report.aggregate([
    { $group: { _id: '$actionTaken', count: { $sum: 1 } } },
  ]);

  // En çok rapor alan subredditler
  const topSubreddits = await Report.aggregate([
    { $match: { subreddit: { $exists: true, $ne: null } } },
    { $group: { _id: '$subreddit', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 10 },
  ]);

  // Subreddit ID'lerini çek
  const subredditIds = topSubreddits.map((sub) => sub._id);

  // Subreddit detaylarını getir
  const subredditDetails = await Subreddit.find({
    _id: { $in: subredditIds },
  }).select('name title subscriberCount');

  // Subreddit detaylarını istatistiklere ekle
  const subredditsWithDetails = topSubreddits.map((sub) => {
    const subDetail = subredditDetails.find(
      (detail) => detail._id.toString() === sub._id.toString(),
    );
    return {
      _id: sub._id,
      count: sub.count,
      name: subDetail ? subDetail.name : 'Silinmiş Subreddit',
      title: subDetail ? subDetail.title : null,
      subscriberCount: subDetail ? subDetail.subscriberCount : 0,
    };
  });

  // Zaman içindeki rapor trendi (son 30 gün)
  const reportTrend = await Report.aggregate([
    {
      $group: {
        _id: {
          $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
        },
        count: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
    { $limit: 30 },
  ]);

  // En aktif moderatörler
  const topModerators = await Report.aggregate([
    { $match: { handledBy: { $exists: true, $ne: null } } },
    { $group: { _id: '$handledBy', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 10 },
  ]);

  // Moderatör ID'lerini çek
  const moderatorIds = topModerators.map((mod) => mod._id);

  // Moderatör detaylarını getir
  const moderatorDetails = await User.find({
    _id: { $in: moderatorIds },
  }).select('username profilePicture role');

  // Moderatör detaylarını istatistiklere ekle
  const moderatorsWithDetails = topModerators.map((mod) => {
    const modDetail = moderatorDetails.find(
      (detail) => detail._id.toString() === mod._id.toString(),
    );
    return {
      _id: mod._id,
      count: mod.count,
      username: modDetail ? modDetail.username : 'Silinmiş Kullanıcı',
      profilePicture: modDetail ? modDetail.profilePicture : null,
      role: modDetail ? modDetail.role : null,
    };
  });

  // En çok rapor eden kullanıcılar
  const topReporters = await Report.aggregate([
    { $group: { _id: '$reporter', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 10 },
  ]);

  // Kullanıcı ID'lerini çek
  const reporterIds = topReporters.map((rep) => rep._id);

  // Kullanıcı detaylarını getir
  const reporterDetails = await User.find({
    _id: { $in: reporterIds },
  }).select('username profilePicture');

  // Kullanıcı detaylarını istatistiklere ekle
  const reportersWithDetails = topReporters.map((rep) => {
    const userDetail = reporterDetails.find(
      (detail) => detail._id.toString() === rep._id.toString(),
    );
    return {
      _id: rep._id,
      count: rep.count,
      username: userDetail ? userDetail.username : 'Silinmiş Kullanıcı',
      profilePicture: userDetail ? userDetail.profilePicture : null,
    };
  });

  res.status(200).json({
    success: true,
    data: {
      statusCounts: statusCounts.reduce((obj, item) => {
        obj[item._id] = item.count;
        return obj;
      }, {}),
      contentTypeCounts: contentTypeCounts.reduce((obj, item) => {
        obj[item._id] = item.count;
        return obj;
      }, {}),
      actionCounts: actionCounts.reduce((obj, item) => {
        obj[item._id || 'none'] = item.count;
        return obj;
      }, {}),
      topSubreddits: subredditsWithDetails,
      reportTrend,
      topModerators: moderatorsWithDetails,
      topReporters: reportersWithDetails,
      total: await Report.countDocuments(),
    },
  });
});

module.exports = {
  createReport,
  getReports,
  getReportById,
  updateReportStatus,
  getSubredditReports,
  getUserReports,
  getSubredditReportStats,
  bulkUpdateReports,
  deleteReport,
  getReportStats,
};
