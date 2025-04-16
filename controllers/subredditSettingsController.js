const SubredditSettings = require('../models/SubredditSettings');
const Subreddit = require('../models/Subreddit');
const SubredditMembership = require('../models/SubredditMembership'); // Assuming this model exists
const asyncHandler = require('../middleware/async');
const ErrorResponse = require('../utils/errorResponse');
const mongoose = require('mongoose');

/**
 * @desc    Subreddit ayarlarını getir
 * @route   GET /api/subreddits/:subredditId/settings
 * @access  Public (Bazı alanlar sadece moderatörler tarafından görülebilir)
 */
const getSubredditSettings = asyncHandler(async (req, res, next) => {
  const { subredditId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(subredditId)) {
    return next(new ErrorResponse('Geçersiz subreddit ID formatı', 400));
  }

  // Subreddit'in varlığını kontrol et
  const subreddit = await Subreddit.findById(subredditId);
  if (!subreddit) {
    return next(new ErrorResponse('Subreddit bulunamadı', 404));
  }

  // Ayarları getir
  let settings = await SubredditSettings.findOne({ subreddit: subredditId })
    .populate('updatedBy', 'username')
    .populate('subreddit', 'name title');

  // Eğer ayarlar yoksa varsayılan ayarlar oluştur
  if (!settings) {
    settings = await SubredditSettings.create({
      subreddit: subredditId,
    });
  }

  // Kullanıcının moderatör olup olmadığını kontrol et
  const isModerator = req.user && (await checkModeratorPermission(req.user._id, subredditId));

  // Moderatör değilse, hassas ayarları kaldır
  if (!isModerator) {
    // Hassas ayarları kaldır (automod yapılandırması gibi)
    const publicSettings = { ...settings.toObject() };
    delete publicSettings.automod;

    // Sadece appearance ve communityOptions bazı ayarlarını döndür
    return res.status(200).json({
      success: true,
      data: {
        appearance: publicSettings.appearance,
        communityOptions: {
          suggestedSortOption: publicSettings.communityOptions.suggestedSortOption,
          showPostKarma: publicSettings.communityOptions.showPostKarma,
          showCommentKarma: publicSettings.communityOptions.showCommentKarma,
          allowDownvotes: publicSettings.communityOptions.allowDownvotes,
        },
        allowPostTypes: publicSettings.allowPostTypes,
        requirePostFlair: publicSettings.requirePostFlair,
        allowUserFlair: publicSettings.allowUserFlair,
        contentOptions: {
          allowSpoilers: publicSettings.contentOptions.allowSpoilers,
          allowPollsBool: publicSettings.contentOptions.allowPolls,
          allowCrossposting: publicSettings.contentOptions.allowCrossposting,
        },
      },
    });
  }

  // Moderatörler için tüm ayarları döndür
  res.status(200).json({
    success: true,
    data: settings,
  });
});

/**
 * @desc    Subreddit ayarlarını güncelle
 * @route   PUT /api/subreddits/:subredditId/settings
 * @access  Private (Moderator/Admin)
 */
const updateSubredditSettings = asyncHandler(async (req, res, next) => {
  const { subredditId } = req.params;
  const userId = req.user._id;

  if (!mongoose.Types.ObjectId.isValid(subredditId)) {
    return next(new ErrorResponse('Geçersiz subreddit ID formatı', 400));
  }

  // Moderatör yetkisini kontrol et
  const isModerator = await checkModeratorPermission(userId, subredditId);
  if (!isModerator) {
    return next(new ErrorResponse('Bu işlem için moderatör yetkisi gerekiyor', 403));
  }

  // Subreddit'in varlığını kontrol et
  const subreddit = await Subreddit.findById(subredditId);
  if (!subreddit) {
    return next(new ErrorResponse('Subreddit bulunamadı', 404));
  }

  // İstek verilerini doğrula ve temizle
  const updateData = sanitizeAndValidateSettings(req.body);

  // Güncelleyeni ekle
  updateData.updatedBy = userId;

  // Ayarları bul ve güncelle, yoksa oluştur
  let settings = await SubredditSettings.findOne({ subreddit: subredditId });

  if (!settings) {
    // Ayarlar yoksa oluştur
    settings = await SubredditSettings.create({
      ...updateData,
      subreddit: subredditId,
    });
  } else {
    // Ayarları güncelle
    settings = await SubredditSettings.findOneAndUpdate({ subreddit: subredditId }, updateData, {
      new: true,
      runValidators: true,
    });
  }

  res.status(200).json({
    success: true,
    data: settings,
  });
});

