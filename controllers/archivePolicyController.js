const mongoose = require('mongoose');
const {
  ArchivePolicy,
  Subreddit,
  SubredditMembership,
  Post,
  Comment,
  ModLog,
} = require('../models');
const ErrorResponse = require('../utils/errorResponse');
const asyncHandler = require('../middleware/async');

/**
 * @desc    Arşiv politikalarını getir
 * @route   GET /api/archive-policies
 * @route   GET /api/subreddits/:subredditId/archive-policies
 * @access  Public (Görüntüleme için) / Private (Subreddit mod veya Admin)
 */
const getArchivePolicies = asyncHandler(async (req, res, next) => {
  const { subredditId } = req.params;
  let query = {};

  // Subreddit spesifik politikalar veya site geneli politikalar
  if (subredditId) {
    if (!mongoose.Types.ObjectId.isValid(subredditId)) {
      return next(new ErrorResponse('Geçersiz subreddit ID formatı', 400));
    }

    // Subreddit'in var olup olmadığını kontrol et
    const subreddit = await Subreddit.findById(subredditId);
    if (!subreddit) {
      return next(new ErrorResponse('Subreddit bulunamadı', 404));
    }

    query.scope = 'subreddit';
    query.subreddit = subredditId;
  } else {
    // Hiç subreddit belirtilmezse hem site geneli hem de kullanıcının moderatör olduğu subreddit'lerin politikalarını getir
    if (req.user) {
      const userModeratedSubreddits = await SubredditMembership.find({
        user: req.user._id,
        type: 'moderator',
      }).select('subreddit');

      const moderatedSubredditIds = userModeratedSubreddits.map(
        (membership) => membership.subreddit,
      );

      if (req.user.role === 'admin') {
        // Admin tüm politikaları görebilir
        query = {};
      } else {
        // Normal kullanıcı sadece site geneli ve moderatör olduğu subreddit'lerin politikalarını görebilir
        query = {
          $or: [
            { scope: 'site' },
            { scope: 'subreddit', subreddit: { $in: moderatedSubredditIds } },
          ],
        };
      }
    } else {
      // Giriş yapmamış kullanıcılar sadece site geneli politikaları görebilir
      query.scope = 'site';
    }
  }

  // İsteğe bağlı filtreler
  if (req.query.contentType && ['post', 'comment', 'all'].includes(req.query.contentType)) {
    query.contentType = req.query.contentType;
  }

  if (req.query.isActive !== undefined) {
    query.isActive = req.query.isActive === 'true';
  }

  // Politikaları getir
  const archivePolicies = await ArchivePolicy.find(query)
    .populate('subreddit', 'name title')
    .populate('createdBy', 'username');

  res.status(200).json({
    success: true,
    count: archivePolicies.length,
    data: archivePolicies,
  });
});

/**
 * @desc    Belirli bir arşiv politikasını getir
 * @route   GET /api/archive-policies/:id
 * @access  Public (Görüntüleme için) / Private (Subreddit mod veya Admin)
 */
const getArchivePolicy = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorResponse('Geçersiz politika ID formatı', 400));
  }

  const archivePolicy = await ArchivePolicy.findById(id)
    .populate('subreddit', 'name title')
    .populate('createdBy', 'username');

  if (!archivePolicy) {
    return next(new ErrorResponse('Arşiv politikası bulunamadı', 404));
  }

  // Yetki kontrolü
  if (archivePolicy.scope === 'subreddit' && req.user && req.user.role !== 'admin') {
    const isModerator = await SubredditMembership.findOne({
      user: req.user._id,
      subreddit: archivePolicy.subreddit._id,
      type: 'moderator',
    });

    if (!isModerator) {
      return next(new ErrorResponse('Bu arşiv politikasını görüntüleme yetkiniz yok', 403));
    }
  }

  res.status(200).json({
    success: true,
    data: archivePolicy,
  });
});

/**
 * @desc    Yeni arşiv politikası oluştur
 * @route   POST /api/archive-policies
 * @route   POST /api/subreddits/:subredditId/archive-policies
 * @access  Private (Subreddit mod veya Admin)
 */
