const RateLimit = require('../models/RateLimit');
const User = require('../models/User');
const mongoose = require('mongoose');
const asyncHandler = require('../middleware/async');
const ErrorResponse = require('../utils/errorResponse');
const { isValidIPAddress } = require('../utils/validators');

/**
 * @desc    Hız sınırını kontrol et ve uygula
 * @note    Middleware olarak kullanılmak üzere tasarlanmıştır
 * @access  Public
 */
const checkRateLimit = asyncHandler(async (req, res, next) => {
  const userId = req.user ? req.user._id : null;
  const endpoint = req.originalUrl.split('?')[0]; // Query parametrelerini kaldır
  const method = req.method;
  const ipAddress = req.ip || req.connection.remoteAddress;

  // Kullanıcı oturum açmamışsa ve IP adresi geçersizse geç
  if (!userId && !isValidIPAddress(ipAddress)) {
    return next();
  }

  // Admin kullanıcıları rate limit'ten muaf tut
  if (req.user && req.user.role === 'admin') {
    return next();
  }

  // Rate limit kriterlerini belirle
  const query = {
    endpoint,
    method,
  };

  // Kullanıcı veya IP ile limitle
  if (userId) {
    query.user = userId;
  } else {
    query.ipAddress = ipAddress;
  }

  // Kullanıcının mevcut rate limit kaydını bul veya oluştur
  let rateLimit = await RateLimit.findOne(query);

  // Kullanıcı limitini belirle (premium kullanıcılar için farklı limit)
  let maxRequests = 60; // Varsayılan limit
  let windowMs = 60000; // 1 dakika (milisaniye)

  // Premium kullanıcılar için daha yüksek limit
  if (req.user && req.user.isPremium) {
    maxRequests = 120;
  }

  // Endpoint'e özel limitler (varsayılanı geçersiz kılar)
  const endpointLimits = {
    '/api/posts': { maxRequests: 30, windowMs: 60000 }, // Post oluşturma
    '/api/comments': { maxRequests: 40, windowMs: 60000 }, // Yorum yapma
    '/api/votes': { maxRequests: 100, windowMs: 60000 }, // Oylama
    '/api/subreddits': { maxRequests: 5, windowMs: 300000 }, // Subreddit oluşturma (5 dakikada 5)
    '/api/auth/register': { maxRequests: 3, windowMs: 3600000 }, // Kayıt (saatte 3)
  };

  // Endpoint'e özel limitleri uygula
  for (const [path, limits] of Object.entries(endpointLimits)) {
    if (endpoint.startsWith(path)) {
      maxRequests = limits.maxRequests;
      windowMs = limits.windowMs;
      break;
    }
  }

  const now = new Date();

  if (!rateLimit) {
    // Yeni rate limit kaydı oluştur
    rateLimit = await RateLimit.create({
      user: userId,
      endpoint,
      method,
      count: 1,
      resetAt: new Date(now.getTime() + windowMs),
      ipAddress: userId ? undefined : ipAddress,
      createdAt: now,
      updatedAt: now,
    });

    return next();
  }

  // Rate limit süresi dolmuşsa sıfırla
  if (now >= rateLimit.resetAt) {
    rateLimit.count = 1;
    rateLimit.resetAt = new Date(now.getTime() + windowMs);
    rateLimit.updatedAt = now;
    await rateLimit.save();

    return next();
  }

  // Rate limit kontrolü
  if (rateLimit.count >= maxRequests) {
    // Limit aşıldı
    const resetTime = Math.ceil((rateLimit.resetAt - now) / 1000);

    // Rate limit headers'ı ekle
    res.set({
      'X-RateLimit-Limit': maxRequests,
      'X-RateLimit-Remaining': 0,
      'X-RateLimit-Reset': resetTime,
    });

    // Rate limit log (istatistikler için)
    if (userId) {
      await logRateLimitExceeded(userId, endpoint, method, ipAddress);
    }

    return res.status(429).json({
      success: false,
      error: 'Rate limit aşıldı',
      message: `Çok fazla istek gönderdiniz. Lütfen ${resetTime} saniye sonra tekrar deneyin.`,
    });
  }

  // Limit aşılmadı, sayacı artır
  rateLimit.count += 1;
  rateLimit.updatedAt = now;
  await rateLimit.save();

  // Rate limit headers'ı ekle
  res.set({
    'X-RateLimit-Limit': maxRequests,
    'X-RateLimit-Remaining': maxRequests - rateLimit.count,
    'X-RateLimit-Reset': Math.ceil((rateLimit.resetAt - now) / 1000),
  });

  next();
});

