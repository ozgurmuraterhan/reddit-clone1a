const { ModLog, Subreddit, SubredditMembership } = require('../models');

/**
 * Subreddit mod loglarını getir
 * @route GET /api/subreddits/:subredditName/modlog
 * @access Private/Moderator
 */
const getModLogs = async (req, res) => {
  try {
    const { subredditName } = req.params;
    const userId = req.user._id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const { action, moderator } = req.query;

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
    if (action) {
      filter.action = action;
    }
    if (moderator) {
      filter.moderator = moderator;
    }

    // Logları getir
    const logs = await ModLog.find(filter)
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 })
      .populate('moderator', 'username profilePicture')
      .populate('targetUser', 'username')
      .populate('targetPost', 'title')
      .populate('targetComment', 'content');

    const totalLogs = await ModLog.countDocuments(filter);

    res.status(200).json({
      success: true,
      count: logs.length,
      total: totalLogs,
      totalPages: Math.ceil(totalLogs / limit),
      currentPage: page,
      data: logs,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Moderasyon logları getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * Mod logunu oluştur (iç kullanım için)
 */
const createModLog = async (logData) => {
  try {
    const log = await ModLog.create(logData);
    return log;
  } catch (error) {
    console.error('Mod log oluşturma hatası:', error);
    return null;
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

/**
 * Moderasyon aksiyonlarını listele
 * @route GET /api/modlog/actions
 * @access Private/Moderator
 */
const listModActions = async (req, res) => {
  try {
    // Reddit benzeri moderasyon aksiyonları
    const actions = [
      { value: 'approve_post', label: 'Gönderi Onaylama' },
      { value: 'remove_post', label: 'Gönderi Kaldırma' },
      { value: 'approve_comment', label: 'Yorum Onaylama' },
      { value: 'remove_comment', label: 'Yorum Kaldırma' },
      { value: 'ban_user', label: 'Kullanıcı Banlama' },
      { value: 'unban_user', label: 'Kullanıcı Ban Kaldırma' },
      { value: 'add_moderator', label: 'Moderatör Ekleme' },
      { value: 'remove_moderator', label: 'Moderatör Çıkarma' },
      { value: 'edit_settings', label: 'Subreddit Ayarları Düzenleme' },
      { value: 'rule_create', label: 'Kural Oluşturma' },
      { value: 'rule_update', label: 'Kural Güncelleme' },
      { value: 'rule_delete', label: 'Kural Silme' },
      { value: 'flair_create', label: 'Flair Oluşturma' },
      { value: 'flair_update', label: 'Flair Güncelleme' },
      { value: 'flair_delete', label: 'Flair Silme' },
      { value: 'assign_user_flair', label: 'Kullanıcı Flair Atama' },
      { value: 'remove_user_flair', label: 'Kullanıcı Flair Kaldırma' },
      { value: 'assign_post_flair', label: 'Gönderi Flair Atama' },
      { value: 'lock_post', label: 'Gönderi Kilitleme' },
      { value: 'unlock_post', label: 'Gönderi Kilit Açma' },
      { value: 'sticky_post', label: 'Gönderi Sabitleme' },
      { value: 'unsticky_post', label: 'Gönderi Sabitleme Kaldırma' },
      { value: 'lock_comment', label: 'Yorum Kilitleme' },
      { value: 'unlock_comment', label: 'Yorum Kilit Açma' },
      { value: 'mute_user', label: 'Kullanıcı Susturma' },
      { value: 'unmute_user', label: 'Kullanıcı Susturma Kaldırma' },
      { value: 'approve_wiki_page', label: 'Wiki Sayfası Onaylama' },
      { value: 'remove_wiki_page', label: 'Wiki Sayfası Kaldırma' },
      { value: 'edit_wiki_permissions', label: 'Wiki İzinleri Düzenleme' },
      { value: 'filter_update', label: 'İçerik Filtresi Güncelleme' },
    ];

    res.status(200).json({
      success: true,
      data: actions,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Moderasyon aksiyonları listelenirken bir hata oluştu',
      error: error.message,
    });
  }
};

module.exports = {
  getModLogs,
  createModLog,
  listModActions,
};