const createArchivePolicy = asyncHandler(async (req, res, next) => {
  const { subredditId } = req.params;
  const {
    scope,
    subredditIdFromBody,
    contentType = 'all',
    archiveAfterDays,
    actions = {},
    isActive = true,
  } = req.body;

  // Kullanıcı giriş yapmış mı kontrol et
  if (!req.user) {
    return next(new ErrorResponse('Bu işlem için giriş yapmalısınız', 401));
  }

  // Verilen subreddit parametrelerine göre scope belirle
  let finalScope = scope;
  let finalSubredditId = subredditId || subredditIdFromBody;

  if (finalSubredditId) {
    finalScope = 'subreddit';
  } else if (!finalScope) {
    finalScope = 'site';
  }

  // Yetki kontrolü
  if (finalScope === 'site' && req.user.role !== 'admin') {
    return next(
      new ErrorResponse('Site genelinde arşiv politikası oluşturmak için admin olmalısınız', 403),
    );
  }

  // Subreddit kontrolü
  if (finalScope === 'subreddit') {
    if (!finalSubredditId || !mongoose.Types.ObjectId.isValid(finalSubredditId)) {
      return next(new ErrorResponse("Geçerli bir subreddit ID'si gereklidir", 400));
    }

    const subreddit = await Subreddit.findById(finalSubredditId);
    if (!subreddit) {
      return next(new ErrorResponse('Subreddit bulunamadı', 404));
    }

    // Kullanıcı subreddit'in moderatörü mü kontrol et
    if (req.user.role !== 'admin') {
      const isModerator = await SubredditMembership.findOne({
        user: req.user._id,
        subreddit: finalSubredditId,
        type: 'moderator',
      });

      if (!isModerator) {
        return next(
          new ErrorResponse('Bu subreddit için arşiv politikası oluşturma yetkiniz yok', 403),
        );
      }
    }
  }

  // archiveAfterDays kontrolü
  if (!archiveAfterDays || isNaN(parseInt(archiveAfterDays)) || parseInt(archiveAfterDays) < 1) {
    return next(new ErrorResponse('Geçerli bir arşivleme süresi (gün) gereklidir', 400));
  }

  // Aynı kapsam, subreddit ve içerik türü için zaten politika var mı kontrol et
  const existingPolicy = await ArchivePolicy.findOne({
    scope: finalScope,
    subreddit: finalScope === 'subreddit' ? finalSubredditId : null,
    contentType,
  });

  if (existingPolicy) {
    return next(
      new ErrorResponse(
        'Aynı kapsam ve içerik türü için zaten bir arşiv politikası bulunmaktadır',
        400,
      ),
    );
  }

  // Yeni arşiv politikası oluştur
  const archivePolicy = await ArchivePolicy.create({
    scope: finalScope,
    subreddit: finalScope === 'subreddit' ? finalSubredditId : null,
    contentType,
    archiveAfterDays: parseInt(archiveAfterDays),
    actions: {
      lockVoting: actions.lockVoting !== false,
      lockComments: actions.lockComments !== false,
      hideFromFeeds: actions.hideFromFeeds === true,
    },
    isActive,
    createdBy: req.user._id,
  });

  // Moderatör günlüğüne kaydet
  if (finalScope === 'subreddit') {
    await ModLog.create({
      subreddit: finalSubredditId,
      moderator: req.user._id,
      action: 'edit_settings',
      targetType: 'subreddit',
      details: 'Arşiv politikası oluşturuldu',
      reason: req.body.reason || 'Yeni arşiv politikası',
    });
  }

  res.status(201).json({
    success: true,
    data: archivePolicy,
  });
});

/**
 * @desc    Arşiv politikasını güncelle
 * @route   PUT /api/archive-policies/:id
 * @access  Private (Subreddit mod veya Admin)
 */
