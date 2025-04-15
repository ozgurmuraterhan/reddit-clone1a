const mongoose = require('mongoose');
const RateLimit = require('../models/RateLimit');
const User = require('../models/User');
const asyncHandler = require('../middleware/async');
const ErrorResponse = require('../utils/errorResponse');

/**
 * @desc    Kullanıcının belirlenen işlem için hız sınırını kontrol et
 * @route   GET /api/rate-limits/check/:action
 * @access  Public
 */
const checkRateLimit = asyncHandler(async (req, res, next) => {
  const { action } = req.params;
  const userId = req.user ? req.user._id : null;
  const ip = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;

  // Önceden tanımlanmış işlem türleri
  const validActions = [
    'post_create',
    'comment_create',
    'vote',
    'message_send',
    'subreddit_create',
    'search',
    'poll_create',
    'poll_vote',
    'login_attempt',
  ];

  if (!validActions.includes(action)) {
    return next(new ErrorResponse(`Geçersiz işlem türü: ${action}`, 400));
  }

  // IP bazlı anonim kontrol (kullanıcı girişi yoksa)
  if (!userId) {
    const ipLimit = await RateLimit.findOne({
      identifier: ip,
      identifierType: 'ip',
      action,
    });

    if (ipLimit && ipLimit.isLimited()) {
      return res.status(429).json({
        success: false,
        message: `Çok fazla istek gönderdiniz, lütfen ${ipLimit.getTimeToReset()} saniye bekleyin`,
        reset: ipLimit.getTimeToReset(),
        limit: ipLimit.limit,
        remaining: 0,
      });
    }

    return res.status(200).json({
      success: true,
      message: 'İşlem yapabilirsiniz',
      remaining: ipLimit ? ipLimit.getRemainingAttempts() : null,
      limit: ipLimit ? ipLimit.limit : null,
    });
  }

  // Kullanıcı premium üye mi kontrol et
  const user = await User.findById(userId).select('role isPremium premiumTier');

  // Premium veya Admin kullanıcıları bazı sınırlamalardan muaf tutabilirsiniz
  if ((user.isPremium || user.role === 'admin') && isExemptedFromLimit(action, user.premiumTier)) {
    return res.status(200).json({
      success: true,
      message: 'Premium üye olduğunuz için bu işlem için hız sınırlaması yoktur',
      remaining: null,
      limit: null,
      exempt: true,
    });
  }

  // Kullanıcı ve IP için hız sınırı kontrolleri
  const [userLimit, ipLimitForUser] = await Promise.all([
    RateLimit.findOne({
      identifier: userId.toString(),
      identifierType: 'user',
      action,
    }),
    RateLimit.findOne({
      identifier: ip,
      identifierType: 'ip',
      userId: userId,
      action,
    }),
  ]);

  // Hem kullanıcı hem de IP sınırını kontrol et (en kısıtlayıcı olanı uygula)
  if (userLimit && userLimit.isLimited()) {
    return res.status(429).json({
      success: false,
      message: `Çok fazla istek gönderdiniz, lütfen ${userLimit.getTimeToReset()} saniye bekleyin`,
      reset: userLimit.getTimeToReset(),
      limit: userLimit.limit,
      remaining: 0,
    });
  }

  if (ipLimitForUser && ipLimitForUser.isLimited()) {
    return res.status(429).json({
      success: false,
      message: `Bu IP adresinden çok fazla istek gönderildi, lütfen ${ipLimitForUser.getTimeToReset()} saniye bekleyin`,
      reset: ipLimitForUser.getTimeToReset(),
      limit: ipLimitForUser.limit,
      remaining: 0,
    });
  }

  res.status(200).json({
    success: true,
    message: 'İşlem yapabilirsiniz',
    remaining: userLimit ? userLimit.getRemainingAttempts() : null,
    limit: userLimit ? userLimit.limit : null,
  });
});

/**
 * @desc    Bir işlemi gerçekleştir ve hız sınırı kayıtlarını güncelle
 * @route   POST /api/rate-limits/record/:action
 * @access  Private
 */
