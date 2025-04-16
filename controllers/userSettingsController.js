const UserSettings = require('../models/UserSettings');
const User = require('../models/User');
const asyncHandler = require('../middleware/async');
const ErrorResponse = require('../utils/errorResponse');
const mongoose = require('mongoose');

/**
 * @desc    Kullanıcı ayarlarını getir
 * @route   GET /api/users/settings
 * @access  Private
 */
const getUserSettings = asyncHandler(async (req, res, next) => {
  const userId = req.user.id;

  let userSettings = await UserSettings.findOne({ user: userId });

  // Eğer kullanıcı için henüz ayar oluşturulmamışsa, varsayılan ayarları oluştur
  if (!userSettings) {
    userSettings = await UserSettings.create({ user: userId });
  }

  res.status(200).json({
    success: true,
    data: userSettings,
  });
});

/**
 * @desc    İçerik tercihlerini güncelle
 * @route   PUT /api/users/settings/content-preferences
 * @access  Private
 */
const updateContentPreferences = asyncHandler(async (req, res, next) => {
  const userId = req.user.id;
  const {
    adultContent,
    autoplayMedia,
    showNSFWContent,
    blurNSFWImages,
    showSpoilers,
    highlightNewComments,
    defaultCommentSort,
    defaultPostSort,
  } = req.body;

  // Ayarları al veya oluştur
  let userSettings = await UserSettings.findOne({ user: userId });
  if (!userSettings) {
    userSettings = await UserSettings.create({ user: userId });
  }

  // Gelen değerleri güncelle
  if (adultContent !== undefined) userSettings.contentPreferences.adultContent = adultContent;
  if (autoplayMedia !== undefined) userSettings.contentPreferences.autoplayMedia = autoplayMedia;
  if (showNSFWContent !== undefined)
    userSettings.contentPreferences.showNSFWContent = showNSFWContent;
  if (blurNSFWImages !== undefined) userSettings.contentPreferences.blurNSFWImages = blurNSFWImages;
  if (showSpoilers !== undefined) userSettings.contentPreferences.showSpoilers = showSpoilers;
  if (highlightNewComments !== undefined)
    userSettings.contentPreferences.highlightNewComments = highlightNewComments;

  // Enum kontrolü
  const validCommentSorts = ['best', 'top', 'new', 'controversial', 'old', 'qa'];
  if (defaultCommentSort && validCommentSorts.includes(defaultCommentSort)) {
    userSettings.contentPreferences.defaultCommentSort = defaultCommentSort;
  }

  const validPostSorts = ['hot', 'new', 'top', 'rising', 'controversial'];
  if (defaultPostSort && validPostSorts.includes(defaultPostSort)) {
    userSettings.contentPreferences.defaultPostSort = defaultPostSort;
  }

  await userSettings.save();

  res.status(200).json({
    success: true,
    data: userSettings.contentPreferences,
    message: 'İçerik tercihleri başarıyla güncellendi',
  });
});

/**
 * @desc    Feed ayarlarını güncelle
 * @route   PUT /api/users/settings/feed
 * @access  Private
 */
const updateFeedSettings = asyncHandler(async (req, res, next) => {
  const userId = req.user.id;
  const { showVotedPosts, showPostsFromSubreddits, hideByKeyword, hideSubreddits } = req.body;

  // Ayarları al veya oluştur
  let userSettings = await UserSettings.findOne({ user: userId });
  if (!userSettings) {
    userSettings = await UserSettings.create({ user: userId });
  }

  // Gelen değerleri güncelle
  if (showVotedPosts !== undefined) userSettings.feedSettings.showVotedPosts = showVotedPosts;
  if (showPostsFromSubreddits !== undefined)
    userSettings.feedSettings.showPostsFromSubreddits = showPostsFromSubreddits;

  // Content filters
  if (hideByKeyword) {
    // Eğer dizi olarak gelmişse doğrudan ata, string olarak gelmişse virgülle ayırıp dizi yap
    if (Array.isArray(hideByKeyword)) {
      userSettings.feedSettings.contentFilters.hideByKeyword = hideByKeyword;
    } else if (typeof hideByKeyword === 'string') {
      userSettings.feedSettings.contentFilters.hideByKeyword = hideByKeyword
        .split(',')
        .map((k) => k.trim());
    }
  }

  if (hideSubreddits) {
    // Subreddit ID'lerini kontrol et
    if (Array.isArray(hideSubreddits)) {
      const validIds = hideSubreddits.filter((id) => mongoose.Types.ObjectId.isValid(id));
      userSettings.feedSettings.contentFilters.hideSubreddits = validIds;
    }
  }

  await userSettings.save();

  res.status(200).json({
    success: true,
    data: userSettings.feedSettings,
    message: 'Feed ayarları başarıyla güncellendi',
  });
});