const updateArchivePolicy = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { contentType, archiveAfterDays, actions, isActive, reason } = req.body;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorResponse('Geçersiz politika ID formatı', 400));
  }

  // Politikayı bul
  let archivePolicy = await ArchivePolicy.findById(id);

  if (!archivePolicy) {
    return next(new ErrorResponse('Arşiv politikası bulunamadı', 404));
  }

  // Yetki kontrolü
  if (archivePolicy.scope === 'site' && req.user.role !== 'admin') {
    return next(
      new ErrorResponse(
        'Site genelindeki arşiv politikalarını sadece adminler güncelleyebilir',
        403,
      ),
    );
  }

  if (archivePolicy.scope === 'subreddit') {
    const isModerator = await SubredditMembership.findOne({
      user: req.user._id,
      subreddit: archivePolicy.subreddit,
      type: 'moderator',
    });

    if (!isModerator && req.user.role !== 'admin') {
      return next(new ErrorResponse('Bu arşiv politikasını güncelleme yetkiniz yok', 403));
    }
  }

  // Güncelleme verilerini hazırla
  const updateData = {};

  if (contentType && ['post', 'comment', 'all'].includes(contentType)) {
    updateData.contentType = contentType;
  }

  if (archiveAfterDays && !isNaN(parseInt(archiveAfterDays)) && parseInt(archiveAfterDays) >= 1) {
    updateData.archiveAfterDays = parseInt(archiveAfterDays);
  }

  if (actions) {
    updateData.actions = {};
    if (typeof actions.lockVoting === 'boolean') {
      updateData.actions.lockVoting = actions.lockVoting;
    }
    if (typeof actions.lockComments === 'boolean') {
      updateData.actions.lockComments = actions.lockComments;
    }
    if (typeof actions.hideFromFeeds === 'boolean') {
      updateData.actions.hideFromFeeds = actions.hideFromFeeds;
    }
  }

  if (isActive !== undefined) {
    updateData.isActive = isActive === true;
  }

  updateData.updatedAt = Date.now();

  // Politikayı güncelle
  archivePolicy = await ArchivePolicy.findByIdAndUpdate(id, updateData, {
    new: true,
    runValidators: true,
  });

  // Moderatör günlüğüne kaydet
  if (archivePolicy.scope === 'subreddit') {
    await ModLog.create({
      subreddit: archivePolicy.subreddit,
      moderator: req.user._id,
      action: 'edit_settings',
      targetType: 'subreddit',
      details: 'Arşiv politikası güncellendi',
      reason: reason || 'Arşiv politikası güncelleme',
    });
  }

  res.status(200).json({
    success: true,
    data: archivePolicy,
  });
});

/**
 * @desc    Arşiv politikasını sil
 * @route   DELETE /api/archive-policies/:id
 * @access  Private (Subreddit mod veya Admin)
 */
const deleteArchivePolicy = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { reason } = req.body;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorResponse('Geçersiz politika ID formatı', 400));
  }

  // Politikayı bul
  const archivePolicy = await ArchivePolicy.findById(id);

  if (!archivePolicy) {
    return next(new ErrorResponse('Arşiv politikası bulunamadı', 404));
  }

  // Yetki kontrolü
  if (archivePolicy.scope === 'site' && req.user.role !== 'admin') {
    return next(
      new ErrorResponse('Site genelindeki arşiv politikalarını sadece adminler silebilir', 403),
    );
  }

  if (archivePolicy.scope === 'subreddit') {
    const isModerator = await SubredditMembership.findOne({
      user: req.user._id,
      subreddit: archivePolicy.subreddit,
      type: 'moderator',
    });

    if (!isModerator && req.user.role !== 'admin') {
      return next(new ErrorResponse('Bu arşiv politikasını silme yetkiniz yok', 403));
    }
  }

  // Politikayı sil
  await archivePolicy.remove();

  // Moderatör günlüğüne kaydet
  if (archivePolicy.scope === 'subreddit') {
    await ModLog.create({
      subreddit: archivePolicy.subreddit,
      moderator: req.user._id,
      action: 'edit_settings',
      targetType: 'subreddit',
      details: 'Arşiv politikası silindi',
      reason: reason || 'Arşiv politikası silme',
    });
  }

  res.status(200).json({
    success: true,
    data: {},
  });
});

/**
 * @desc    Arşiv politikalarını uygula
 * @route   POST /api/archive-policies/apply
 * @access  Private (Admin)
 */