const recordAction = asyncHandler(async (req, res, next) => {
  const { action } = req.params;
  const userId = req.user._id;
  const ip = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;

  // Önceden tanımlanmış işlem türleri
  const validActions = [
    'post_create',
    'comment_create',
    'vote',
    'message_send',
    'subreddit_create',
    'search',
    'poll_create',
    'poll_vote',
    'login_attempt',
  ];

  if (!validActions.includes(action)) {
    return next(new ErrorResponse(`Geçersiz işlem türü: ${action}`, 400));
  }

  // İşlem için gerekli hız sınırlama ayarlarını getir
  const limitSettings = getLimitSettingsForAction(action, req.user);

  // Premium veya Admin kullanıcıları bazı sınırlamalardan muaf tutabilirsiniz
  const user = await User.findById(userId).select('role isPremium premiumTier');
  if ((user.isPremium || user.role === 'admin') && isExemptedFromLimit(action, user.premiumTier)) {
    return res.status(200).json({
      success: true,
      message: 'İşlem kaydedildi (premium kullanıcı)',
      exempt: true,
    });
  }

  // Kullanıcı bazlı hız sınırı kaydını bul veya oluştur
  let userLimit = await RateLimit.findOne({
    identifier: userId.toString(),
    identifierType: 'user',
    action,
  });

  if (!userLimit) {
    userLimit = new RateLimit({
      identifier: userId.toString(),
      identifierType: 'user',
      userId,
      action,
      limit: limitSettings.userLimit,
      windowMs: limitSettings.windowMs,
      attempts: 0,
      lastAttempt: new Date(),
    });
  }

  // IP bazlı hız sınırı kaydını bul veya oluştur
  let ipLimit = await RateLimit.findOne({
    identifier: ip,
    identifierType: 'ip',
    userId,
    action,
  });

  if (!ipLimit) {
    ipLimit = new RateLimit({
      identifier: ip,
      identifierType: 'ip',
      userId,
      action,
      limit: limitSettings.ipLimit,
      windowMs: limitSettings.windowMs,
      attempts: 0,
      lastAttempt: new Date(),
    });
  }

  // Hız sınırı kontrollerini yap
  const userLimited = userLimit.isLimited();
  const ipLimited = ipLimit.isLimited();

  if (userLimited || ipLimited) {
    const limitedEntity = userLimited ? userLimit : ipLimit;
    return res.status(429).json({
      success: false,
      message: `Çok fazla istek gönderdiniz, lütfen ${limitedEntity.getTimeToReset()} saniye bekleyin`,
      reset: limitedEntity.getTimeToReset(),
      limit: limitedEntity.limit,
      remaining: 0,
    });
  }

  // Sınırlama yoksa, deneme sayılarını artır
  userLimit.attempts += 1;
  userLimit.lastAttempt = new Date();
  ipLimit.attempts += 1;
  ipLimit.lastAttempt = new Date();

  // Kayıtları güncelle
  await Promise.all([userLimit.save(), ipLimit.save()]);

  res.status(200).json({
    success: true,
    message: 'İşlem başarıyla kaydedildi',
    remaining: userLimit.getRemainingAttempts(),
    limit: userLimit.limit,
  });
});

/**
 * @desc    Yönetici için kullanıcı hız sınırlarını sıfırla
 * @route   POST /api/rate-limits/reset/:userId
 * @access  Admin
 */
const resetUserRateLimits = asyncHandler(async (req, res, next) => {
  const { userId } = req.params;
  const { action } = req.query; // İsteğe bağlı: belirli bir işlemi sıfırlamak için

  if (!mongoose.Types.ObjectId.isValid(userId)) {
    return next(new ErrorResponse('Geçersiz kullanıcı ID formatı', 400));
  }

  // Kullanıcının varlığını kontrol et
  const user = await User.findById(userId);
  if (!user) {
    return next(new ErrorResponse('Kullanıcı bulunamadı', 404));
  }

  // Sıfırlama sorgusu oluştur
  const resetQuery = {
    identifier: userId.toString(),
    identifierType: 'user',
  };

  // Eğer belirli bir işlem belirtilmişse sorguya ekle
  if (action) {
    resetQuery.action = action;
  }

  // Hız sınırlarını sıfırla
  const result = await RateLimit.updateMany(resetQuery, { attempts: 0, lastAttempt: new Date() });

  res.status(200).json({
    success: true,
    message: `${result.nModified} hız sınırı kaydı sıfırlandı`,
    data: {
      user: userId,
      action: action || 'all',
      resettedRecords: result.nModified,
    },
  });
});