/**
 * @desc    Gizlilik ayarlarını güncelle
 * @route   PUT /api/users/settings/privacy
 * @access  Private
 */
const updatePrivacySettings = asyncHandler(async (req, res, next) => {
  const userId = req.user.id;
  const {
    profileVisibility,
    showActiveInCommunities,
    allowDirectMessages,
    allowMentions,
    allowFollowers,
  } = req.body;

  // Ayarları al veya oluştur
  let userSettings = await UserSettings.findOne({ user: userId });
  if (!userSettings) {
    userSettings = await UserSettings.create({ user: userId });
  }

  // Gelen değerleri güncelle
  if (profileVisibility && ['public', 'private'].includes(profileVisibility)) {
    userSettings.privacySettings.profileVisibility = profileVisibility;
  }

  if (showActiveInCommunities !== undefined)
    userSettings.privacySettings.showActiveInCommunities = showActiveInCommunities;
  if (allowDirectMessages !== undefined)
    userSettings.privacySettings.allowDirectMessages = allowDirectMessages;
  if (allowMentions !== undefined) userSettings.privacySettings.allowMentions = allowMentions;
  if (allowFollowers !== undefined) userSettings.privacySettings.allowFollowers = allowFollowers;

  await userSettings.save();

  res.status(200).json({
    success: true,
    data: userSettings.privacySettings,
    message: 'Gizlilik ayarları başarıyla güncellendi',
  });
});

/**
 * @desc    Email bildirim ayarlarını güncelle
 * @route   PUT /api/users/settings/email-notifications
 * @access  Private
 */
const updateEmailNotifications = asyncHandler(async (req, res, next) => {
  const userId = req.user.id;
  const {
    newMessages,
    newCommentReplies,
    newPostReplies,
    mentions,
    upvotesOnPosts,
    upvotesOnComments,
    newsletterAndUpdates,
  } = req.body;

  // Ayarları al veya oluştur
  let userSettings = await UserSettings.findOne({ user: userId });
  if (!userSettings) {
    userSettings = await UserSettings.create({ user: userId });
  }

  // Gelen değerleri güncelle
  if (newMessages !== undefined) userSettings.emailNotifications.newMessages = newMessages;
  if (newCommentReplies !== undefined)
    userSettings.emailNotifications.newCommentReplies = newCommentReplies;
  if (newPostReplies !== undefined) userSettings.emailNotifications.newPostReplies = newPostReplies;
  if (mentions !== undefined) userSettings.emailNotifications.mentions = mentions;
  if (upvotesOnPosts !== undefined) userSettings.emailNotifications.upvotesOnPosts = upvotesOnPosts;
  if (upvotesOnComments !== undefined)
    userSettings.emailNotifications.upvotesOnComments = upvotesOnComments;
  if (newsletterAndUpdates !== undefined)
    userSettings.emailNotifications.newsletterAndUpdates = newsletterAndUpdates;

  await userSettings.save();

  res.status(200).json({
    success: true,
    data: userSettings.emailNotifications,
    message: 'Email bildirim ayarları başarıyla güncellendi',
  });
});

/**
 * @desc    Push bildirim ayarlarını güncelle
 * @route   PUT /api/users/settings/push-notifications
 * @access  Private
 */