/**
 * @desc    Rate limit aşıldığında log tut
 * @private Yalnızca dahili kullanım için
 */
const logRateLimitExceeded = async (userId, endpoint, method, ipAddress) => {
  try {
    await RateLimitLog.create({
      user: userId,
      endpoint,
      method,
      ipAddress,
      timestamp: new Date(),
    });
  } catch (error) {
    console.error('Rate limit log hatası:', error);
  }
};

/**
 * @desc    Tüm rate limit kayıtlarını listele (admin panel için)
 * @route   GET /api/admin/rate-limits
 * @access  Private (Admin)
 */
const getRateLimits = asyncHandler(async (req, res, next) => {
  // Filtreleme ve sayfalama seçenekleri
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;
  const startIndex = (page - 1) * limit;

  const { userId, endpoint, method, ipAddress } = req.query;
  let query = {};

  // Filtreleri uygula
  if (userId && mongoose.Types.ObjectId.isValid(userId)) {
    query.user = userId;
  }

  if (endpoint) {
    query.endpoint = { $regex: endpoint, $options: 'i' };
  }

  if (method) {
    query.method = method.toUpperCase();
  }

  if (ipAddress) {
    query.ipAddress = { $regex: ipAddress, $options: 'i' };
  }

  // Toplam sayı ve kayıtları getir
  const total = await RateLimit.countDocuments(query);

  const rateLimits = await RateLimit.find(query)
    .sort({ updatedAt: -1 })
    .skip(startIndex)
    .limit(limit)
    .populate('user', 'username email role isPremium');

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
    count: rateLimits.length,
    pagination,
    data: rateLimits,
  });
});

/**
 * @desc    Belirli bir kullanıcının rate limit bilgilerini getir
 * @route   GET /api/admin/rate-limits/users/:userId
 * @access  Private (Admin)
 */
const getUserRateLimits = asyncHandler(async (req, res, next) => {
  const { userId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(userId)) {
    return next(new ErrorResponse('Geçersiz kullanıcı ID formatı', 400));
  }

  // Kullanıcının varlığını kontrol et
  const user = await User.findById(userId);
  if (!user) {
    return next(new ErrorResponse('Kullanıcı bulunamadı', 404));
  }

  // Kullanıcının tüm rate limit kayıtlarını getir
  const rateLimits = await RateLimit.find({ user: userId }).sort({ updatedAt: -1 });

  res.status(200).json({
    success: true,
    count: rateLimits.length,
    data: {
      user: {
        _id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        isPremium: user.isPremium,
      },
      rateLimits,
    },
  });
});

/**
 * @desc    Kullanıcının rate limit kayıtlarını sıfırla
 * @route   DELETE /api/admin/rate-limits/users/:userId
 * @access  Private (Admin)
 */
const resetUserRateLimits = asyncHandler(async (req, res, next) => {
  const { userId } = req.params;
  const { endpoint } = req.query; // İsteğe bağlı: belirli bir endpoint'i sıfırlamak için

  if (!mongoose.Types.ObjectId.isValid(userId)) {
    return next(new ErrorResponse('Geçersiz kullanıcı ID formatı', 400));
  }

  // Kullanıcının varlığını kontrol et
  const user = await User.findById(userId);
  if (!user) {
    return next(new ErrorResponse('Kullanıcı bulunamadı', 404));
  }

  // Sıfırlama sorgusu oluştur
  const query = { user: userId };

  // Eğer belirli bir endpoint belirtilmişse sorguya ekle
  if (endpoint) {
    query.endpoint = endpoint;
  }

  // Rate limit kayıtlarını sil
  const result = await RateLimit.deleteMany(query);

  // Admin log kaydı tut
  await AdminLog.create({
    user: req.user._id,
    targetUser: userId,
    action: 'reset_rate_limits',
    details: endpoint
      ? `${user.username} kullanıcısının ${endpoint} endpoint için rate limit kayıtları sıfırlandı`
      : `${user.username} kullanıcısının tüm rate limit kayıtları sıfırlandı`,
    ip: req.ip,
  });

  res.status(200).json({
    success: true,
    message: endpoint
      ? `${endpoint} endpoint için rate limit kayıtları sıfırlandı`
      : 'Tüm rate limit kayıtları sıfırlandı',
    data: {
      deletedCount: result.deletedCount,
    },
  });
});