/**
 * @desc    Moderatör için Subreddit'e özel hız sınırı ayarları
 * @route   POST /api/rate-limits/subreddit/:subredditId
 * @access  Moderator
 */
const setSubredditRateLimits = asyncHandler(async (req, res, next) => {
  const { subredditId } = req.params;
  const { postLimit, commentLimit, windowMs } = req.body;

  if (!mongoose.Types.ObjectId.isValid(subredditId)) {
    return next(new ErrorResponse('Geçersiz subreddit ID formatı', 400));
  }

  // Subreddit'i kontrol et
  const subreddit = await Subreddit.findById(subredditId);
  if (!subreddit) {
    return next(new ErrorResponse('Subreddit bulunamadı', 404));
  }

  // Kullanıcının bu subreddit için moderatör yetkisi var mı?
  const isModerator = await checkUserPermissions(
    req.user._id,
    subredditId,
    'settings',
    'manage_settings',
  );

  if (!isModerator && req.user.role !== 'admin') {
    return next(new ErrorResponse('Bu subreddit için ayarları değiştirme yetkiniz yok', 403));
  }

  // Geçerli limit değerlerini kontrol et
  if (postLimit && (postLimit < 1 || postLimit > 100)) {
    return next(new ErrorResponse('Gönderi limiti 1-100 arasında olmalıdır', 400));
  }

  if (commentLimit && (commentLimit < 1 || commentLimit > 200)) {
    return next(new ErrorResponse('Yorum limiti 1-200 arasında olmalıdır', 400));
  }

  if (windowMs && (windowMs < 60000 || windowMs > 86400000)) {
    return next(
      new ErrorResponse(
        'Zaman penceresi 1 dakika (60000 ms) ile 1 gün (86400000 ms) arasında olmalıdır',
        400,
      ),
    );
  }

  // Subreddit rate limit ayarlarını güncelle
  const updatedSettings = {
    rateLimits: {
      ...subreddit.rateLimits,
    },
  };

  if (postLimit) updatedSettings.rateLimits.postLimit = postLimit;
  if (commentLimit) updatedSettings.rateLimits.commentLimit = commentLimit;
  if (windowMs) updatedSettings.rateLimits.windowMs = windowMs;

  // Subreddit'i güncelle
  const updatedSubreddit = await Subreddit.findByIdAndUpdate(
    subredditId,
    { $set: updatedSettings },
    { new: true, runValidators: true },
  );

  // Moderasyon logu oluştur
  await ModLog.create({
    subreddit: subredditId,
    user: req.user._id,
    action: 'rate_limits_updated',
    details: `Rate limit ayarları güncellendi`,
    targetType: 'subreddit',
    targetId: subredditId,
  });

  res.status(200).json({
    success: true,
    message: 'Subreddit hız sınırları başarıyla güncellendi',
    data: updatedSubreddit.rateLimits,
  });
});

/**
 * @desc    Kullanıcının mevcut hız sınırı durumunu getir
 * @route   GET /api/rate-limits/status
 * @access  Private
 */
const getUserRateLimitStatus = asyncHandler(async (req, res, next) => {
  const userId = req.user._id;

  // Kullanıcının tüm hız sınırı kayıtlarını getir
  const rateLimits = await RateLimit.find({
    identifier: userId.toString(),
    identifierType: 'user',
  });

  // Her işlem için durumu hazırla
  const statusByAction = {};

  rateLimits.forEach((limit) => {
    statusByAction[limit.action] = {
      action: limit.action,
      limit: limit.limit,
      attempts: limit.attempts,
      remaining: limit.getRemainingAttempts(),
      isLimited: limit.isLimited(),
      timeToReset: limit.isLimited() ? limit.getTimeToReset() : 0,
      windowMs: limit.windowMs,
      lastAttempt: limit.lastAttempt,
    };
  });

  // Premium kullanıcı bilgisini ekle
  const user = await User.findById(userId).select('isPremium premiumTier role');
  const isPremium = user.isPremium || user.role === 'admin';

  res.status(200).json({
    success: true,
    data: {
      rateLimits: statusByAction,
      isPremium,
      premiumTier: user.premiumTier,
      exemptions: isPremium ? getExemptionsForUser(user.premiumTier) : [],
    },
  });
});