/**
 * @desc    Görünüm ayarlarını güncelle
 * @route   PUT /api/subreddits/:subredditId/settings/appearance
 * @access  Private (Moderator/Admin)
 */
const updateAppearanceSettings = asyncHandler(async (req, res, next) => {
  const { subredditId } = req.params;
  const userId = req.user._id;

  if (!mongoose.Types.ObjectId.isValid(subredditId)) {
    return next(new ErrorResponse('Geçersiz subreddit ID formatı', 400));
  }

  // Moderatör yetkisini kontrol et
  const isModerator = await checkModeratorPermission(userId, subredditId);
  if (!isModerator) {
    return next(new ErrorResponse('Bu işlem için moderatör yetkisi gerekiyor', 403));
  }

  // İstek verilerini doğrula
  const appearanceData = req.body;

  // Özel CSS için güvenlik kontrolleri
  if (appearanceData.customCSS) {
    // Zararlı CSS kodunu temizle (gerçek uygulamada daha kapsamlı olmalı)
    appearanceData.customCSS = sanitizeCSS(appearanceData.customCSS);
  }

  // Renk kodlarını doğrula
  if (appearanceData.primaryColor && !isValidColor(appearanceData.primaryColor)) {
    return next(new ErrorResponse('Geçersiz renk kodu formatı', 400));
  }

  if (appearanceData.bannerColor && !isValidColor(appearanceData.bannerColor)) {
    return next(new ErrorResponse('Geçersiz banner renk kodu formatı', 400));
  }

  // Ayarları bul ve güncelle
  const settings = await SubredditSettings.findOneAndUpdate(
    { subreddit: subredditId },
    {
      appearance: appearanceData,
      updatedBy: userId,
    },
    {
      new: true,
      runValidators: true,
      upsert: true, // Eğer ayarlar yoksa oluştur
    },
  );

  res.status(200).json({
    success: true,
    data: settings.appearance,
  });
});

/**
 * @desc    İçerik izinleri ayarlarını güncelle
 * @route   PUT /api/subreddits/:subredditId/settings/content-options
 * @access  Private (Moderator/Admin)
 */
const updateContentOptions = asyncHandler(async (req, res, next) => {
  const { subredditId } = req.params;
  const userId = req.user._id;

  if (!mongoose.Types.ObjectId.isValid(subredditId)) {
    return next(new ErrorResponse('Geçersiz subreddit ID formatı', 400));
  }

  // Moderatör yetkisini kontrol et
  const isModerator = await checkModeratorPermission(userId, subredditId);
  if (!isModerator) {
    return next(new ErrorResponse('Bu işlem için moderatör yetkisi gerekiyor', 403));
  }

  // Ayarları bul ve güncelle
  const settings = await SubredditSettings.findOneAndUpdate(
    { subreddit: subredditId },
    {
      contentOptions: req.body,
      updatedBy: userId,
    },
    {
      new: true,
      runValidators: true,
      upsert: true,
    },
  );

  res.status(200).json({
    success: true,
    data: settings.contentOptions,
  });
});

/**
 * @desc    İzin verilen post tiplerini güncelle
 * @route   PUT /api/subreddits/:subredditId/settings/post-types
 * @access  Private (Moderator/Admin)
 */