const updatePushNotifications = asyncHandler(async (req, res, next) => {
  const userId = req.user.id;
  const {
    enabled,
    newMessages,
    newCommentReplies,
    newPostReplies,
    mentions,
    upvotesOnPosts,
    upvotesOnComments,
  } = req.body;

  // Ayarları al veya oluştur
  let userSettings = await UserSettings.findOne({ user: userId });
  if (!userSettings) {
    userSettings = await UserSettings.create({ user: userId });
  }

  // Gelen değerleri güncelle
  if (enabled !== undefined) userSettings.pushNotifications.enabled = enabled;
  if (newMessages !== undefined) userSettings.pushNotifications.newMessages = newMessages;
  if (newCommentReplies !== undefined)
    userSettings.pushNotifications.newCommentReplies = newCommentReplies;
  if (newPostReplies !== undefined) userSettings.pushNotifications.newPostReplies = newPostReplies;
  if (mentions !== undefined) userSettings.pushNotifications.mentions = mentions;
  if (upvotesOnPosts !== undefined) userSettings.pushNotifications.upvotesOnPosts = upvotesOnPosts;
  if (upvotesOnComments !== undefined)
    userSettings.pushNotifications.upvotesOnComments = upvotesOnComments;

  await userSettings.save();

  res.status(200).json({
    success: true,
    data: userSettings.pushNotifications,
    message: 'Push bildirim ayarları başarıyla güncellendi',
  });
});

/**
 * @desc    Sohbet ayarlarını güncelle
 * @route   PUT /api/users/settings/chat
 * @access  Private
 */
const updateChatSettings = asyncHandler(async (req, res, next) => {
  const userId = req.user.id;
  const { allowChatRequests, showOnlineStatus, readReceipts } = req.body;

  // Ayarları al veya oluştur
  let userSettings = await UserSettings.findOne({ user: userId });
  if (!userSettings) {
    userSettings = await UserSettings.create({ user: userId });
  }

  // Gelen değerleri güncelle
  if (allowChatRequests !== undefined)
    userSettings.chatSettings.allowChatRequests = allowChatRequests;
  if (showOnlineStatus !== undefined) userSettings.chatSettings.showOnlineStatus = showOnlineStatus;
  if (readReceipts !== undefined) userSettings.chatSettings.readReceipts = readReceipts;

  await userSettings.save();

  res.status(200).json({
    success: true,
    data: userSettings.chatSettings,
    message: 'Sohbet ayarları başarıyla güncellendi',
  });
});

/**
 * @desc    Görüntüleme ayarlarını güncelle
 * @route   PUT /api/users/settings/display
 * @access  Private
 */
const updateDisplaySettings = asyncHandler(async (req, res, next) => {
  const userId = req.user.id;
  const { theme, compactView, language, timezone } = req.body;

  // Ayarları al veya oluştur
  let userSettings = await UserSettings.findOne({ user: userId });
  if (!userSettings) {
    userSettings = await UserSettings.create({ user: userId });
  }

  // Gelen değerleri güncelle
  if (theme && ['light', 'dark', 'auto'].includes(theme)) {
    userSettings.displaySettings.theme = theme;
  }

  if (compactView !== undefined) userSettings.displaySettings.compactView = compactView;

  // Desteklenen diller (örnek olarak)
  const supportedLanguages = ['en', 'tr', 'de', 'fr', 'es', 'it', 'ru', 'ja', 'zh'];
  if (language && supportedLanguages.includes(language)) {
    userSettings.displaySettings.language = language;
  }

  // Timezone doğrulaması (basit kontrol)
  if (timezone) {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: timezone });
      userSettings.displaySettings.timezone = timezone;
    } catch (e) {
      return next(new ErrorResponse('Geçersiz zaman dilimi', 400));
    }
  }

  await userSettings.save();

  res.status(200).json({
    success: true,
    data: userSettings.displaySettings,
    message: 'Görüntüleme ayarları başarıyla güncellendi',
  });
});

/**
 * @desc    Tüm ayarları varsayılana sıfırla
 * @route   POST /api/users/settings/reset
 * @access  Private
 */
