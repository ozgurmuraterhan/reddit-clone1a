const { UserSettings, User, BlockedUser } = require('../models');

/**
 * Kullanıcı ayarlarını getir
 * @route GET /api/users/me/settings
 * @access Private
 */
const getUserSettings = async (req, res) => {
  try {
    const userId = req.user._id;

    // Kullanıcı ayarlarını bul veya oluştur
    let userSettings = await UserSettings.findOne({ user: userId });

    if (!userSettings) {
      // Varsayılan ayarlarla yeni bir ayar oluştur
      userSettings = await UserSettings.create({
        user: userId,
      });
    }

    res.status(200).json({
      success: true,
      data: userSettings,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Kullanıcı ayarları getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * Kullanıcı ayarlarını güncelle
 * @route PUT /api/users/me/settings
 * @access Private
 */
const updateUserSettings = async (req, res) => {
  try {
    const userId = req.user._id;

    // Güncellenebilir alanlar
    const {
      emailNotifications,
      pushNotifications,
      contentVisibility,
      contentFilters,
      privacySettings,
      displaySettings,
      feedSettings,
      accessibilitySettings,
      chatSettings,
      language,
      theme,
    } = req.body;

    // Kullanıcı ayarlarını bul veya oluştur
    let userSettings = await UserSettings.findOne({ user: userId });

    if (!userSettings) {
      userSettings = new UserSettings({ user: userId });
    }

    // Güncellenecek alanları belirle
    if (emailNotifications !== undefined) userSettings.emailNotifications = emailNotifications;
    if (pushNotifications !== undefined) userSettings.pushNotifications = pushNotifications;
    if (contentVisibility !== undefined) userSettings.contentVisibility = contentVisibility;
    if (contentFilters !== undefined) userSettings.contentFilters = contentFilters;
    if (privacySettings !== undefined) userSettings.privacySettings = privacySettings;
    if (displaySettings !== undefined) userSettings.displaySettings = displaySettings;
    if (feedSettings !== undefined) userSettings.feedSettings = feedSettings;
    if (accessibilitySettings !== undefined)
      userSettings.accessibilitySettings = accessibilitySettings;
    if (chatSettings !== undefined) userSettings.chatSettings = chatSettings;
    if (language !== undefined) userSettings.language = language;
    if (theme !== undefined) userSettings.theme = theme;

    // Ayarları kaydet
    await userSettings.save();

    // Kullanıcı dil tercihini güncelle
    if (language !== undefined) {
      await User.findByIdAndUpdate(userId, { language });
    }

    res.status(200).json({
      success: true,
      message: 'Kullanıcı ayarları başarıyla güncellendi',
      data: userSettings,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Kullanıcı ayarları güncellenirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * Kullanıcıyı engelle/engeli kaldır
 * @route POST /api/users/block
 * @access Private
 */
const toggleBlockUser = async (req, res) => {
  try {
    const userId = req.user._id;
    const { targetUsername } = req.body;

    if (!targetUsername) {
      return res.status(400).json({
        success: false,
        message: 'Engellenmek istenen kullanıcı belirtilmelidir',
      });
    }

    // Hedef kullanıcıyı bul
    const targetUser = await User.findOne({ username: targetUsername });

    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: 'Kullanıcı bulunamadı',
      });
    }

    // Kendini engelleyemezsin
    if (targetUser._id.toString() === userId.toString()) {
      return res.status(400).json({
        success: false,
        message: 'Kendinizi engelleyemezsiniz',
      });
    }

    // Kullanıcı zaten engellenmiş mi kontrol et
    const existingBlock = await BlockedUser.findOne({
      blocker: userId,
      blocked: targetUser._id,
    });

    if (existingBlock) {
      // Engeli kaldır
      await existingBlock.remove();
      return res.status(200).json({
        success: true,
        message: `${targetUsername} kullanıcısının engeli kaldırıldı`,
        isBlocked: false,
      });
    } else {
      // Kullanıcıyı engelle
      await BlockedUser.create({
        blocker: userId,
        blocked: targetUser._id,
      });
      return res.status(200).json({
        success: true,
        message: `${targetUsername} kullanıcısı engellendi`,
        isBlocked: true,
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Kullanıcı engellenirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * Engellenen kullanıcıları listele
 * @route GET /api/users/me/blocked
 * @access Private
 */
const getBlockedUsers = async (req, res) => {
  try {
    const userId = req.user._id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    // Engellenen kullanıcıları getir
    const blockedUsers = await BlockedUser.find({ blocker: userId })
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 })
      .populate('blocked', 'username displayName profilePicture');

    const totalBlocked = await BlockedUser.countDocuments({ blocker: userId });

    res.status(200).json({
      success: true,
      count: blockedUsers.length,
      total: totalBlocked,
      totalPages: Math.ceil(totalBlocked / limit),
      currentPage: page,
      data: blockedUsers,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Engellenen kullanıcılar listelenirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * Kullanıcının moderatörlük yaptığı subredditleri getir
 * @route GET /api/users/me/moderating
 * @access Private
 */
const getModeratedSubreddits = async (req, res) => {
  try {
    const userId = req.user._id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    // Kullanıcının moderatörlük yaptığı subredditleri getir
    const memberships = await SubredditMembership.find({
      user: userId,
      status: { $in: ['moderator', 'admin'] },
    })
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 })
      .populate(
        'subreddit',
        'name title description subscriberCount profileImage bannerImage createdAt',
      );

    const totalMemberships = await SubredditMembership.countDocuments({
      user: userId,
      status: { $in: ['moderator', 'admin'] },
    });

    res.status(200).json({
      success: true,
      count: memberships.length,
      total: totalMemberships,
      totalPages: Math.ceil(totalMemberships / limit),
      currentPage: page,
      data: memberships,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Moderatörlük yapılan subredditler getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * Kullanıcının moderasyon aksiyonlarını getir
 * @route GET /api/users/me/modactions
 * @access Private
 */
const getModActions = async (req, res) => {
  try {
    const userId = req.user._id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const { subredditId, action } = req.query;

    // Filtre oluştur
    const filter = { moderator: userId };
    if (subredditId) {
      filter.subreddit = subredditId;
    }
    if (action) {
      filter.action = action;
    }

    // Mod aksiyonlarını getir
    const modActions = await ModLog.find(filter)
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 })
      .populate('subreddit', 'name')
      .populate('targetPost', 'title')
      .populate('targetComment', 'content')
      .populate('targetUser', 'username');

    const totalActions = await ModLog.countDocuments(filter);

    res.status(200).json({
      success: true,
      count: modActions.length,
      total: totalActions,
      totalPages: Math.ceil(totalActions / limit),
      currentPage: page,
      data: modActions,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Moderasyon aksiyonları getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * Kullanıcının flairlerini getir
 * @route GET /api/users/me/flairs
 * @access Private
 */
const getUserFlairs = async (req, res) => {
  try {
    const userId = req.user._id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    // Kullanıcıya atanmış flairleri getir
    const flairs = await Flair.find({ assignedUsers: userId })
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 })
      .populate('subreddit', 'name');

    const totalFlairs = await Flair.countDocuments({ assignedUsers: userId });

    res.status(200).json({
      success: true,
      count: flairs.length,
      total: totalFlairs,
      totalPages: Math.ceil(totalFlairs / limit),
      currentPage: page,
      data: flairs,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Kullanıcı flairleri getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * Kullanıcı istatistiklerini getir
 * @route GET /api/users/me/stats
 * @access Private
 */
const getUserStats = async (req, res) => {
  try {
    const userId = req.user._id;

    const stats = {
      posts: await Post.countDocuments({ author: userId, isDeleted: false }),
      comments: await Comment.countDocuments({ author: userId, isDeleted: false }),
      upvotesGiven: await Vote.countDocuments({ user: userId, voteType: 'upvote' }),
      downvotesGiven: await Vote.countDocuments({ user: userId, voteType: 'downvote' }),
      subredditsJoined: await SubredditMembership.countDocuments({
        user: userId,
        status: 'member',
      }),
      subredditsModerating: await SubredditMembership.countDocuments({
        user: userId,
        status: { $in: ['moderator', 'admin'] },
      }),
      awards: await Award.countDocuments({ recipient: userId }),
      awardsGiven: await Award.countDocuments({ giver: userId }),
      savedItems: await SavedItem.countDocuments({ user: userId }),
    };

    // Karma detayları
    const user = await User.findById(userId).select('karma totalKarma');
    if (user) {
      stats.karma = user.karma;
      stats.totalKarma = user.totalKarma;
    }

    // En aktif olduğu subredditler
    const mostActiveSubreddits = await Post.aggregate([
      { $match: { author: userId, isDeleted: false } },
      { $group: { _id: '$subreddit', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 },
    ]);

    stats.mostActiveSubreddits = await Subreddit.populate(mostActiveSubreddits, {
      path: '_id',
      select: 'name title',
    });

    res.status(200).json({
      success: true,
      data: stats,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Kullanıcı istatistikleri getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

module.exports = {
  getUserSettings,
  updateUserSettings,
  toggleBlockUser,
  getBlockedUsers,
  getModeratedSubreddits,
  getModActions,
  getUserFlairs,
  getUserStats,
};