/**
 * @desc    Sistem genelinde rate limit istatistiklerini getir
 * @route   GET /api/admin/rate-limits/stats
 * @access  Private (Admin)
 */
const getRateLimitStats = asyncHandler(async (req, res, next) => {
  // En çok limit aşılan endpointler
  const topEndpoints = await RateLimitLog.aggregate([
    {
      $group: {
        _id: '$endpoint',
        count: { $sum: 1 },
      },
    },
    { $sort: { count: -1 } },
    { $limit: 10 },
  ]);

  // En çok limit aşan kullanıcılar
  const topUsers = await RateLimitLog.aggregate([
    {
      $group: {
        _id: '$user',
        count: { $sum: 1 },
      },
    },
    { $sort: { count: -1 } },
    { $limit: 10 },
    {
      $lookup: {
        from: 'users',
        localField: '_id',
        foreignField: '_id',
        as: 'userInfo',
      },
    },
    {
      $project: {
        count: 1,
        username: { $arrayElemAt: ['$userInfo.username', 0] },
        email: { $arrayElemAt: ['$userInfo.email', 0] },
      },
    },
  ]);

  // Zaman içindeki rate limit aşım grafiği
  const timeStats = await RateLimitLog.aggregate([
    {
      $group: {
        _id: {
          year: { $year: '$timestamp' },
          month: { $month: '$timestamp' },
          day: { $dayOfMonth: '$timestamp' },
          hour: { $hour: '$timestamp' },
        },
        count: { $sum: 1 },
      },
    },
    { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1, '_id.hour': 1 } },
    { $limit: 168 }, // Son 7 gün (24*7)
  ]);

  // IP bazlı istatistikler
  const ipStats = await RateLimitLog.aggregate([
    {
      $group: {
        _id: '$ipAddress',
        count: { $sum: 1 },
      },
    },
    { $sort: { count: -1 } },
    { $limit: 10 },
  ]);

  // HTTP methodu bazlı istatistikler
  const methodStats = await RateLimitLog.aggregate([
    {
      $group: {
        _id: '$method',
        count: { $sum: 1 },
      },
    },
    { $sort: { count: -1 } },
  ]);

  // Özet istatistikler
  const totalLimits = await RateLimit.countDocuments();
  const totalLogs = await RateLimitLog.countDocuments();
  const activeUsers = await RateLimit.distinct('user').length;

  // Aktif rate limitler (süresi dolmamış)
  const activeLimits = await RateLimit.countDocuments({
    resetAt: { $gt: new Date() },
  });

  res.status(200).json({
    success: true,
    data: {
      summary: {
        totalRateLimits: totalLimits,
        activeLimits,
        totalExceededLogs: totalLogs,
        uniqueUsers: activeUsers,
      },
      topEndpoints,
      topUsers,
      timeStats,
      ipStats,
      methodStats,
    },
  });
});

/**
 * @desc    Belirli bir endpoint için rate limit ayarlarını güncelle
 * @route   PUT /api/admin/rate-limits/settings
 * @access  Private (Admin)
 */