const resetSettings = asyncHandler(async (req, res, next) => {
  const userId = req.user.id;
  const { section } = req.body;

  // Ayarları al
  let userSettings = await UserSettings.findOne({ user: userId });
  if (!userSettings) {
    userSettings = await UserSettings.create({ user: userId });
    return res.status(200).json({
      success: true,
      data: userSettings,
      message: 'Ayarlar varsayılan değerlere ayarlandı',
    });
  }

  // Belirli bir bölümü veya tüm ayarları sıfırla
  if (section) {
    // Belirli bir bölümü sıfırla
    switch (section) {
      case 'contentPreferences':
        userSettings.contentPreferences = {
          adultContent: false,
          autoplayMedia: true,
          showNSFWContent: false,
          blurNSFWImages: true,
          showSpoilers: true,
          highlightNewComments: true,
          defaultCommentSort: 'best',
          defaultPostSort: 'hot',
        };
        break;
      case 'feedSettings':
        userSettings.feedSettings = {
          showVotedPosts: true,
          showPostsFromSubreddits: true,
          contentFilters: {
            hideByKeyword: [],
            hideSubreddits: [],
          },
        };
        break;
      case 'privacySettings':
        userSettings.privacySettings = {
          profileVisibility: 'public',
          showActiveInCommunities: true,
          allowDirectMessages: true,
          allowMentions: true,
          allowFollowers: true,
        };
        break;
      case 'emailNotifications':
        userSettings.emailNotifications = {
          newMessages: true,
          newCommentReplies: true,
          newPostReplies: true,
          mentions: true,
          upvotesOnPosts: false,
          upvotesOnComments: false,
          newsletterAndUpdates: false,
        };
        break;
      case 'pushNotifications':
        userSettings.pushNotifications = {
          enabled: true,
          newMessages: true,
          newCommentReplies: true,
          newPostReplies: true,
          mentions: true,
          upvotesOnPosts: false,
          upvotesOnComments: false,
        };
        break;
      case 'chatSettings':
        userSettings.chatSettings = {
          allowChatRequests: true,
          showOnlineStatus: true,
          readReceipts: true,
        };
        break;
      case 'displaySettings':
        userSettings.displaySettings = {
          theme: 'auto',
          compactView: false,
          language: 'en',
          timezone: 'UTC',
        };
        break;
      default:
        return next(new ErrorResponse('Geçersiz ayar bölümü', 400));
    }
  } else {
    // Tüm ayarları sıfırla - yeni bir model oluştur
    await UserSettings.findOneAndDelete({ user: userId });
    userSettings = await UserSettings.create({ user: userId });
  }

  await userSettings.save();

  res.status(200).json({
    success: true,
    data: userSettings,
    message: section
      ? `${section} ayarları varsayılan değerlere sıfırlandı`
      : 'Tüm ayarlar varsayılan değerlere sıfırlandı',
  });
});

/**
 * @desc    Yetişkin içerik (NSFW) ayarlarını güncelle
 * @route   PUT /api/users/settings/nsfw
 * @access  Private
 */
const updateNSFWSettings = asyncHandler(async (req, res, next) => {
  const userId = req.user.id;
  const { showNSFWContent, blurNSFWImages, adultContent } = req.body;

  // Kullanıcının yaşını kontrol et (18 yaş kontrol etmek için User modelinde birthDate alanı olduğunu varsayalım)
  const user = await User.findById(userId);

  if (showNSFWContent === true || adultContent === true) {
    // Not: Gerçek bir uygulamada, doğum tarihi bilgisi üzerinden yaş kontrolü yapılmalıdır
    // Bu örnekte, User modelinde böyle bir alan olmadığı için sadece kontrol ettiğimizi varsayıyoruz
    if (user.emailVerified !== true) {
      return next(
        new ErrorResponse('Yetişkin içeriği görmek için e-posta doğrulaması gereklidir', 403),
      );
    }
  }

  // Ayarları al veya oluştur
  let userSettings = await UserSettings.findOne({ user: userId });
  if (!userSettings) {
    userSettings = await UserSettings.create({ user: userId });
  }

  // Gelen değerleri güncelle
  if (showNSFWContent !== undefined)
    userSettings.contentPreferences.showNSFWContent = showNSFWContent;
  if (blurNSFWImages !== undefined) userSettings.contentPreferences.blurNSFWImages = blurNSFWImages;
  if (adultContent !== undefined) userSettings.contentPreferences.adultContent = adultContent;

  await userSettings.save();

  res.status(200).json({
    success: true,
    data: {
      showNSFWContent: userSettings.contentPreferences.showNSFWContent,
      blurNSFWImages: userSettings.contentPreferences.blurNSFWImages,
      adultContent: userSettings.contentPreferences.adultContent,
    },
    message: 'Yetişkin içerik ayarları başarıyla güncellendi',
  });
});

