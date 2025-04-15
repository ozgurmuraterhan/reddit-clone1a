const {
  Report,
  Post,
  Comment,
  User,
  Subreddit,
  SubredditMembership,
  ModLog,
  Notification,
} = require('../models');

/**
 * İçerik rapor et
 * @route POST /api/reports
 * @access Private
 */
const createReport = async (req, res) => {
  try {
    const { itemType, itemId, reason, details, ruleId } = req.body;
    const userId = req.user._id;

    // Rapor türünü doğrula
    if (!['post', 'comment'].includes(itemType)) {
      return res.status(400).json({
        success: false,
        message: 'Geçersiz öğe türü. "post" veya "comment" olmalıdır.',
      });
    }

    // İçeriği bul
    let reportedItem;
    let subredditId;
    let authorId;

    if (itemType === 'post') {
      reportedItem = await Post.findById(itemId);
      if (reportedItem) {
        subredditId = reportedItem.subreddit;
        authorId = reportedItem.author;
      }
    } else {
      reportedItem = await Comment.findById(itemId);
      if (reportedItem) {
        const post = await Post.findById(reportedItem.post);
        subredditId = post ? post.subreddit : null;
        authorId = reportedItem.author;
      }
    }

    if (!reportedItem) {
      return res.status(404).json({
        success: false,
        message: 'Rapor edilecek içerik bulunamadı',
      });
    }

    // Kendi içeriğini rapor edemez
    if (authorId.toString() === userId.toString()) {
      return res.status(400).json({
        success: false,
        message: 'Kendi içeriğinizi rapor edemezsiniz',
      });
    }

    // Daha önce rapor edilmiş mi kontrol et
    const existingReport = await Report.findOne({
      reporter: userId,
      itemType,
      [itemType]: itemId,
    });

    if (existingReport) {
      return res.status(400).json({
        success: false,
        message: 'Bu içeriği zaten rapor ettiniz',
      });
    }

    // Rapor oluştur
    const newReport = await Report.create({
      reporter: userId,
      itemType,
      [itemType]: itemId,
      reason,
      details,
      rule: ruleId,
      subreddit: subredditId,
    });

    // Subreddit moderatörlerine bildirim gönder
    if (subredditId) {
      const moderators = await SubredditMembership.find({
        subreddit: subredditId,
        status: { $in: ['moderator', 'admin'] },
      }).select('user');

      const moderatorIds = moderators.map((mod) => mod.user);

      // Her moderatöre bildirim oluştur
      const notifications = moderatorIds.map((modId) => ({
        type: 'report',
        recipient: modId,
        sender: userId,
        subreddit: subredditId,
        relatedReport: newReport._id,
        [itemType === 'post' ? 'relatedPost' : 'relatedComment']: itemId,
        message: `Yeni bir ${itemType === 'post' ? 'gönderi' : 'yorum'} raporu: ${reason}`,
      }));

      await Notification.insertMany(notifications);
    }

    res.status(201).json({
      success: true,
      message: 'İçerik başarıyla rapor edildi',
      data: newReport,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Rapor oluşturulurken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * Subreddit raporlarını getir (moderatörler için)
 * @route GET /api/subreddits/:subredditName/reports
 * @access Private/Moderator
 */
const getSubredditReports = async (req, res) => {
  try {
    const { subredditName } = req.params;
    const userId = req.user._id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const { status } = req.query; // 'open', 'approved', 'rejected'

    // Subreddit'i bul
    const subreddit = await Subreddit.findOne({ name: subredditName });

    if (!subreddit) {
      return res.status(404).json({
        success: false,
        message: 'Subreddit bulunamadı',
      });
    }

    // Kullanıcının moderatör olup olmadığını kontrol et
    const isModerator = await isUserModerator(userId, subreddit._id);
    if (!isModerator) {
      return res.status(403).json({
        success: false,
        message: 'Bu işlem için moderatör yetkiniz bulunmamaktadır',
      });
    }

    // Filtre oluştur
    const filter = { subreddit: subreddit._id };
    if (status) {
      filter.status = status;
    }

    // Raporları getir
    const reports = await Report.find(filter)
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 })
      .populate('reporter', 'username profilePicture')
      .populate('post', 'title content')
      .populate('comment', 'content')
      .populate('rule', 'title')
      .populate('resolver', 'username profilePicture');

    const totalReports = await Report.countDocuments(filter);

    res.status(200).json({
      success: true,
      count: reports.length,
      total: totalReports,
      totalPages: Math.ceil(totalReports / limit),
      currentPage: page,
      data: reports,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Raporlar getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * Raporu işle (moderatör)
 * @route PUT /api/reports/:reportId
 * @access Private/Moderator
 */
const processReport = async (req, res) => {
  try {
    const { reportId } = req.params;
    const { action, note } = req.body; // 'approve', 'reject', 'ignore'
    const userId = req.user._id;

    // Raporu bul
    const report = await Report.findById(reportId);

    if (!report) {
      return res.status(404).json({
        success: false,
        message: 'Rapor bulunamadı',
      });
    }

    // Kullanıcının moderatör olup olmadığını kontrol et
    const isModerator = await isUserModerator(userId, report.subreddit);
    if (!isModerator) {
      return res.status(403).json({
        success: false,
        message: 'Bu işlem için moderatör yetkiniz bulunmamaktadır',
      });
    }

    // Aksiyon türünü doğrula
    if (!['approve', 'reject', 'ignore'].includes(action)) {
      return res.status(400).json({
        success: false,
        message: 'Geçersiz aksiyon. "approve", "reject" veya "ignore" olmalıdır.',
      });
    }

    // Raporu güncelle
    report.status =
      action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'ignored';
    report.resolver = userId;
    report.resolvedAt = Date.now();
    report.resolverNote = note || '';

    await report.save();

    // İçeriği aksiyon türüne göre işle
    if (action === 'approve') {
      // İçeriği kaldır
      if (report.itemType === 'post') {
        await Post.findByIdAndUpdate(report.post, {
          isRemoved: true,
          removedBy: userId,
          removedAt: Date.now(),
          removalReason: report.reason,
        });
      } else {
        await Comment.findByIdAndUpdate(report.comment, {
          isRemoved: true,
          removedBy: userId,
          removedAt: Date.now(),
          removalReason: report.reason,
        });
      }
    }

    // Mod log oluştur
    await ModLog.create({
      subreddit: report.subreddit,
      moderator: userId,
      action: `report_${report.status}`,
      details: `${report.status} report for ${report.reason}`,
      [report.itemType === 'post' ? 'targetPost' : 'targetComment']: report[report.itemType],
    });

    res.status(200).json({
      success: true,
      message: `Rapor başarıyla ${report.status} olarak işlendi`,
      data: report,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Rapor işlenirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * Kullanıcının moderatör olup olmadığını kontrol et
 * @param {ObjectId} userId
 * @param {ObjectId} subredditId
 * @returns {Promise<Boolean>}
 */
const isUserModerator = async (userId, subredditId) => {
  const membership = await SubredditMembership.findOne({
    user: userId,
    subreddit: subredditId,
    status: { $in: ['moderator', 'admin'] },
  });

  return !!membership;
};

module.exports = {
  createReport,
  getSubredditReports,
  processReport,
};
