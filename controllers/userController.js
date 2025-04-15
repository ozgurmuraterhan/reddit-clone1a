const {
  User,
  Post,
  Comment,
  UserSettings,
  SubredditMembership,
  SavedItem,
  Notification,
  Flair,
  ModLog,
  Vote,
  Award,
} = require('../models');

/**
 * Tüm kullanıcıları getir (sadece admin)
 * @route GET /api/users
 * @access Private/Admin
 */
const getUsers = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const users = await User.find()
      .select('-password')
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 });

    const totalUsers = await User.countDocuments();

    res.status(200).json({
      success: true,
      count: users.length,
      total: totalUsers,
      totalPages: Math.ceil(totalUsers / limit),
      currentPage: page,
      data: users,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Kullanıcılar getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * Kullanıcı profili getir
 * @route GET /api/users/:username
 * @access Public
 */
const getUserProfile = async (req, res) => {
  try {
    const { username } = req.params;

    const user = await User.findOne({ username }).select(
      '-password -verificationToken -verificationTokenExpire -resetPasswordToken -resetPasswordExpire',
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Kullanıcı bulunamadı',
      });
    }

    res.status(200).json({
      success: true,
      data: user,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Kullanıcı profili getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * Kullanıcının kendi profilini güncelleme
 * @route PUT /api/users/me
 * @access Private
 */
const updateProfile = async (req, res) => {
  try {
    const userId = req.user._id;

    // Güncellenebilir alanlar
    const { bio, profilePicture } = req.body;

    // Sadece izin verilen alanları güncelle
    const updateData = {};
    if (bio !== undefined) updateData.bio = bio;
    if (profilePicture !== undefined) updateData.profilePicture = profilePicture;

    const user = await User.findByIdAndUpdate(userId, updateData, {
      new: true,
      runValidators: true,
    }).select('-password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Kullanıcı bulunamadı',
      });
    }

    res.status(200).json({
      success: true,
      message: 'Profil başarıyla güncellendi',
      data: user,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Profil güncellenirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * Admin: Kullanıcıyı güncelleme
 * @route PUT /api/users/:userId
 * @access Private/Admin
 */
const updateUser = async (req, res) => {
  try {
    const { userId } = req.params;

    // Güncellenebilir alanlar (admin daha fazla alana erişebilir)
    const { username, email, bio, profilePicture, accountStatus } = req.body;

    // Sadece izin verilen alanları güncelle
    const updateData = {};
    if (username !== undefined) updateData.username = username;
    if (email !== undefined) updateData.email = email;
    if (bio !== undefined) updateData.bio = bio;
    if (profilePicture !== undefined) updateData.profilePicture = profilePicture;
    if (accountStatus !== undefined) updateData.accountStatus = accountStatus;

    const user = await User.findByIdAndUpdate(userId, updateData, {
      new: true,
      runValidators: true,
    }).select('-password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Kullanıcı bulunamadı',
      });
    }

    res.status(200).json({
      success: true,
      message: 'Kullanıcı başarıyla güncellendi',
      data: user,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Kullanıcı güncellenirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * Admin: Kullanıcıyı silme/deaktif etme
 * @route DELETE /api/users/:userId
 * @access Private/Admin
 */
const deleteUser = async (req, res) => {
  try {
    const { userId } = req.params;

    // Soft delete yapalım
    const user = await User.findByIdAndUpdate(
      userId,
      {
        isDeleted: true,
        deletedAt: Date.now(),
        accountStatus: 'deleted',
      },
      { new: true },
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Kullanıcı bulunamadı',
      });
    }

    res.status(200).json({
      success: true,
      message: 'Kullanıcı başarıyla silindi',
      data: {},
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Kullanıcı silinirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * Kullanıcı gönderilerini getir
 * @route GET /api/users/:username/posts
 * @access Public
 */
const getUserPosts = async (req, res) => {
  try {
    const { username } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const user = await User.findOne({ username });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Kullanıcı bulunamadı',
      });
    }

    const posts = await Post.find({
      author: user._id,
      isDeleted: false,
    })
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 })
      .populate('author', 'username profilePicture')
      .populate('subreddit', 'name');

    const totalPosts = await Post.countDocuments({
      author: user._id,
      isDeleted: false,
    });

    res.status(200).json({
      success: true,
      count: posts.length,
      total: totalPosts,
      totalPages: Math.ceil(totalPosts / limit),
      currentPage: page,
      data: posts,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Kullanıcı gönderileri getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * Kullanıcı yorumlarını getir
 * @route GET /api/users/:username/comments
 * @access Public
 */
const getUserComments = async (req, res) => {
  try {
    const { username } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const user = await User.findOne({ username });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Kullanıcı bulunamadı',
      });
    }

    const comments = await Comment.find({
      author: user._id,
      isDeleted: false,
    })
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 })
      .populate('author', 'username profilePicture')
      .populate('post', 'title')
      .populate({
        path: 'post',
        populate: {
          path: 'subreddit',
          select: 'name',
        },
      });

    const totalComments = await Comment.countDocuments({
      author: user._id,
      isDeleted: false,
    });

    res.status(200).json({
      success: true,
      count: comments.length,
      total: totalComments,
      totalPages: Math.ceil(totalComments / limit),
      currentPage: page,
      data: comments,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Kullanıcı yorumları getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * Kullanıcının karma bilgilerini getir
 * @route GET /api/users/:username/karma
 * @access Public
 */
const getUserKarma = async (req, res) => {
  try {
    const { username } = req.params;

    const user = await User.findOne({ username });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Kullanıcı bulunamadı',
      });
    }

    // Kullanıcının toplam karmasını ve detaylarını döndür
    res.status(200).json({
      success: true,
      data: {
        totalKarma: user.totalKarma,
        postKarma: user.karma.post,
        commentKarma: user.karma.comment,
        awardeeKarma: user.karma.awardee,
        awarderKarma: user.karma.awarder,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Kullanıcı karma bilgileri getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * Kullanıcının üye olduğu subredditleri getir
 * @route GET /api/users/:username/subreddits
 * @access Public
 */
const getUserSubreddits = async (req, res) => {
  try {
    const { username } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const user = await User.findOne({ username });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Kullanıcı bulunamadı',
      });
    }

    const memberships = await SubredditMembership.find({
      user: user._id,
      status: { $in: ['member', 'moderator', 'admin'] },
    })
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 })
      .populate('subreddit', 'name description subscriberCount createdAt');

    const totalMemberships = await SubredditMembership.countDocuments({
      user: user._id,
      status: { $in: ['member', 'moderator', 'admin'] },
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
      message: 'Kullanıcının subreddit üyelikleri getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * İçeriği kaydet/kaydetmeyi kaldır
 * @route POST /api/users/me/save
 * @access Private
 */
const toggleSaveItem = async (req, res) => {
  try {
    const userId = req.user._id;
    const { itemId, itemType } = req.body;

    if (!['post', 'comment'].includes(itemType)) {
      return res.status(400).json({
        success: false,
        message: 'Geçersiz öğe türü. "post" veya "comment" olmalıdır.',
      });
    }

    // Öğenin var olup olmadığını kontrol et
    let item;
    if (itemType === 'post') {
      item = await Post.findById(itemId);
    } else {
      item = await Comment.findById(itemId);
    }

    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'Kaydedilecek öğe bulunamadı',
      });
    }

    // Daha önce kaydedilmiş mi kontrol et
    const existingSave = await SavedItem.findOne({
      user: userId,
      itemId,
      itemType,
    });

    if (existingSave) {
      // Kaydı kaldır
      await existingSave.remove();
      return res.status(200).json({
        success: true,
        message: 'Öğe başarıyla kaydedilenlerden kaldırıldı',
        saved: false,
      });
    } else {
      // Yeni kayıt oluştur
      const newSavedItem = await SavedItem.create({
        user: userId,
        itemId,
        itemType,
        category: req.body.category || 'uncategorized',
      });

      return res.status(201).json({
        success: true,
        message: 'Öğe başarıyla kaydedildi',
        data: newSavedItem,
        saved: true,
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Öğe kaydedilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * Kullanıcının kaydettiği içerikleri getir
 * @route GET /api/users/me/saved
 * @access Private
 */
const getSavedItems = async (req, res) => {
  try {
    const userId = req.user._id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const { type } = req.query; // 'post' veya 'comment' olabilir

    // Filtre oluştur
    const filter = { user: userId };
    if (type) {
      filter.itemType = type;
    }

    const savedItems = await SavedItem.find(filter)
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 })
      .populate({
        path: 'itemId',
        refPath: 'itemType',
        populate: [
          { path: 'author', select: 'username profilePicture' },
          { path: 'subreddit', select: 'name' },
        ],
      });

    const totalItems = await SavedItem.countDocuments(filter);

    res.status(200).json({
      success: true,
      count: savedItems.length,
      total: totalItems,
      totalPages: Math.ceil(totalItems / limit),
      currentPage: page,
      data: savedItems,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Kaydedilen içerikler getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * Kullanıcının bildirimlerini getir
 * @route GET /api/users/me/notifications
 * @access Private
 */
const getUserNotifications = async (req, res) => {
  try {
    const userId = req.user._id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const { unreadOnly } = req.query;

    // Filtre oluştur
    const filter = { recipient: userId };
    if (unreadOnly === 'true') {
      filter.read = false;
    }

    const notifications = await Notification.find(filter)
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 })
      .populate('sender', 'username profilePicture')
      .populate('relatedPost', 'title')
      .populate('relatedComment', 'content');

    const totalNotifications = await Notification.countDocuments(filter);
    const unreadCount = await Notification.countDocuments({ recipient: userId, read: false });

    res.status(200).json({
      success: true,
      count: notifications.length,
      total: totalNotifications,
      unreadCount,
      totalPages: Math.ceil(totalNotifications / limit),
      currentPage: page,
      data: notifications,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Bildirimler getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * Bildirimi okundu olarak işaretle
 * @route PUT /api/users/me/notifications/:notificationId
 * @access Private
 */
const markNotificationAsRead = async (req, res) => {
  try {
    const { notificationId } = req.params;
    const userId = req.user._id;

    const notification = await Notification.findOne({
      _id: notificationId,
      recipient: userId,
    });

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Bildirim bulunamadı',
      });
    }

    notification.read = true;
    notification.readAt = Date.now();
    await notification.save();

    res.status(200).json({
      success: true,
      message: 'Bildirim okundu olarak işaretlendi',
      data: notification,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Bildirim güncellenirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * Tüm bildirimleri okundu olarak işaretle
 * @route PUT /api/users/me/notifications/mark-all-read
 * @access Private
 */
const markAllNotificationsAsRead = async (req, res) => {
  try {
    const userId = req.user._id;

    await Notification.updateMany(
      { recipient: userId, read: false },
      { read: true, readAt: Date.now() },
    );

    res.status(200).json({
      success: true,
      message: 'Tüm bildirimler okundu olarak işaretlendi',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Bildirimler güncellenirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * Kullanıcının oylarını getir
 * @route GET /api/users/me/votes
 * @access Private
 */
const getUserVotes = async (req, res) => {
  try {
    const userId = req.user._id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const { type, voteType } = req.query;

    // Filtre oluştur
    const filter = { user: userId };
    if (type && ['post', 'comment'].includes(type)) {
      // Belirli bir tür (post/comment) için filtrele
      if (type === 'post') {
        filter.post = { $exists: true };
      } else {
        filter.comment = { $exists: true };
      }
    }
    if (voteType && ['upvote', 'downvote'].includes(voteType)) {
      filter.voteType = voteType;
    }

    const votes = await Vote.find(filter)
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 })
      .populate({
        path: 'post',
        select: 'title content author subreddit createdAt',
        populate: [
          { path: 'author', select: 'username profilePicture' },
          { path: 'subreddit', select: 'name' },
        ],
      })
      .populate({
        path: 'comment',
        select: 'content author post createdAt',
        populate: [
          { path: 'author', select: 'username profilePicture' },
          { path: 'post', select: 'title subreddit' },
        ],
      });

    const totalVotes = await Vote.countDocuments(filter);

    res.status(200).json({
      success: true,
      count: votes.length,
      total: totalVotes,
      totalPages: Math.ceil(totalVotes / limit),
      currentPage: page,
      data: votes,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Kullanıcı oyları getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};
/**
 * Kullanıcı ayarlarını getir
 * @route GET /api/users/me/settings
 * @access Private
 */
const getUserSettings = async (req, res) => {
  try {
    const userId = req.user._id;

    const userSettings = await UserSettings.findOne({ user: userId });

    if (!userSettings) {
      return res.status(404).json({
        success: false,
        message: 'Kullanıcı ayarları bulunamadı',
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
    const {
      emailNotifications,
      contentVisibility,
      displayName,
      allowFollowers,
      theme,
      language,
      contentFilters,
      privacy,
    } = req.body;

    // Güncellenebilir alanlar
    const updateData = {};
    if (emailNotifications !== undefined) updateData.emailNotifications = emailNotifications;
    if (contentVisibility !== undefined) updateData.contentVisibility = contentVisibility;
    if (displayName !== undefined) updateData.displayName = displayName;
    if (allowFollowers !== undefined) updateData.allowFollowers = allowFollowers;
    if (theme !== undefined) updateData.theme = theme;
    if (language !== undefined) updateData.language = language;
    if (contentFilters !== undefined) updateData.contentFilters = contentFilters;
    if (privacy !== undefined) updateData.privacy = privacy;

    // Güncelleme veya oluşturma (upsert)
    const settings = await UserSettings.findOneAndUpdate({ user: userId }, updateData, {
      new: true,
      upsert: true,
      runValidators: true,
    });

    res.status(200).json({
      success: true,
      message: 'Kullanıcı ayarları başarıyla güncellendi',
      data: settings,
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
 * Kullanıcının moderatör olduğu subredditleri getir
 * @route GET /api/users/me/moderated
 * @access Private
 */
const getModeratedSubreddits = async (req, res) => {
  try {
    const userId = req.user._id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const memberships = await SubredditMembership.find({
      user: userId,
      status: { $in: ['moderator', 'admin'] },
    })
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 })
      .populate('subreddit', 'name description subscriberCount createdAt bannerImage icon rules');

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
      message: 'Moderatör olunan subredditler getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * Kullanıcının moderatör olarak gerçekleştirdiği eylemler
 * @route GET /api/users/me/modactions
 * @access Private
 */
const getModActions = async (req, res) => {
  try {
    const userId = req.user._id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const { subredditId } = req.query;

    // Filtre oluştur
    const filter = { moderator: userId };
    if (subredditId) {
      filter.subreddit = subredditId;
    }

    const modLogs = await ModLog.find(filter)
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 })
      .populate('moderator', 'username profilePicture')
      .populate('subreddit', 'name')
      .populate('targetUser', 'username')
      .populate('targetPost', 'title')
      .populate('targetComment', 'content');

    const totalLogs = await ModLog.countDocuments(filter);

    res.status(200).json({
      success: true,
      count: modLogs.length,
      total: totalLogs,
      totalPages: Math.ceil(totalLogs / limit),
      currentPage: page,
      data: modLogs,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Moderatör eylemleri getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * Kullanıcının sahip olduğu flairleri getir
 * @route GET /api/users/me/flairs
 * @access Private
 */
const getUserFlairs = async (req, res) => {
  try {
    const userId = req.user._id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const { subredditId } = req.query;

    // Filtre oluştur
    const filter = { user: userId, type: 'user' };
    if (subredditId) {
      filter.subreddit = subredditId;
    }

    const flairs = await Flair.find(filter)
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 })
      .populate('subreddit', 'name');

    const totalFlairs = await Flair.countDocuments(filter);

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
        message: 'Engellenmek istenen kullanıcının adı gereklidir',
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

    // Kullanıcıyı bul
    const user = await User.findById(userId);

    // Kullanıcı zaten engellenmiş mi kontrol et
    const isBlocked = user.blockedUsers.includes(targetUser._id);

    if (isBlocked) {
      // Engeli kaldır
      await User.findByIdAndUpdate(userId, {
        $pull: { blockedUsers: targetUser._id },
      });

      return res.status(200).json({
        success: true,
        message: 'Kullanıcının engeli kaldırıldı',
        blocked: false,
      });
    } else {
      // Kullanıcıyı engelle
      await User.findByIdAndUpdate(userId, {
        $addToSet: { blockedUsers: targetUser._id },
      });

      return res.status(200).json({
        success: true,
        message: 'Kullanıcı engellendi',
        blocked: true,
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
 * Engellenen kullanıcıları getir
 * @route GET /api/users/me/blocked
 * @access Private
 */
const getBlockedUsers = async (req, res) => {
  try {
    const userId = req.user._id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    // Kullanıcıyı tüm blockedUsers ile birlikte getir
    const user = await User.findById(userId).populate({
      path: 'blockedUsers',
      select: 'username profilePicture bio createdAt',
      options: {
        skip,
        limit,
        sort: { username: 1 },
      },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Kullanıcı bulunamadı',
      });
    }

    const totalBlocked = user.blockedUsers.length;

    res.status(200).json({
      success: true,
      count: user.blockedUsers.length,
      total: totalBlocked,
      totalPages: Math.ceil(totalBlocked / limit),
      currentPage: page,
      data: user.blockedUsers,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Engellenen kullanıcılar getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * Kullanıcı istatistiklerini getir
 * @route GET /api/users/:username/stats
 * @access Public
 */
const getUserStats = async (req, res) => {
  try {
    const { username } = req.params;

    const user = await User.findOne({ username });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Kullanıcı bulunamadı',
      });
    }

    // İstatistikleri hesapla
    const postCount = await Post.countDocuments({ author: user._id, isDeleted: false });
    const commentCount = await Comment.countDocuments({ author: user._id, isDeleted: false });
    const subredditCount = await SubredditMembership.countDocuments({
      user: user._id,
      status: { $in: ['member', 'moderator', 'admin'] },
    });
    const moderatedCount = await SubredditMembership.countDocuments({
      user: user._id,
      status: { $in: ['moderator', 'admin'] },
    });
    const awardsReceivedCount = await Award.countDocuments({ recipient: user._id });
    const awardsGivenCount = await Award.countDocuments({ giver: user._id });

    // Upvote ve downvote sayılarını hesapla
    const upvotesGiven = await Vote.countDocuments({ user: user._id, voteType: 'upvote' });
    const downvotesGiven = await Vote.countDocuments({ user: user._id, voteType: 'downvote' });

    // En çok aktif olunan subreddit'i bul
    const popularSubreddits = await Post.aggregate([
      { $match: { author: user._id, isDeleted: false } },
      { $group: { _id: '$subreddit', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 1 },
    ]);

    let mostActiveSubreddit = null;
    if (popularSubreddits.length > 0) {
      const subredditData = await SubredditMembership.findOne({
        _id: popularSubreddits[0]._id,
      }).select('name');
      if (subredditData) {
        mostActiveSubreddit = {
          name: subredditData.name,
          postCount: popularSubreddits[0].count,
        };
      }
    }

    res.status(200).json({
      success: true,
      data: {
        accountAge: user.createdAt,
        karma: {
          total: user.totalKarma,
          post: user.karma.post,
          comment: user.karma.comment,
          awardee: user.karma.awardee,
          awarder: user.karma.awarder,
        },
        activity: {
          postCount,
          commentCount,
          subredditCount,
          moderatedCount,
          awardsReceived: awardsReceivedCount,
          awardsGiven: awardsGivenCount,
          upvotesGiven,
          downvotesGiven,
          mostActiveSubreddit,
        },
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Kullanıcı istatistikleri getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

// Fonksiyonları dışa aktar
module.exports = {
  getUsers,
  getUserProfile,
  updateProfile,
  updateUser,
  deleteUser,
  getUserPosts,
  getUserComments,
  getUserKarma,
  getUserSubreddits,
  getSavedItems,
  toggleSaveItem,
  getUserNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  getUserVotes,
  getUserSettings,
  updateUserSettings,
  getModeratedSubreddits,
  getModActions,
  getUserFlairs,
  toggleBlockUser,
  getBlockedUsers,
  getUserStats,
};