const updateAllowedPostTypes = asyncHandler(async (req, res, next) => {
  const { subredditId } = req.params;
  const userId = req.user._id;
  const { allowPostTypes } = req.body;

  if (!mongoose.Types.ObjectId.isValid(subredditId)) {
    return next(new ErrorResponse('Geçersiz subreddit ID formatı', 400));
  }

  // Girdiyi doğrula
  if (!allowPostTypes || typeof allowPostTypes !== 'object') {
    return next(new ErrorResponse('Geçersiz post tipleri formatı', 400));
  }

  // En az bir post tipi aktif olmalı
  const hasActiveType = Object.values(allowPostTypes).some((value) => value === true);
  if (!hasActiveType) {
    return next(new ErrorResponse('En az bir post tipi izin verilmelidir', 400));
  }

  // Moderatör yetkisini kontrol et
  const isModerator = await checkModeratorPermission(userId, subredditId);
  if (!isModerator) {
    return next(new ErrorResponse('Bu işlem için moderatör yetkisi gerekiyor', 403));
  }

  // Ayarları bul ve güncelle
  const settings = await SubredditSettings.findOneAndUpdate(
    { subreddit: subredditId },
    {
      allowPostTypes: allowPostTypes,
      updatedBy: userId,
    },
    {
      new: true,
      runValidators: true,
      upsert: true,
    },
  );

  res.status(200).json({
    success: true,
    data: settings.allowPostTypes,
  });
});

/**
 * @desc    Topluluk ayarlarını güncelle
 * @route   PUT /api/subreddits/:subredditId/settings/community
 * @access  Private (Moderator/Admin)
 */
const updateCommunityOptions = asyncHandler(async (req, res, next) => {
  const { subredditId } = req.params;
  const userId = req.user._id;

  if (!mongoose.Types.ObjectId.isValid(subredditId)) {
    return next(new ErrorResponse('Geçersiz subreddit ID formatı', 400));
  }

  // Moderatör yetkisini kontrol et
  const isModerator = await checkModeratorPermission(userId, subredditId);
  if (!isModerator) {
    return next(new ErrorResponse('Bu işlem için moderatör yetkisi gerekiyor', 403));
  }

  // Ayarları bul ve güncelle
  const settings = await SubredditSettings.findOneAndUpdate(
    { subreddit: subredditId },
    {
      communityOptions: req.body,
      updatedBy: userId,
    },
    {
      new: true,
      runValidators: true,
      upsert: true,
    },
  );

  res.status(200).json({
    success: true,
    data: settings.communityOptions,
  });
});

/**
 * @desc    Spam filtresi ayarlarını güncelle
 * @route   PUT /api/subreddits/:subredditId/settings/spam-filter
 * @access  Private (Moderator/Admin)
 */
const updateSpamFilter = asyncHandler(async (req, res, next) => {
  const { subredditId } = req.params;
  const userId = req.user._id;
  const { spamFilter } = req.body;

  if (!mongoose.Types.ObjectId.isValid(subredditId)) {
    return next(new ErrorResponse('Geçersiz subreddit ID formatı', 400));
  }

  // Girdiyi doğrula
  if (!spamFilter || typeof spamFilter !== 'object') {
    return next(new ErrorResponse('Geçersiz spam filtresi formatı', 400));
  }

  // Değerleri doğrula
  const validLevels = ['low', 'medium', 'high'];
  if (spamFilter.posts && !validLevels.includes(spamFilter.posts)) {
    return next(new ErrorResponse('Geçersiz spam filtresi seviyesi (posts)', 400));
  }

  if (spamFilter.comments && !validLevels.includes(spamFilter.comments)) {
    return next(new ErrorResponse('Geçersiz spam filtresi seviyesi (comments)', 400));
  }

  // Moderatör yetkisini kontrol et
  const isModerator = await checkModeratorPermission(userId, subredditId);
  if (!isModerator) {
    return next(new ErrorResponse('Bu işlem için moderatör yetkisi gerekiyor', 403));
  }

  // ... continued from previous code

  // Ayarları bul ve güncelle
  const settings = await SubredditSettings.findOneAndUpdate(
    { subreddit: subredditId },
    {
      spamFilter: spamFilter,
      updatedBy: userId,
    },
    {
      new: true,
      runValidators: true,
      upsert: true,
    },
  );

  res.status(200).json({
    success: true,
    data: settings.spamFilter,
  });
});