/**
 * @desc    Site genelinde hız sınırlarını yapılandır (Admin)
 * @route   PUT /api/rate-limits/config
 * @access  Admin
 */
const updateGlobalRateLimits = asyncHandler(async (req, res, next) => {
  const {
    postCreateLimit,
    commentCreateLimit,
    voteLimit,
    messageSendLimit,
    subredditCreateLimit,
    searchLimit,
    pollCreateLimit,
    pollVoteLimit,
    loginAttemptLimit,
    defaultWindowMs,
    premiumMultiplier,
  } = req.body;

  // Ayarları veritabanından al (varsayılan yapılandırma için)
  let config = await Config.findOne({ name: 'rateLimits' });

  if (!config) {
    config = new Config({
      name: 'rateLimits',
      data: getDefaultRateLimitConfig(),
    });
  }

  // Gelen değerlerle yapılandırmayı güncelle
  const updatedConfig = { ...config.data };

  if (postCreateLimit) {
    validateLimitValue(postCreateLimit, 'postCreateLimit', 1, 100);
    updatedConfig.postCreateLimit = postCreateLimit;
  }

  if (commentCreateLimit) {
    validateLimitValue(commentCreateLimit, 'commentCreateLimit', 1, 200);
    updatedConfig.commentCreateLimit = commentCreateLimit;
  }

  if (voteLimit) {
    validateLimitValue(voteLimit, 'voteLimit', 10, 1000);
    updatedConfig.voteLimit = voteLimit;
  }

  if (messageSendLimit) {
    validateLimitValue(messageSendLimit, 'messageSendLimit', 1, 100);
    updatedConfig.messageSendLimit = messageSendLimit;
  }

  if (subredditCreateLimit) {
    validateLimitValue(subredditCreateLimit, 'subredditCreateLimit', 1, 20);
    updatedConfig.subredditCreateLimit = subredditCreateLimit;
  }

  if (searchLimit) {
    validateLimitValue(searchLimit, 'searchLimit', 5, 200);
    updatedConfig.searchLimit = searchLimit;
  }

  if (pollCreateLimit) {
    validateLimitValue(pollCreateLimit, 'pollCreateLimit', 1, 50);
    updatedConfig.pollCreateLimit = pollCreateLimit;
  }

  if (pollVoteLimit) {
    validateLimitValue(pollVoteLimit, 'pollVoteLimit', 5, 500);
    updatedConfig.pollVoteLimit = pollVoteLimit;
  }

  if (loginAttemptLimit) {
    validateLimitValue(loginAttemptLimit, 'loginAttemptLimit', 3, 30);
    updatedConfig.loginAttemptLimit = loginAttemptLimit;
  }

  if (defaultWindowMs) {
    validateLimitValue(defaultWindowMs, 'defaultWindowMs', 60000, 86400000);
    updatedConfig.defaultWindowMs = defaultWindowMs;
  }

  if (premiumMultiplier) {
    validateLimitValue(premiumMultiplier, 'premiumMultiplier', 1, 10);
    updatedConfig.premiumMultiplier = premiumMultiplier;
  }

  // Yapılandırmayı kaydet
  config.data = updatedConfig;
  await config.save();

  // Admin log oluştur
  await AdminLog.create({
    user: req.user._id,
    action: 'rate_limits_updated',
    details: 'Site genelinde hız sınırı yapılandırması güncellendi',
    ip: req.ip,
  });

  res.status(200).json({
    success: true,
    message: 'Hız sınırı yapılandırması başarıyla güncellendi',
    data: updatedConfig,
  });
});

/**
 * @desc    Kullanıcı için hız sınırı muafiyeti oluştur (Admin)
 * @route   POST /api/rate-limits/exemption/:userId
 * @access  Admin
 */