const applyArchivePolicies = asyncHandler(async (req, res, next) => {
  // Sadece adminler manuel olarak arşivleme işlemini tetikleyebilir
  if (req.user.role !== 'admin') {
    return next(new ErrorResponse('Bu işlemi sadece adminler gerçekleştirebilir', 403));
  }

  // Aktif arşiv politikalarını getir
  const activePolicies = await ArchivePolicy.find({ isActive: true });

  if (activePolicies.length === 0) {
    return res.status(200).json({
      success: true,
      message: 'Uygulanacak aktif arşiv politikası bulunamadı',
      archived: {
        posts: 0,
        comments: 0,
      },
    });
  }

  // İçerik tipine göre politikaları grupla
  const postPolicies = activePolicies.filter(
    (p) => p.contentType === 'post' || p.contentType === 'all',
  );
  const commentPolicies = activePolicies.filter(
    (p) => p.contentType === 'comment' || p.contentType === 'all',
  );

  // Arşivleme için tarih hesapla
  const calculateArchiveDate = (days) => {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date;
  };

  // Arşivlenen içerikleri say
  let archivedPostsCount = 0;
  let archivedCommentsCount = 0;

  // Post arşivleme işlemi
  if (postPolicies.length > 0) {
    // Önce site genelindeki politikaları uygula
    const siteWidePolicies = postPolicies.filter((p) => p.scope === 'site');

    for (const policy of siteWidePolicies) {
      const archiveDate = calculateArchiveDate(policy.archiveAfterDays);

      // Arşivlenecek gönderileri bul ve güncelle
      const result = await Post.updateMany(
        {
          createdAt: { $lt: archiveDate },
          isArchived: { $ne: true },
        },
        {
          isArchived: true,
          archivedAt: Date.now(),
          archivedBy: 'system',
          archivedReason: `Site geneli arşiv politikası: ${policy.archiveAfterDays} gün`,
          isLocked: policy.actions.lockVoting || policy.actions.lockComments,
          isCommentLocked: policy.actions.lockComments,
          isHidden: policy.actions.hideFromFeeds,
        },
      );

      archivedPostsCount += result.nModified;
    }

    // Subreddit spesifik politikaları uygula
    const subredditPolicies = postPolicies.filter((p) => p.scope === 'subreddit');

    for (const policy of subredditPolicies) {
      const archiveDate = calculateArchiveDate(policy.archiveAfterDays);

      // Arşivlenecek gönderileri bul ve güncelle
      const result = await Post.updateMany(
        {
          subreddit: policy.subreddit,
          createdAt: { $lt: archiveDate },
          isArchived: { $ne: true },
        },
        {
          isArchived: true,
          archivedAt: Date.now(),
          archivedBy: 'system',
          archivedReason: `Subreddit arşiv politikası: ${policy.archiveAfterDays} gün`,
          isLocked: policy.actions.lockVoting || policy.actions.lockComments,
          isCommentLocked: policy.actions.lockComments,
          isHidden: policy.actions.hideFromFeeds,
        },
      );

      archivedPostsCount += result.nModified;
    }
  }

  // Yorum arşivleme işlemi
  if (commentPolicies.length > 0) {
    // Önce site genelindeki politikaları uygula
    const siteWidePolicies = commentPolicies.filter((p) => p.scope === 'site');

    for (const policy of siteWidePolicies) {
      const archiveDate = calculateArchiveDate(policy.archiveAfterDays);

      // Arşivlenecek yorumları bul ve güncelle
      const result = await Comment.updateMany(
        {
          createdAt: { $lt: archiveDate },
          isArchived: { $ne: true },
        },
        {
          isArchived: true,
          archivedAt: Date.now(),
          archivedBy: 'system',
          archivedReason: `Site geneli arşiv politikası: ${policy.archiveAfterDays} gün`,
          isLocked: policy.actions.lockVoting || policy.actions.lockComments,
        },
      );

      archivedCommentsCount += result.nModified;
    }

    // Subreddit spesifik politikaları uygula
    const subredditPolicies = commentPolicies.filter((p) => p.scope === 'subreddit');

    for (const policy of subredditPolicies) {
      const archiveDate = calculateArchiveDate(policy.archiveAfterDays);

      // Bu subreddit'e ait post ID'leri bul
      const subredditPosts = await Post.find({ subreddit: policy.subreddit }).select('_id');
      const postIds = subredditPosts.map((post) => post._id);

      if (postIds.length > 0) {
        // Arşivlenecek yorumları bul ve güncelle
        const result = await Comment.updateMany(
          {
            post: { $in: postIds },
            createdAt: { $lt: archiveDate },
            isArchived: { $ne: true },
          },
          {
            isArchived: true,
            archivedAt: Date.now(),
            archivedBy: 'system',
            archivedReason: `Subreddit arşiv politikası: ${policy.archiveAfterDays} gün`,
            isLocked: policy.actions.lockVoting || policy.actions.lockComments,
          },
        );

        archivedCommentsCount += result.nModified;
      }
    }
  }

  res.status(200).json({
    success: true,
    message: 'Arşiv politikaları başarıyla uygulandı',
    archived: {
      posts: archivedPostsCount,
      comments: archivedCommentsCount,
    },
  });
});

