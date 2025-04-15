const { SubredditSettings, Subreddit, SubredditMembership, ModLog } = require('../models');

/**
 * Subreddit ayarlarını getir
 * @route GET /api/subreddits/:subredditName/settings
 * @access Private/Moderator
 */
const getSettings = async (req, res) => {
  try {
    const { subredditName } = req.params;
    const userId = req.user._id;

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

    // Ayarları getir
    let settings = await SubredditSettings.findOne({ subreddit: subreddit._id });

    // Ayarlar yoksa varsayılan ayarlar oluştur
    if (!settings) {
      settings = await SubredditSettings.create({
        subreddit: subreddit._id,
        createdBy: userId,
      });
    }

    res.status(200).json({
      success: true,
      data: settings,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Subreddit ayarları getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * Subreddit ayarlarını güncelle
 * @route PUT /api/subreddits/:subredditName/settings
 * @access Private/Moderator
 */
const updateSettings = async (req, res) => {
  try {
    const { subredditName } = req.params;
    const userId = req.user._id;

    // Güncellenebilir alanlar
    const {
      allowImagesAndVideos,
      allowPolls,
      allowGalleryPosts,
      allowLinks,
      postContentRequirements,
      postType,
      postRestrictions,
      commentRestrictions,
      approvedPostersOnly,
      approvedCommentsOnly,
      spoilersEnabled,
      nsfwEnabled,
      language,
      disableDownvotes,
      suggestedSortOrder,
      filterByFlair,
      showInGlobalFeed,
      headerStyle,
      enableEventPosts,
      restrictTitleLength,
      customCss,
      customTheme,
      banners,
      icons,
      colors,
    } = req.body;

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

    // Mevcut ayarları bul
    let settings = await SubredditSettings.findOne({ subreddit: subreddit._id });

    // Ayarlar yoksa yeni oluştur
    if (!settings) {
      settings = new SubredditSettings({
        subreddit: subreddit._id,
        createdBy: userId,
      });
    }

    // Güncellenecek alanları belirle
    if (allowImagesAndVideos !== undefined) settings.allowImagesAndVideos = allowImagesAndVideos;
    if (allowPolls !== undefined) settings.allowPolls = allowPolls;
    if (allowGalleryPosts !== undefined) settings.allowGalleryPosts = allowGalleryPosts;
    if (allowLinks !== undefined) settings.allowLinks = allowLinks;
    if (postContentRequirements !== undefined)
      settings.postContentRequirements = postContentRequirements;
    if (postType !== undefined) settings.postType = postType;
    if (postRestrictions !== undefined) settings.postRestrictions = postRestrictions;
    if (commentRestrictions !== undefined) settings.commentRestrictions = commentRestrictions;
    if (approvedPostersOnly !== undefined) settings.approvedPostersOnly = approvedPostersOnly;
    if (approvedCommentsOnly !== undefined) settings.approvedCommentsOnly = approvedCommentsOnly;
    if (spoilersEnabled !== undefined) settings.spoilersEnabled = spoilersEnabled;
    if (nsfwEnabled !== undefined) settings.nsfwEnabled = nsfwEnabled;
    if (language !== undefined) settings.language = language;
    if (disableDownvotes !== undefined) settings.disableDownvotes = disableDownvotes;
    if (suggestedSortOrder !== undefined) settings.suggestedSortOrder = suggestedSortOrder;
    if (filterByFlair !== undefined) settings.filterByFlair = filterByFlair;
    if (showInGlobalFeed !== undefined) settings.showInGlobalFeed = showInGlobalFeed;
    if (headerStyle !== undefined) settings.headerStyle = headerStyle;
    if (enableEventPosts !== undefined) settings.enableEventPosts = enableEventPosts;
    if (restrictTitleLength !== undefined) settings.restrictTitleLength = restrictTitleLength;
    if (customCss !== undefined) settings.customCss = customCss;
    if (customTheme !== undefined) settings.customTheme = customTheme;
    if (banners !== undefined) settings.banners = banners;
    if (icons !== undefined) settings.icons = icons;
    if (colors !== undefined) settings.colors = colors;

    // Son güncelleme bilgilerini ekle
    settings.updatedBy = userId;
    settings.updatedAt = Date.now();

    // Ayarları kaydet
    await settings.save();

    // Subreddit metadata güncellemesi
    if (nsfwEnabled !== undefined || language !== undefined) {
      const updateData = {};
      if (nsfwEnabled !== undefined) updateData.isNsfw = nsfwEnabled;
      if (language !== undefined) updateData.language = language;

      await Subreddit.findByIdAndUpdate(subreddit._id, updateData);
    }

    // Mod log oluştur
    await ModLog.create({
      subreddit: subreddit._id,
      moderator: userId,
      action: 'edit_settings',
      details: 'Updated subreddit settings',
    });

    res.status(200).json({
      success: true,
      message: 'Subreddit ayarları başarıyla güncellendi',
      data: settings,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Subreddit ayarları güncellenirken bir hata oluştu',
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
  getSettings,
  updateSettings,
};