const createRateLimitExemption = asyncHandler(async (req, res, next) => {
  const { userId } = req.params;
  const { actions, reason, expiresAt } = req.body;

  // Kullanıcı ID'sinin geçerliliğini kontrol et
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    return next(new ErrorResponse('Geçersiz kullanıcı ID formatı', 400));
  }

  // Kullanıcının varlığını kontrol et
  const user = await User.findById(userId);
  if (!user) {
    return next(new ErrorResponse('Kullanıcı bulunamadı', 404));
  }

  // İşlemlerin geçerliliğini kontrol et
  if (!actions || !Array.isArray(actions) || actions.length === 0) {
    return next(new ErrorResponse('En az bir işlem belirtilmelidir', 400));
  }

  const validActions = [
    'post_create',
    'comment_create',
    'vote',
    'message_send',
    'subreddit_create',
    'search',
    'poll_create',
    'poll_vote',
    'login_attempt',
    'all',
  ];

  const invalidActions = actions.filter((action) => !validActions.includes(action));
  if (invalidActions.length > 0) {
    return next(new ErrorResponse(`Geçersiz işlem türleri: ${invalidActions.join(', ')}`, 400));
  }

  // Gerekçeyi kontrol et
  if (!reason || reason.trim().length === 0) {
    return next(new ErrorResponse('Muafiyet için gerekçe belirtilmelidir', 400));
  }

  // Son kullanma tarihini kontrol et
  let exemptionExpiry = null;
  if (expiresAt) {
    exemptionExpiry = new Date(expiresAt);
    if (isNaN(exemptionExpiry.getTime())) {
      return next(new ErrorResponse('Geçersiz son kullanma tarihi formatı', 400));
    }

    // Son kullanma tarihi geçmiş olamaz
    if (exemptionExpiry <= new Date()) {
      return next(new ErrorResponse('Son kullanma tarihi gelecekte olmalıdır', 400));
    }
  }

  // Mevcut muafiyetleri kontrol et ve güncelle
  let exemption = await RateLimitExemption.findOne({ user: userId });

  if (exemption) {
    // Mevcut muafiyeti güncelle
    exemption.actions = actions.includes('all') ? ['all'] : actions;
    exemption.reason = reason;
    exemption.expiresAt = exemptionExpiry;
    exemption.updatedBy = req.user._id;
    exemption.updatedAt = new Date();
  } else {
    // Yeni muafiyet oluştur
    exemption = new RateLimitExemption({
      user: userId,
      actions: actions.includes('all') ? ['all'] : actions,
      reason,
      expiresAt: exemptionExpiry,
      createdBy: req.user._id,
    });
  }

  await exemption.save();

  // Admin log oluştur
  await AdminLog.create({
    user: req.user._id,
    action: 'rate_limit_exemption_created',
    details: `${user.username} kullanıcısı için hız sınırı muafiyeti oluşturuldu: ${actions.join(', ')}`,
    targetUser: userId,
    ip: req.ip,
  });

  // Bildirim gönder
  await Notification.create({
    recipient: userId,
    sender: req.user._id,
    type: 'rate_limit_exemption',
    message: `Hesabınız için bazı hız sınırlarından muafiyet oluşturuldu: ${actions.join(', ')}`,
    reference: {
      type: 'User',
      id: userId,
    },
    isRead: false,
  });

  res.status(200).json({
    success: true,
    message: 'Hız sınırı muafiyeti başarıyla oluşturuldu',
    data: exemption,
  });
});

/**
 * @desc    Kullanıcı için hız sınırı muafiyetini kaldır (Admin)
 * @route   DELETE /api/rate-limits/exemption/:userId
 * @access  Admin
 */