/**
 * @desc    Bir başka kullanıcının ayarlarını getir (Admin)
 * @route   GET /api/admin/users/:userId/settings
 * @access  Private/Admin
 */
const getUserSettingsAdmin = asyncHandler(async (req, res, next) => {
  const { userId } = req.params;

  // Kullanıcı ID doğrulaması
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    return next(new ErrorResponse('Geçersiz kullanıcı ID formatı', 400));
  }

  // Kullanıcının varlığını kontrol et
  const userExists = await User.exists({ _id: userId });
  if (!userExists) {
    return next(new ErrorResponse('Kullanıcı bulunamadı', 404));
  }

  // Kullanıcı ayarlarını getir
  const userSettings = await UserSettings.findOne({ user: userId });

  if (!userSettings) {
    return next(new ErrorResponse('Bu kullanıcı için henüz ayar oluşturulmamış', 404));
  }

  res.status(200).json({
    success: true,
    data: userSettings,
  });
});

/**
 * @desc    Belirli bir dil ve bölge ayarı için kullanıcı sayısını al (Admin)
 * @route   GET /api/admin/analytics/language-stats
 * @access  Private/Admin
 */
const getLanguageStats = asyncHandler(async (req, res, next) => {
  const languageStats = await UserSettings.aggregate([
    {
      $group: {
        _id: '$displaySettings.language',
        count: { $sum: 1 },
      },
    },
    {
      $sort: { count: -1 },
    },
    {
      $project: {
        language: '$_id',
        count: 1,
        _id: 0,
      },
    },
  ]);

  const timezoneStats = await UserSettings.aggregate([
    {
      $group: {
        _id: '$displaySettings.timezone',
        count: { $sum: 1 },
      },
    },
    {
      $sort: { count: -1 },
    },
    {
      $limit: 20, // En popüler 20 zaman dilimi
    },
    {
      $project: {
        timezone: '$_id',
        count: 1,
        _id: 0,
      },
    },
  ]);

  res.status(200).json({
    success: true,
    data: {
      languages: languageStats,
      timezones: timezoneStats,
    },
  });
});

/**
 * @desc    Tema istatistiklerini getir (Admin)
 * @route   GET /api/admin/analytics/theme-stats
 * @access  Private/Admin
 */
const getThemeStats = asyncHandler(async (req, res, next) => {
  const themeStats = await UserSettings.aggregate([
    {
      $group: {
        _id: '$displaySettings.theme',
        count: { $sum: 1 },
      },
    },
    {
      $project: {
        theme: '$_id',
        count: 1,
        _id: 0,
      },
    },
  ]);

  const compactViewStats = await UserSettings.aggregate([
    {
      $group: {
        _id: '$displaySettings.compactView',
        count: { $sum: 1 },
      },
    },
    {
      $project: {
        compactView: '$_id',
        count: 1,
        _id: 0,
      },
    },
  ]);

  res.status(200).json({
    success: true,
    data: {
      themeDistribution: themeStats,
      compactViewDistribution: compactViewStats,
    },
  });
});

/**
 * @desc    Gizlilik istatistiklerini getir (Admin)
 * @route   GET /api/admin/analytics/privacy-stats
 * @access  Private/Admin
 */