/**
 * @desc    Arşiv politikalarını subreddit ayarlarından getir
 * @route   GET /api/subreddits/:subredditId/settings/archive
 * @access  Private (Subreddit mod veya Admin)
 */
const getSubredditArchiveSettings = asyncHandler(async (req, res, next) => {
  const { subredditId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(subredditId)) {
    return next(new ErrorResponse('Geçersiz subreddit ID formatı', 400));
  }

  // Subreddit'in var olup olmadığını kontrol et
  const subreddit = await Subreddit.findById(subredditId);
  if (!subreddit) {
    return next(new ErrorResponse('Subreddit bulunamadı', 404));
  }

  // Yetki kontrolü
  if (req.user && req.user.role !== 'admin') {
    const isModerator = await SubredditMembership.findOne({
      user: req.user._id,
      subreddit: subredditId,
      type: 'moderator',
    });

    if (!isModerator) {
      return next(
        new ErrorResponse("Bu subreddit'in arşiv ayarlarını görüntüleme yetkiniz yok", 403),
      );
    }
  }

  // Bu subreddit için arşiv politikalarını getir
  const archivePolicies = await ArchivePolicy.find({
    scope: 'subreddit',
    subreddit: subredditId,
  });

  // Site genelindeki politikaları da getir (referans için)
  const siteWidePolicies = await ArchivePolicy.find({
    scope: 'site',
  });

  res.status(200).json({
    success: true,
    data: {
      subredditPolicies: archivePolicies,
      siteWidePolicies,
    },
  });
});

/**
 * @desc    İçeriğin arşive eklenip eklenmeyeceğini kontrol et
 * @route   GET /api/archive-policies/check/:contentType/:contentId
 * @access  Public
 */