/**
 * @desc    Automod ayarlarını güncelle
 * @route   PUT /api/subreddits/:subredditId/settings/automod
 * @access  Private (Moderator/Admin)
 */
const updateAutomod = asyncHandler(async (req, res, next) => {
  const { subredditId } = req.params;
  const userId = req.user._id;
  const { enabled, config } = req.body;

  if (!mongoose.Types.ObjectId.isValid(subredditId)) {
    return next(new ErrorResponse('Geçersiz subreddit ID formatı', 400));
  }

  // Moderatör yetkisini kontrol et
  const isModerator = await checkModeratorPermission(userId, subredditId);
  if (!isModerator) {
    return next(new ErrorResponse('Bu işlem için moderatör yetkisi gerekiyor', 403));
  }

  // Admin yetkisini kontrol et (automod için daha yüksek yetki gerekebilir)
  const isAdmin = await checkAdminPermission(userId, subredditId);

  // Eğer automod etkinleştiriliyorsa ve konfigürasyon varsa ancak admin değilse reddet
  if (enabled && config && !isAdmin) {
    return next(new ErrorResponse('Automod konfigürasyonu için admin yetkisi gerekiyor', 403));
  }

  // Automod konfigürasyon formatını doğrula
  if (config && !isValidAutomodConfig(config)) {
    return next(new ErrorResponse('Geçersiz automod konfigürasyon formatı', 400));
  }

  // Ayarları bul ve güncelle
  const automodSettings = {};
  if (typeof enabled === 'boolean') automodSettings['automod.enabled'] = enabled;
  if (config !== undefined) automodSettings['automod.config'] = config;

  const settings = await SubredditSettings.findOneAndUpdate(
    { subreddit: subredditId },
    {
      ...automodSettings,
      updatedBy: userId,
    },
    {
      new: true,
      runValidators: true,
      upsert: true,
    },
  );

  res.status(200).json({
    success: true,
    data: settings.automod,
  });
});

/**
 * @desc    Flair ayarlarını güncelle
 * @route   PUT /api/subreddits/:subredditId/settings/flair
 * @access  Private (Moderator/Admin)
 */
const updateFlairSettings = asyncHandler(async (req, res, next) => {
  const { subredditId } = req.params;
  const userId = req.user._id;
  const { requirePostFlair, allowUserFlair } = req.body;

  if (!mongoose.Types.ObjectId.isValid(subredditId)) {
    return next(new ErrorResponse('Geçersiz subreddit ID formatı', 400));
  }

  // Moderatör yetkisini kontrol et
  const isModerator = await checkModeratorPermission(userId, subredditId);
  if (!isModerator) {
    return next(new ErrorResponse('Bu işlem için moderatör yetkisi gerekiyor', 403));
  }

  // Update nesnesi oluştur
  const updateObj = {};
  if (typeof requirePostFlair === 'boolean') updateObj.requirePostFlair = requirePostFlair;
  if (typeof allowUserFlair === 'boolean') updateObj.allowUserFlair = allowUserFlair;
  updateObj.updatedBy = userId;

  // Ayarları bul ve güncelle
  const settings = await SubredditSettings.findOneAndUpdate({ subreddit: subredditId }, updateObj, {
    new: true,
    runValidators: true,
    upsert: true,
  });

  res.status(200).json({
    success: true,
    data: {
      requirePostFlair: settings.requirePostFlair,
      allowUserFlair: settings.allowUserFlair,
    },
  });
});