const getPrivacyStats = asyncHandler(async (req, res, next) => {
  // Profil görünürlüğüne göre dağılım
  const profileVisibilityStats = await UserSettings.aggregate([
    {
      $group: {
        _id: '$privacySettings.profileVisibility',
        count: { $sum: 1 },
      },
    },
    {
      $project: {
        visibility: '$_id',
        count: 1,
        _id: 0,
      },
    },
  ]);

  // DM ayarları dağılımı
  const dmStats = await UserSettings.aggregate([
    {
      $group: {
        _id: '$privacySettings.allowDirectMessages',
        count: { $sum: 1 },
      },
    },
    {
      $project: {
        allowDMs: '$_id',
        count: 1,
        _id: 0,
      },
    },
  ]);

  res.status(200).json({
    success: true,
    data: {
      profileVisibility: profileVisibilityStats,
      directMessagePreferences: dmStats,
    },
  });
});

/**
 * @desc    Kullanıcı feed filtreleme ayarlarını güncelle
 * @route   PUT /api/users/settings/content-filters
 * @access  Private
 */
const updateContentFilters = asyncHandler(async (req, res, next) => {
  const userId = req.user.id;
  const { hideByKeyword, hideSubreddits, action } = req.body;

  if (!hideByKeyword && !hideSubreddits) {
    return next(new ErrorResponse('Güncelleme için en az bir filtre belirtmelisiniz', 400));
  }

  // Ayarları al veya oluştur
  let userSettings = await UserSettings.findOne({ user: userId });
  if (!userSettings) {
    userSettings = await UserSettings.create({ user: userId });
  }

  // Anahtar kelime filtreleri ekle veya kaldır
  if (hideByKeyword) {
    const keywords = Array.isArray(hideByKeyword)
      ? hideByKeyword
      : typeof hideByKeyword === 'string'
        ? [hideByKeyword]
        : [];

    if (action === 'remove') {
      // Belirtilen anahtar kelimeleri kaldır
      userSettings.feedSettings.contentFilters.hideByKeyword =
        userSettings.feedSettings.contentFilters.hideByKeyword.filter(
          (keyword) => !keywords.includes(keyword),
        );
    } else {
      // Varsayılan olarak ekle
      const currentKeywords = new Set(userSettings.feedSettings.contentFilters.hideByKeyword);
      keywords.forEach((keyword) => currentKeywords.add(keyword));
      userSettings.feedSettings.contentFilters.hideByKeyword = [...currentKeywords];
    }
  }

  // Subreddit filtreleri ekle veya kaldır
  if (hideSubreddits) {
    const subreddits = Array.isArray(hideSubreddits)
      ? hideSubreddits.filter((id) => mongoose.Types.ObjectId.isValid(id))
      : typeof hideSubreddits === 'string' && mongoose.Types.ObjectId.isValid(hideSubreddits)
        ? [hideSubreddits]
        : [];

    if (action === 'remove') {
      // Belirtilen subreddit ID'lerini kaldır
      userSettings.feedSettings.contentFilters.hideSubreddits =
        userSettings.feedSettings.contentFilters.hideSubreddits.filter(
          (subId) => !subreddits.includes(subId.toString()),
        );
    } else {
      // Varsayılan olarak ekle
      const currentSubreddits = new Set(
        userSettings.feedSettings.contentFilters.hideSubreddits.map((sub) => sub.toString()),
      );
      subreddits.forEach((subId) => currentSubreddits.add(subId));
      userSettings.feedSettings.contentFilters.hideSubreddits = [...currentSubreddits];
    }
  }

  await userSettings.save();

  res.status(200).json({
    success: true,
    data: userSettings.feedSettings.contentFilters,
    message: 'İçerik filtreleri başarıyla güncellendi',
  });
});

module.exports = {
  getUserSettings,
  updateContentPreferences,
  updateFeedSettings,
  updatePrivacySettings,
  updateEmailNotifications,
  updatePushNotifications,
  updateChatSettings,
  updateDisplaySettings,
  resetSettings,
  updateNSFWSettings,
  getUserSettingsAdmin,
  getLanguageStats,
  getThemeStats,
  getPrivacyStats,
  updateContentFilters,
};