const removeRateLimitExemption = asyncHandler(async (req, res, next) => {
  const { userId } = req.params;
  const { actions } = req.body; // İsteğe bağlı: belirli işlemler için muafiyeti kaldır

  // Kullanıcı ID'sinin geçerliliğini kontrol et
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    return next(new ErrorResponse('Geçersiz kullanıcı ID formatı', 400));
  }

  // Kullanıcının varlığını kontrol et
  const user = await User.findById(userId);
  if (!user) {
    return next(new ErrorResponse('Kullanıcı bulunamadı', 404));
  }

  // Muafiyeti bul
  const exemption = await RateLimitExemption.findOne({ user: userId });

  if (!exemption) {
    return next(new ErrorResponse('Bu kullanıcı için hız sınırı muafiyeti bulunamadı', 404));
  }

  // Belirli işlemler için muafiyeti kaldır
  if (actions && Array.isArray(actions) && actions.length > 0) {
    // 'all' varsa tüm muafiyeti kaldır
    if (actions.includes('all')) {
      await RateLimitExemption.deleteOne({ _id: exemption._id });

      // Admin log oluştur
      await AdminLog.create({
        user: req.user._id,
        action: 'rate_limit_exemption_removed',
        details: `${user.username} kullanıcısı için tüm hız sınırı muafiyetleri kaldırıldı`,
        targetUser: userId,
        ip: req.ip,
      });

      // Bildirim gönder
      await Notification.create({
        recipient: userId,
        sender: req.user._id,
        type: 'rate_limit_exemption_removed',
        message: 'Hesabınız için tüm hız sınırı muafiyetleri kaldırıldı',
        reference: {
          type: 'User',
          id: userId,
        },
        isRead: false,
      });

      return res.status(200).json({
        success: true,
        message: 'Tüm hız sınırı muafiyetleri başarıyla kaldırıldı',
      });
    }

    // Belirli işlemleri muafiyet listesinden çıkar
    exemption.actions = exemption.actions.filter((action) => !actions.includes(action));

    // Eğer hiç işlem kalmadıysa, muafiyeti tamamen kaldır
    if (exemption.actions.length === 0) {
      await RateLimitExemption.deleteOne({ _id: exemption._id });

      // Admin log oluştur
      await AdminLog.create({
        user: req.user._id,
        action: 'rate_limit_exemption_removed',
        details: `${user.username} kullanıcısı için tüm hız sınırı muafiyetleri kaldırıldı`,
        targetUser: userId,
        ip: req.ip,
      });
    } else {
      // Muafiyeti güncelle
      exemption.updatedBy = req.user._id;
      exemption.updatedAt = new Date();
      await exemption.save();

      // Admin log oluştur
      await AdminLog.create({
        user: req.user._id,
        action: 'rate_limit_exemption_updated',
        details: `${user.username} kullanıcısı için bazı hız sınırı muafiyetleri kaldırıldı: ${actions.join(', ')}`,
        targetUser: userId,
        ip: req.ip,
      });
    }

    // Bildirim gönder
    await Notification.create({
      recipient: userId,
      sender: req.user._id,
      type: 'rate_limit_exemption_updated',
      message: `Hesabınız için bazı hız sınırı muafiyetleri kaldırıldı: ${actions.join(', ')}`,
      reference: {
        type: 'User',
        id: userId,
      },
      isRead: false,
    });

    res.status(200).json({
      success: true,
      message: 'Belirtilen hız sınırı muafiyetleri başarıyla kaldırıldı',
      data: { remainingExemptions: exemption.actions.length > 0 ? exemption.actions : null },
    });
  } else {
    // Tüm muafiyeti kaldır
    await RateLimitExemption.deleteOne({ _id: exemption._id });

    // Admin log oluştur
    await AdminLog.create({
      user: req.user._id,
      action: 'rate_limit_exemption_removed',
      details: `${user.username} kullanıcısı için tüm hız sınırı muafiyetleri kaldırıldı`,
      targetUser: userId,
      ip: req.ip,
    });

    // Bildirim gönder
    await Notification.create({
      recipient: userId,
      sender: req.user._id,
      type: 'rate_limit_exemption_removed',
      message: 'Hesabınız için tüm hız sınırı muafiyetleri kaldırıldı',
      reference: {
        type: 'User',
        id: userId,
      },
      isRead: false,
    });

    res.status(200).json({
      success: true,
      message: 'Tüm hız sınırı muafiyetleri başarıyla kaldırıldı',
    });
  }
});

/**
 * @desc    Süresi dolmuş hız sınırı muafiyetlerini temizle (Cronjob)
 * @access  System
 */
const cleanExpiredExemptions = asyncHandler(async () => {
  const result = await RateLimitExemption.deleteMany({
    expiresAt: { $lt: new Date() },
  });

  console.log(`${result.deletedCount} süresi dolmuş hız sınırı muafiyeti temizlendi`);

  return {
    success: true,
    deletedCount: result.deletedCount,
  };
});

/**
 * @desc    Trendlere göre hız sınırlarını otomatik ayarla (Cronjob)
 * @access  System
 */