/**
 * @desc    Ayarları varsayılanlara sıfırla
 * @route   POST /api/subreddits/:subredditId/settings/reset
 * @access  Private (Admin)
 */
const resetSettings = asyncHandler(async (req, res, next) => {
  const { subredditId } = req.params;
  const userId = req.user._id;
  const { section } = req.body; // Belirli bir bölümü sıfırlamak için, opsiyonel

  if (!mongoose.Types.ObjectId.isValid(subredditId)) {
    return next(new ErrorResponse('Geçersiz subreddit ID formatı', 400));
  }

  // Admin yetkisini kontrol et
  const isAdmin = await checkAdminPermission(userId, subredditId);
  if (!isAdmin) {
    return next(new ErrorResponse('Bu işlem için admin yetkisi gerekiyor', 403));
  }

  let settings = await SubredditSettings.findOne({ subreddit: subredditId });
  if (!settings) {
    // Eğer ayarlar yoksa yeni oluştur
    settings = new SubredditSettings({ subreddit: subredditId });
  } else {
    // Belirli bir bölümü veya tüm ayarları sıfırla
    if (section) {
      // Belirli bir bölümü sıfırla
      switch (section) {
        case 'appearance':
          settings.appearance = undefined;
          break;
        case 'contentOptions':
          settings.contentOptions = undefined;
          break;
        case 'allowPostTypes':
          settings.allowPostTypes = undefined;
          break;
        case 'communityOptions':
          settings.communityOptions = undefined;
          break;
        case 'spamFilter':
          settings.spamFilter = undefined;
          break;
        case 'automod':
          settings.automod = undefined;
          break;
        default:
          return next(new ErrorResponse(`Bilinmeyen ayar bölümü: ${section}`, 400));
      }
    } else {
      // Tüm ayarları sıfırla, subreddit referansını ve tarih bilgilerini koru
      const subredditRef = settings.subreddit;
      settings = new SubredditSettings({ subreddit: subredditRef });
    }
  }

  settings.updatedBy = userId;
  await settings.save();

  res.status(200).json({
    success: true,
    message: section ? `${section} ayarları sıfırlandı` : 'Tüm ayarlar sıfırlandı',
    data: settings,
  });
});

// ==================== YARDIMCI FONKSİYONLAR ====================

/**
 * Moderatör yetkisini kontrol et
 * @param {ObjectId} userId - Kullanıcı ID
 * @param {ObjectId} subredditId - Subreddit ID
 * @returns {Promise<Boolean>} Moderatör yetkisi varsa true
 */
const checkModeratorPermission = async (userId, subredditId) => {
  // Admin her zaman yetkilidir
  const user = await mongoose.model('User').findById(userId);
  if (user && user.role === 'admin') {
    return true;
  }

  // Subreddit moderatörü mü kontrol et
  const membership = await SubredditMembership.findOne({
    user: userId,
    subreddit: subredditId,
    type: { $in: ['moderator', 'admin'] },
    status: 'active',
  });

  return !!membership;
};

/**
 * Admin yetkisini kontrol et
 * @param {ObjectId} userId - Kullanıcı ID
 * @param {ObjectId} subredditId - Subreddit ID
 * @returns {Promise<Boolean>} Admin yetkisi varsa true
 */
const checkAdminPermission = async (userId, subredditId) => {
  // Site admin'i mi kontrol et
  const user = await mongoose.model('User').findById(userId);
  if (user && user.role === 'admin') {
    return true;
  }

  // Subreddit admin'i mi kontrol et
  const membership = await SubredditMembership.findOne({
    user: userId,
    subreddit: subredditId,
    type: 'admin',
    status: 'active',
  });

  return !!membership;
};

/**
 * Ayarları temizle ve doğrula
 * @param {Object} settings - Ham ayar nesnesi
 * @returns {Object} Temizlenmiş ve doğrulanmış ayarlar
 */