const updateRateLimitSettings = asyncHandler(async (req, res, next) => {
  const { endpoint, method, maxRequests, windowMs, userTypes } = req.body;

  // Gerekli alanların kontrolü
  if (!endpoint || !method || !maxRequests || !windowMs) {
    return next(
      new ErrorResponse('Endpoint, method, maxRequests ve windowMs alanları zorunludur', 400),
    );
  }

  // maxRequests ve windowMs değerlerinin geçerliliğini kontrol et
  if (maxRequests < 1 || windowMs < 1000) {
    return next(new ErrorResponse('Geçersiz maxRequests veya windowMs değeri', 400));
  }

  // Rate limit ayarını bul veya oluştur
  let settings = await RateLimitSettings.findOne({ endpoint, method });

  if (settings) {
    settings.maxRequests = maxRequests;
    settings.windowMs = windowMs;

    if (userTypes) {
      settings.userTypes = userTypes;
    }

    await settings.save();
  } else {
    settings = await RateLimitSettings.create({
      endpoint,
      method,
      maxRequests,
      windowMs,
      userTypes: userTypes || {
        regular: maxRequests,
        premium: maxRequests * 2,
        moderator: maxRequests * 5,
      },
      createdBy: req.user._id,
    });
  }

  // Admin log kaydı tut
  await AdminLog.create({
    user: req.user._id,
    action: 'update_rate_limit_settings',
    details: `${endpoint} endpoint için rate limit ayarları güncellendi`,
    ip: req.ip,
  });

  res.status(200).json({
    success: true,
    data: settings,
    message: 'Rate limit ayarları başarıyla güncellendi',
  });
});

/**
 * @desc    Tüm rate limit ayarlarını listele
 * @route   GET /api/admin/rate-limits/settings
 * @access  Private (Admin)
 */
const getRateLimitSettings = asyncHandler(async (req, res, next) => {
  const settings = await RateLimitSettings.find()
    .sort({ endpoint: 1, method: 1 })
    .populate('createdBy', 'username');

  res.status(200).json({
    success: true,
    count: settings.length,
    data: settings,
  });
});

/**
 * @desc    Bir rate limit ayarını sil
 * @route   DELETE /api/admin/rate-limits/settings/:id
 * @access  Private (Admin)
 */
const deleteRateLimitSetting = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorResponse('Geçersiz ayar ID formatı', 400));
  }

  const setting = await RateLimitSettings.findById(id);

  if (!setting) {
    return next(new ErrorResponse('Rate limit ayarı bulunamadı', 404));
  }

  await setting.remove();

  // Admin log kaydı tut
  await AdminLog.create({
    user: req.user._id,
    action: 'delete_rate_limit_setting',
    details: `${setting.endpoint} endpoint için rate limit ayarı silindi`,
    ip: req.ip,
  });

  res.status(200).json({
    success: true,
    data: {},
    message: 'Rate limit ayarı başarıyla silindi',
  });
});

/**
 * @desc    Belirli bir IP adresi için tüm rate limitleri sıfırla
 * @route   DELETE /api/admin/rate-limits/ip/:ipAddress
 * @access  Private (Admin)
 */
const resetIPRateLimits = asyncHandler(async (req, res, next) => {
  const { ipAddress } = req.params;

  if (!isValidIPAddress(ipAddress)) {
    return next(new ErrorResponse('Geçersiz IP adresi formatı', 400));
  }

  // IP adresine ait rate limitleri sil
  const result = await RateLimit.deleteMany({ ipAddress });

  // Admin log kaydı tut
  await AdminLog.create({
    user: req.user._id,
    action: 'reset_ip_rate_limits',
    details: `${ipAddress} IP adresi için rate limitler sıfırlandı`,
    ip: req.ip,
  });

  res.status(200).json({
    success: true,
    message: `${ipAddress} IP adresi için rate limitler sıfırlandı`,
    data: {
      deletedCount: result.deletedCount,
    },
  });
});

/**
 * @desc    Subreddit özel rate limit ayarlarını güncelle
 * @route   PUT /api/subreddits/:subredditId/settings/rate-limits
 * @access  Private (Subreddit mod veya Admin)
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
    action: 'update_rate_limits',
    details: `Subreddit rate limit ayarları güncellendi: Post: ${postLimit}, Yorum: ${commentLimit}, Pencere: ${windowMs}ms`,
  });

  res.status(200).json({
    success: true,
    data: updatedSubreddit.rateLimits,
    message: 'Subreddit rate limit ayarları başarıyla güncellendi',
  });
});

module.exports = {
  checkRateLimit,
  getRateLimits,
  getUserRateLimits,
  resetUserRateLimits,
  getRateLimitStats,
  updateRateLimitSettings,
  getRateLimitSettings,
  deleteRateLimitSetting,
  resetIPRateLimits,
  setSubredditRateLimits,
};