const adjustRateLimitsBasedOnLoad = asyncHandler(async () => {
  // Sistem yükünü ölç (son 1 saatteki işlem sayısı)
  const lastHour = new Date(Date.now() - 60 * 60 * 1000);

  const postCount = await Post.countDocuments({ createdAt: { $gte: lastHour } });
  const commentCount = await Comment.countDocuments({ createdAt: { $gte: lastHour } });
  const voteCount = await Vote.countDocuments({ createdAt: { $gte: lastHour } });

  // Site yapılandırmasını al
  let config = await Config.findOne({ name: 'rateLimits' });

  if (!config) {
    config = new Config({
      name: 'rateLimits',
      data: getDefaultRateLimitConfig(),
    });
  }

  // Yük durumuna göre ayarlamaları yap
  const totalLoad = postCount + commentCount + voteCount;

  // Yapılandırma eşiklerini al
  const { loadThresholds } = config.data;

  if (!loadThresholds) {
    return {
      success: false,
      message: 'Yük eşik değerleri yapılandırılmamış',
    };
  }

  // Yüke göre hız sınırı değişikliği yap
  let adjustmentFactor = 1;
  let loadLevel = 'normal';

  if (totalLoad > loadThresholds.critical) {
    adjustmentFactor = 0.5; // Kritik yük: limitleri yarıya indir
    loadLevel = 'critical';
  } else if (totalLoad > loadThresholds.high) {
    adjustmentFactor = 0.7; // Yüksek yük: limitleri %30 azalt
    loadLevel = 'high';
  } else if (totalLoad > loadThresholds.moderate) {
    adjustmentFactor = 0.85; // Orta yük: limitleri %15 azalt
    loadLevel = 'moderate';
  } else if (totalLoad < loadThresholds.low) {
    adjustmentFactor = 1.2; // Düşük yük: limitleri %20 artır
    loadLevel = 'low';
  }

  // Limitleri güncelle
  const updatedConfig = { ...config.data };

  updatedConfig.postCreateLimit = Math.round(updatedConfig.basePostCreateLimit * adjustmentFactor);
  updatedConfig.commentCreateLimit = Math.round(
    updatedConfig.baseCommentCreateLimit * adjustmentFactor,
  );
  updatedConfig.voteLimit = Math.round(updatedConfig.baseVoteLimit * adjustmentFactor);

  // Değişiklikleri kaydet
  config.data = updatedConfig;
  await config.save();

  console.log(
    `Sistem yüküne göre hız sınırları ayarlandı. Yük seviyesi: ${loadLevel}, Ayar faktörü: ${adjustmentFactor}`,
  );

  return {
    success: true,
    loadLevel,
    adjustmentFactor,
    newLimits: {
      postCreateLimit: updatedConfig.postCreateLimit,
      commentCreateLimit: updatedConfig.commentCreateLimit,
      voteLimit: updatedConfig.voteLimit,
    },
  };
});

// Yardımcı fonksiyonlar
/**
 * Premium kullanıcılar için muafiyet kontrolü
 */
const isExemptedFromLimit = (action, premiumTier) => {
  // Premium seviyelere göre muaf tutulan işlemler
  const exemptionsByTier = {
    basic: ['search', 'vote'],
    standard: ['search', 'vote', 'comment_create'],
    pro: ['search', 'vote', 'comment_create', 'message_send'],
    ultimate: ['search', 'vote', 'comment_create', 'message_send', 'poll_vote', 'poll_create'],
  };

  // Admin kullanıcısıysa tüm sınırlamalardan muaf
  if (premiumTier === 'admin') return true;

  // Premium seviyeye sahip değilse muaf değil
  if (!premiumTier || !exemptionsByTier[premiumTier]) return false;

  // İşlem muafiyet listesinde mi kontrol et
  return exemptionsByTier[premiumTier].includes(action);
};

/**
 * Premium kullanıcılar için muafiyetleri getir
 */
const getExemptionsForUser = (premiumTier) => {
  // Premium seviyelere göre muaf tutulan işlemler
  const exemptionsByTier = {
    basic: ['search', 'vote'],
    standard: ['search', 'vote', 'comment_create'],
    pro: ['search', 'vote', 'comment_create', 'message_send'],
    ultimate: ['search', 'vote', 'comment_create', 'message_send', 'poll_vote', 'poll_create'],
  };

  // Admin kullanıcısıysa tüm işlemler muaf
  if (premiumTier === 'admin') {
    return [
      'post_create',
      'comment_create',
      'vote',
      'message_send',
      'subreddit_create',
      'search',
      'poll_create',
      'poll_vote',
      'login_attempt',
    ];
  }

  // Premium seviyeye sahip değilse boş liste
  if (!premiumTier || !exemptionsByTier[premiumTier]) return [];

  // Premium seviyeye göre muafiyetleri döndür
  return exemptionsByTier[premiumTier];
};