const checkArchiveStatus = asyncHandler(async (req, res, next) => {
  const { contentType, contentId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(contentId)) {
    return next(new ErrorResponse('Geçersiz içerik ID formatı', 400));
  }

  if (!['post', 'comment'].includes(contentType)) {
    return next(new ErrorResponse('Geçersiz içerik türü. "post" veya "comment" olmalıdır', 400));
  }

  let content;
  let subredditId;

  // İçeriği getir
  if (contentType === 'post') {
    content = await Post.findById(contentId);
    if (!content) {
      return next(new ErrorResponse('Gönderi bulunamadı', 404));
    }
    subredditId = content.subreddit;
  } else {
    content = await Comment.findById(contentId);
    if (!content) {
      return next(new ErrorResponse('Yorum bulunamadı', 404));
    }

    // Yorumun bağlı olduğu postu bul
    const post = await Post.findById(content.post);
    if (!post) {
      return next(new ErrorResponse('Yorumun bağlı olduğu gönderi bulunamadı', 404));
    }
    subredditId = post.subreddit;
  }

  // Eğer içerik zaten arşivlenmişse
  if (content.isArchived) {
    return res.status(200).json({
      success: true,
      data: {
        isArchived: true,
        archivedAt: content.archivedAt,
        archivedBy: content.archivedBy,
        archivedReason: content.archivedReason,
      },
    });
  }

  // Uygulanabilir arşiv politikalarını kontrol et
  // Önce subreddit spesifik politikalar
  const subredditPolicy = await ArchivePolicy.findOne({
    scope: 'subreddit',
    subreddit: subredditId,
    isActive: true,
    $or: [{ contentType: contentType }, { contentType: 'all' }],
  });

  // Sonra site geneli politikalar
  const siteWidePolicy = await ArchivePolicy.findOne({
    scope: 'site',
    isActive: true,
    $or: [{ contentType: contentType }, { contentType: 'all' }],
  });

  // En sıkı politikayı seç (en kısa süre)
  let applicablePolicy = null;

  if (subredditPolicy && siteWidePolicy) {
    applicablePolicy =
      subredditPolicy.archiveAfterDays <= siteWidePolicy.archiveAfterDays
        ? subredditPolicy
        : siteWidePolicy;
  } else if (subredditPolicy) {
    applicablePolicy = subredditPolicy;
  } else if (siteWidePolicy) {
    applicablePolicy = siteWidePolicy;
  }

  if (!applicablePolicy) {
    return res.status(200).json({
      success: true,
      data: {
        isArchived: false,
        willBeArchived: false,
        message: 'Bu içerik için uygulanabilir bir arşiv politikası bulunmamaktadır',
      },
    });
  }

  // İçeriğin arşivlenme tarihini hesapla
  const createdAt = new Date(content.createdAt);
  const archiveDate = new Date(createdAt);
  archiveDate.setDate(archiveDate.getDate() + applicablePolicy.archiveAfterDays);

  // Arşivlenecek mi kontrolü
  const now = new Date();
  const isArchivable = now >= archiveDate;
  const daysUntilArchive = Math.max(0, Math.ceil((archiveDate - now) / (1000 * 60 * 60 * 24)));

  res.status(200).json({
    success: true,
    data: {
      isArchived: false,
      willBeArchived: true,
      archiveDate,
      daysUntilArchive,
      policy: {
        id: applicablePolicy._id,
        scope: applicablePolicy.scope,
        archiveAfterDays: applicablePolicy.archiveAfterDays,
        actions: applicablePolicy.actions,
      },
    },
  });
});

/**
 * @desc    Manuel olarak içeriği arşivle
 * @route   POST /api/archive-policies/archive/:contentType/:contentId
 * @access  Private (Subreddit Mod veya Admin)
 */
const manuallyArchiveContent = asyncHandler(async (req, res, next) => {
  const { contentType, contentId } = req.params;
  const { reason } = req.body;

  if (!mongoose.Types.ObjectId.isValid(contentId)) {
    return next(new ErrorResponse('Geçersiz içerik ID formatı', 400));
  }

  if (!['post', 'comment'].includes(contentType)) {
    return next(new ErrorResponse('Geçersiz içerik türü. "post" veya "comment" olmalıdır', 400));
  }

  let content;
  let subredditId;

  // İçeriği getir
  if (contentType === 'post') {
    content = await Post.findById(contentId);
    if (!content) {
      return next(new ErrorResponse('Gönderi bulunamadı', 404));
    }
    subredditId = content.subreddit;
  } else {
    content = await Comment.findById(contentId);
    if (!content) {
      return next(new ErrorResponse('Yorum bulunamadı', 404));
    }

    // Yorumun bağlı olduğu postu bul
    const post = await Post.findById(content.post);
    if (!post) {
      return next(new ErrorResponse('Yorumun bağlı olduğu gönderi bulunamadı', 404));
    }
    subredditId = post.subreddit;
  }

  // Eğer içerik zaten arşivlenmişse
  if (content.isArchived) {
    return next(new ErrorResponse('Bu içerik zaten arşivlenmiş', 400));
  }

  // Yetki kontrolü
  if (req.user.role !== 'admin') {
    const isModerator = await SubredditMembership.findOne({
      user: req.user._id,
      subreddit: subredditId,
      type: 'moderator',
    });

    if (!isModerator) {
      return next(new ErrorResponse('Bu içeriği arşivleme yetkiniz yok', 403));
    }
  }

  // İçeriği arşivle
  content.isArchived = true;
  content.archivedAt = Date.now();
  content.archivedBy = req.user._id;
  content.archivedReason = reason || 'Manuel arşivleme';

  // İçerik tipine göre ek işlemler
  if (contentType === 'post') {
    content.isLocked = true;
    content.isCommentLocked = true;
  } else {
    content.isLocked = true;
  }

  await content.save();

  // Moderatör log kaydı oluştur
  await ModLog.create({
    subreddit: subredditId,
    moderator: req.user._id,
    action: contentType === 'post' ? 'post_lock' : 'comment_lock',
    targetType: contentType,
    [contentType === 'post' ? 'targetPost' : 'targetComment']: contentId,
    details: 'İçerik arşivlendi',
    reason: reason || 'Manuel arşivleme',
  });

  res.status(200).json({
    success: true,
    data: {
      isArchived: true,
      archivedAt: content.archivedAt,
      archivedBy: content.archivedBy,
      archivedReason: content.archivedReason,
    },
  });
});