const sanitizeAndValidateSettings = (settings) => {
  const sanitized = {};

  // allowPostTypes kontrolü
  if (settings.allowPostTypes) {
    sanitized.allowPostTypes = {};
    const validPostTypes = ['text', 'link', 'image', 'video', 'poll'];

    for (const type of validPostTypes) {
      if (typeof settings.allowPostTypes[type] === 'boolean') {
        sanitized.allowPostTypes[type] = settings.allowPostTypes[type];
      }
    }

    // En az bir tip aktif olmalı
    const anyEnabled = Object.values(sanitized.allowPostTypes).some((val) => val === true);
    if (!anyEnabled && Object.keys(sanitized.allowPostTypes).length > 0) {
      sanitized.allowPostTypes.text = true; // Varsayılan olarak text'e izin ver
    }
  }

  // Flair ayarları
  if (typeof settings.requirePostFlair === 'boolean') {
    sanitized.requirePostFlair = settings.requirePostFlair;
  }

  if (typeof settings.allowUserFlair === 'boolean') {
    sanitized.allowUserFlair = settings.allowUserFlair;
  }

  // Spam filtresi
  if (settings.spamFilter) {
    sanitized.spamFilter = {};
    const validLevels = ['low', 'medium', 'high'];

    if (settings.spamFilter.posts && validLevels.includes(settings.spamFilter.posts)) {
      sanitized.spamFilter.posts = settings.spamFilter.posts;
    }

    if (settings.spamFilter.comments && validLevels.includes(settings.spamFilter.comments)) {
      sanitized.spamFilter.comments = settings.spamFilter.comments;
    }
  }

  // Content options
  if (settings.contentOptions) {
    sanitized.contentOptions = {};
    const booleanOptions = [
      'allowSpoilers',
      'allowImageUploads',
      'allowMultipleImages',
      'allowPolls',
      'allowCrossposting',
      'allowArchiving',
    ];

    for (const option of booleanOptions) {
      if (typeof settings.contentOptions[option] === 'boolean') {
        sanitized.contentOptions[option] = settings.contentOptions[option];
      }
    }
  }

  // Community options
  if (settings.communityOptions) {
    sanitized.communityOptions = {};
    const booleanOptions = [
      'allowDownvotes',
      'showPostKarma',
      'showCommentKarma',
      'restrictPostingToMods',
      'approvePostsManually',
    ];

    for (const option of booleanOptions) {
      if (typeof settings.communityOptions[option] === 'boolean') {
        sanitized.communityOptions[option] = settings.communityOptions[option];
      }
    }

    // Suggested sort option
    const validSortOptions = ['best', 'top', 'new', 'controversial', 'old', 'qa'];
    if (
      settings.communityOptions.suggestedSortOption &&
      validSortOptions.includes(settings.communityOptions.suggestedSortOption)
    ) {
      sanitized.communityOptions.suggestedSortOption =
        settings.communityOptions.suggestedSortOption;
    }
  }

  // Appearance options
  if (settings.appearance) {
    sanitized.appearance = {};

    // Renk doğrulaması
    if (settings.appearance.primaryColor && isValidColor(settings.appearance.primaryColor)) {
      sanitized.appearance.primaryColor = settings.appearance.primaryColor;
    }

    if (settings.appearance.bannerColor && isValidColor(settings.appearance.bannerColor)) {
      sanitized.appearance.bannerColor = settings.appearance.bannerColor;
    }

    // Banner boyutu
    const validBannerHeights = ['small', 'medium', 'large'];
    if (
      settings.appearance.bannerHeight &&
      validBannerHeights.includes(settings.appearance.bannerHeight)
    ) {
      sanitized.appearance.bannerHeight = settings.appearance.bannerHeight;
    }

    // Boolean ayarlar
    if (typeof settings.appearance.showSubredditIcon === 'boolean') {
      sanitized.appearance.showSubredditIcon = settings.appearance.showSubredditIcon;
    }

    if (typeof settings.appearance.allowCustomTheme === 'boolean') {
      sanitized.appearance.allowCustomTheme = settings.appearance.allowCustomTheme;
    }

    // Özel CSS - güvenlik kontrolleri
    if (settings.appearance.customCSS) {
      sanitized.appearance.customCSS = sanitizeCSS(settings.appearance.customCSS);
    }
  }

  // Automod ayarları (sadece admin için)
  if (settings.automod) {
    sanitized.automod = {};

    if (typeof settings.automod.enabled === 'boolean') {
      sanitized.automod.enabled = settings.automod.enabled;
    }

    if (settings.automod.config && isValidAutomodConfig(settings.automod.config)) {
      sanitized.automod.config = settings.automod.config;
    }
  }

  return sanitized;
};