/**
 * İşleme göre limit ayarlarını getir
 */
const getLimitSettingsForAction = (action, user) => {
  // Varsayılan limit ve pencere değerleri
  const defaultSettings = {
    userLimit: 10,
    ipLimit: 5,
    windowMs: 60 * 1000, // 1 dakika
  };

  // İşleme özel ayarlar
  const settingsByAction = {
    post_create: {
      userLimit: 5,
      ipLimit: 3,
      windowMs: 5 * 60 * 1000, // 5 dakika
    },
    comment_create: {
      userLimit: 20,
      ipLimit: 10,
      windowMs: 60 * 1000, // 1 dakika
    },
    vote: {
      userLimit: 30,
      ipLimit: 15,
      windowMs: 60 * 1000, // 1 dakika
    },
    message_send: {
      userLimit: 10,
      ipLimit: 5,
      windowMs: 10 * 60 * 1000, // 10 dakika
    },
    subreddit_create: {
      userLimit: 1,
      ipLimit: 1,
      windowMs: 24 * 60 * 60 * 1000, // 1 gün
    },
    search: {
      userLimit: 15,
      ipLimit: 10,
      windowMs: 60 * 1000, // 1 dakika
    },
    poll_create: {
      userLimit: 3,
      ipLimit: 2,
      windowMs: 15 * 60 * 1000, // 15 dakika
    },
    poll_vote: {
      userLimit: 20,
      ipLimit: 10,
      windowMs: 60 * 1000, // 1 dakika
    },
    login_attempt: {
      userLimit: 5,
      ipLimit: 5,
      windowMs: 10 * 60 * 1000, // 10 dakika
    },
  };

  // İşlem için ayarları getir, yoksa varsayılanları kullan
  const settings = settingsByAction[action] || defaultSettings;

  // Premium kullanıcı kontrolü
  if (user && user.isPremium) {
    const premiumMultipliers = {
      basic: 1.5,
      standard: 2,
      pro: 3,
      ultimate: 5,
    };

    const multiplier = premiumMultipliers[user.premiumTier] || 1;

    settings.userLimit = Math.round(settings.userLimit * multiplier);
  }

  return settings;
};

/**
 * Limit değeri doğrulama
 */
const validateLimitValue = (value, name, min, max) => {
  if (typeof value !== 'number') {
    throw new Error(`${name} bir sayı olmalıdır`);
  }

  if (value < min || value > max) {
    throw new Error(`${name} ${min} ile ${max} arasında olmalıdır`);
  }
};

/**
 * Varsayılan hız sınırı yapılandırması
 */
const getDefaultRateLimitConfig = () => {
  return {
    postCreateLimit: 5,
    basePostCreateLimit: 5,
    commentCreateLimit: 20,
    baseCommentCreateLimit: 20,
    voteLimit: 30,
    baseVoteLimit: 30,
    messageSendLimit: 10,
    subredditCreateLimit: 1,
    searchLimit: 15,
    pollCreateLimit: 3,
    pollVoteLimit: 20,
    loginAttemptLimit: 5,
    defaultWindowMs: 60 * 1000, // 1 dakika
    premiumMultiplier: 2,
    loadThresholds: {
      low: 500,
      moderate: 2000,
      high: 5000,
      critical: 10000,
    },
  };
};

module.exports = {
  checkRateLimit,
  recordAction,
  resetUserRateLimits,
  setSubredditRateLimits,
  getUserRateLimitStatus,
  updateGlobalRateLimits,
  createRateLimitExemption,
  removeRateLimitExemption,
  cleanExpiredExemptions,
  adjustRateLimitsBasedOnLoad,
  // Yardımcı fonksiyonları dışa açma (test için)
  _helpers: {
    isExemptedFromLimit,
    getExemptionsForUser,
    getLimitSettingsForAction,
    validateLimitValue,
    getDefaultRateLimitConfig,
  },
};