/**
 * @desc    Arşivden içeriği çıkar
 * @route   POST /api/archive-policies/unarchive/:contentType/:contentId
 * @access  Private (Subreddit Mod veya Admin)
 */
const unarchiveContent = asyncHandler(async (req, res, next) => {
  const { contentType, contentId } = req.params;
  const { reason } = req.body;

  if (!mongoose.Types.ObjectId.isValid(contentId)) {
    return next(new ErrorResponse('Geçersiz içerik ID formatı', 400));
  }

  if (!['post', 'comment'].includes(contentType)) {
    return next(new ErrorResponse('Geçersiz içerik türü. "post" veya "comment" olmalıdır', 400));
  }

  let content;
  let subredditId;

  // İçeriği getir
  if (contentType === 'post') {
    content = await Post.findById(contentId);
    if (!content) {
      return next(new ErrorResponse('Gönderi bulunamadı', 404));
    }
    subredditId = content.subreddit;
  } else {
    content = await Comment.findById(contentId);
    if (!content) {
      return next(new ErrorResponse('Yorum bulunamadı', 404));
    }

    // Yorumun bağlı olduğu postu bul
    const post = await Post.findById(content.post);
    if (!post) {
      return next(new ErrorResponse('Yorumun bağlı olduğu gönderi bulunamadı', 404));
    }
    subredditId = post.subreddit;
  }

  // Eğer içerik arşivlenmemişse
  if (!content.isArchived) {
    return next(new ErrorResponse('Bu içerik arşivlenmemiş', 400));
  }

  // Yetki kontrolü
  if (req.user.role !== 'admin') {
    const isModerator = await SubredditMembership.findOne({
      user: req.user._id,
      subreddit: subredditId,
      type: 'moderator',
    });

    if (!isModerator) {
      return next(new ErrorResponse('Bu içeriği arşivden çıkarma yetkiniz yok', 403));
    }
  }

  // İçeriği arşivden çıkar
  content.isArchived = false;
  content.archivedAt = null;
  content.archivedBy = null;
  content.archivedReason = null;

  // İçerik tipine göre ek işlemler (kilit kaldırma isteğe bağlı)
  if (req.body.unlockContent === true) {
    if (contentType === 'post') {
      content.isLocked = false;
      content.isCommentLocked = false;
    } else {
      content.isLocked = false;
    }
  }

  await content.save();

  // Moderatör log kaydı oluştur
  await ModLog.create({
    subreddit: subredditId,
    moderator: req.user._id,
    action: contentType === 'post' ? 'post_unlock' : 'comment_unlock',
    targetType: contentType,
    [contentType === 'post' ? 'targetPost' : 'targetComment']: contentId,
    details: 'İçerik arşivden çıkarıldı',
    reason: reason || 'Arşivden çıkarma',
  });

  res.status(200).json({
    success: true,
    message: 'İçerik başarıyla arşivden çıkarıldı',
    data: content,
  });
});

module.exports = {
  getArchivePolicies,
  getArchivePolicy,
  createArchivePolicy,
  updateArchivePolicy,
  deleteArchivePolicy,
  applyArchivePolicies,
  getSubredditArchiveSettings,
  checkArchiveStatus,
  manuallyArchiveContent,
  unarchiveContent,
};