/**
 * Geçerli bir renk kodu mu kontrol et
 * @param {String} color - Renk kodu
 * @returns {Boolean} Geçerli ise true
 */
const isValidColor = (color) => {
  // Hex color regex kontrolü
  return /^#([0-9A-F]{3}){1,2}$/i.test(color);
};

/**

* CSS içeriğini temizle
* @param {String} css - CSS içeriği
* @returns {String} Temizlenmiş CSS
*/
const sanitizeCSS = (css) => {
  // Burada gerçek bir CSS sanitizer kullanılmalı
  // Bu basit örnek için potansiyel tehlikeli içeriği kaldırıyoruz

  // Başka kaynaklardan içerik yüklemeyi engelle
  let sanitized = css.replace(/@import\s+url/gi, '/* @import url */');

  // Javascript kodlarını engelle
  sanitized = sanitized.replace(/expression\s*\(/gi, '/* expression( */');
  sanitized = sanitized.replace(/javascript\s*:/gi, '/* javascript: */');

  // İframe engelle
  sanitized = sanitized.replace(/position\s*:\s*fixed/gi, 'position: /* fixed */relative');

  // CSS boyutunu sınırla (10kb)
  const MAX_SIZE = 10 * 1024; // 10kb
  if (sanitized.length > MAX_SIZE) {
    sanitized = sanitized.substring(0, MAX_SIZE);
  }

  return sanitized;
};

/**
 * Automod konfigürasyonunu doğrula
 * @param {String} config - Automod konfigürasyonu
 * @returns {Boolean} Geçerli ise true
 */
const isValidAutomodConfig = (config) => {
  // Gerçek uygulamada automod konfigürasyonunun sözdizimi kontrolü yapılmalı
  // Burada basit bir boyut ve format kontrolü yapıyoruz

  // Boş olabilir
  if (!config) return true;

  // Maksimum boyut kontrolü (50kb)
  const MAX_SIZE = 50 * 1024;
  if (config.length > MAX_SIZE) {
    return false;
  }

  try {
    // YAML formatında olmalı, ancak burada sadece genel bir yapı kontrolü yapıyoruz
    // Her bir satırın "---" ile başlaması veya belirli bir yapıda olması gerekebilir
    const lines = config.split('\n');
    let hasValidStructure = false;

    // En az 1 geçerli kural bloğu olmalı
    for (const line of lines) {
      if (line.trim().startsWith('type:') || line.trim().startsWith('---')) {
        hasValidStructure = true;
        break;
      }
    }

    return hasValidStructure;
  } catch (error) {
    return false;
  }
};

/**
 * @desc    Ayar bölümlerini getir
 * @route   GET /api/subreddits/:subredditId/settings/:section
 * @access  Mixed (Bazı bölümler public, bazıları moderatör)
 */
const getSettingsSection = asyncHandler(async (req, res, next) => {
  const { subredditId, section } = req.params;

  if (!mongoose.Types.ObjectId.isValid(subredditId)) {
    return next(new ErrorResponse('Geçersiz subreddit ID formatı', 400));
  }

  // Geçerli bölüm kontrolü
  const validSections = [
    'appearance',
    'contentOptions',
    'allowPostTypes',
    'communityOptions',
    'spamFilter',
    'automod',
  ];

  if (!validSections.includes(section)) {
    return next(new ErrorResponse(`Geçersiz ayar bölümü: ${section}`, 400));
  }

  // Subreddit'in varlığını kontrol et
  const subreddit = await Subreddit.findById(subredditId);
  if (!subreddit) {
    return next(new ErrorResponse('Subreddit bulunamadı', 404));
  }

  // Ayarları getir
  const settings = await SubredditSettings.findOne({ subreddit: subredditId });
  if (!settings) {
    // Varsayılan ayarları döndür
    const defaultSettings = new SubredditSettings({ subreddit: subredditId });
    return res.status(200).json({
      success: true,
      data: defaultSettings[section],
    });
  }

  // Sadece moderatörler görebilir
  const moderatorOnlySections = ['automod', 'spamFilter'];
  if (moderatorOnlySections.includes(section)) {
    // Kullanıcı giriş yapmış mı kontrol et
    if (!req.user) {
      return next(new ErrorResponse('Bu ayarları görüntülemek için giriş yapmalısınız', 401));
    }

    // Moderatör yetkisini kontrol et
    const isModerator = await checkModeratorPermission(req.user._id, subredditId);
    if (!isModerator) {
      return next(
        new ErrorResponse('Bu ayarları görüntülemek için moderatör yetkisi gerekiyor', 403),
      );
    }
  }

  res.status(200).json({
    success: true,
    data: settings[section],
  });
});

/**
 * @desc    Subreddit ayarlarının özetini getir (public özellikler)
 * @route   GET /api/subreddits/:subredditId/settings/summary
 * @access  Public
 */
const getSettingsSummary = asyncHandler(async (req, res, next) => {
  const { subredditId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(subredditId)) {
    return next(new ErrorResponse('Geçersiz subreddit ID formatı', 400));
  }

  // Subreddit'in varlığını kontrol et
  const subreddit = await Subreddit.findById(subredditId);
  if (!subreddit) {
    return next(new ErrorResponse('Subreddit bulunamadı', 404));
  }

  // Ayarları getir
  let settings = await SubredditSettings.findOne({ subreddit: subredditId });

  // Eğer ayarlar yoksa varsayılan ayarlar oluştur
  if (!settings) {
    settings = new SubredditSettings({ subreddit: subredditId });
  }

  // Sadece public bilgileri döndür
  const summary = {
    appearance: {
      primaryColor: settings.appearance.primaryColor,
      bannerColor: settings.appearance.bannerColor,
      bannerHeight: settings.appearance.bannerHeight,
      showSubredditIcon: settings.appearance.showSubredditIcon,
    },
    contentFeatures: {
      allowSpoilers: settings.contentOptions.allowSpoilers,
      allowPolls: settings.contentOptions.allowPolls,
      allowCrossposting: settings.contentOptions.allowCrossposting,
    },
    postTypes: {
      text: settings.allowPostTypes.text,
      link: settings.allowPostTypes.link,
      image: settings.allowPostTypes.image,
      video: settings.allowPostTypes.video,
      poll: settings.allowPostTypes.poll,
    },
    flairSettings: {
      requirePostFlair: settings.requirePostFlair,
      allowUserFlair: settings.allowUserFlair,
    },
    communityFeatures: {
      allowDownvotes: settings.communityOptions.allowDownvotes,
      showKarma:
        settings.communityOptions.showPostKarma && settings.communityOptions.showCommentKarma,
      suggestedSortOption: settings.communityOptions.suggestedSortOption,
    },
  };

  res.status(200).json({
    success: true,
    data: summary,
  });
});

module.exports = {
  getSubredditSettings,
  updateSubredditSettings,
  updateAppearanceSettings,
  updateContentOptions,
  updateAllowedPostTypes,
  updateCommunityOptions,
  updateSpamFilter,
  updateAutomod,
  updateFlairSettings,
  resetSettings,
  getSettingsSection,
  getSettingsSummary,
};
