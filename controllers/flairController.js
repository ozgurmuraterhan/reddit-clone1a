const { Flair, Subreddit, User, Post, ModLog, SubredditMembership } = require('../models');

/**
 * Subreddit'in flair'lerini getir
 * @route GET /api/subreddits/:subredditName/flairs
 * @access Public
 */
const getSubredditFlairs = async (req, res) => {
  try {
    const { subredditName } = req.params;
    const { type } = req.query; // 'user' veya 'post' olabilir
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    // Subreddit'i bul
    const subreddit = await Subreddit.findOne({ name: subredditName });

    if (!subreddit) {
      return res.status(404).json({
        success: false,
        message: 'Subreddit bulunamadı',
      });
    }

    // Filtre oluştur
    const filter = { subreddit: subreddit._id };
    if (type && ['user', 'post'].includes(type)) {
      filter.type = type;
    }

    // Flairleri getir
    const flairs = await Flair.find(filter)
      .skip(skip)
      .limit(limit)
      .sort({ order: 1, createdAt: 1 });

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
      message: 'Flairler getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * Flair oluştur
 * @route POST /api/subreddits/:subredditName/flairs
 * @access Private/Moderator
 */
const createFlair = async (req, res) => {
  try {
    const { subredditName } = req.params;
    const { name, type, backgroundColor, textColor, cssClass, isModOnly, allowUserEdits, emoji } =
      req.body;
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

    // Flair tipini doğrula
    if (!type || !['user', 'post'].includes(type)) {
      return res.status(400).json({
        success: false,
        message: 'Geçersiz flair tipi. "user" veya "post" olmalıdır.',
      });
    }

    // Mevcut flair sayısını kontrol et
    const flairsCount = await Flair.countDocuments({
      subreddit: subreddit._id,
      type,
    });

    const maxFlairs = type === 'user' ? 100 : 350; // Reddit benzeri limitler
    if (flairsCount >= maxFlairs) {
      return res.status(400).json({
        success: false,
        message: `Bir subreddit en fazla ${maxFlairs} ${type} flair'ine sahip olabilir`,
      });
    }

    // Yeni flair oluştur
    const newFlair = await Flair.create({
      subreddit: subreddit._id,
      name,
      type,
      backgroundColor: backgroundColor || '#EEEEEE',
      textColor: textColor || '#000000',
      cssClass,
      isModOnly: isModOnly || false,
      allowUserEdits: allowUserEdits || false,
      emoji,
      createdBy: userId,
      order: flairsCount + 1,
    });

    // Mod log oluştur
    await ModLog.create({
      subreddit: subreddit._id,
      moderator: userId,
      action: 'flair_create',
      details: `Created ${type} flair: ${name}`,
    });

    res.status(201).json({
      success: true,
      message: 'Flair başarıyla oluşturuldu',
      data: newFlair,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Flair oluşturulurken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * Flair güncelle
 * @route PUT /api/subreddits/:subredditName/flairs/:flairId
 * @access Private/Moderator
 */
const updateFlair = async (req, res) => {
  try {
    const { subredditName, flairId } = req.params;
    const { name, backgroundColor, textColor, cssClass, isModOnly, allowUserEdits, emoji, order } =
      req.body;
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

    // Flair'i bul
    const flair = await Flair.findOne({
      _id: flairId,
      subreddit: subreddit._id,
    });

    if (!flair) {
      return res.status(404).json({
        success: false,
        message: 'Flair bulunamadı',
      });
    }

    // Güncellenecek alanları belirle
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (backgroundColor !== undefined) updateData.backgroundColor = backgroundColor;
    if (textColor !== undefined) updateData.textColor = textColor;
    if (cssClass !== undefined) updateData.cssClass = cssClass;
    if (isModOnly !== undefined) updateData.isModOnly = isModOnly;
    if (allowUserEdits !== undefined) updateData.allowUserEdits = allowUserEdits;
    if (emoji !== undefined) updateData.emoji = emoji;
    if (order !== undefined) updateData.order = order;

    updateData.updatedAt = Date.now();
    updateData.updatedBy = userId;

    // Flair'i güncelle
    const updatedFlair = await Flair.findByIdAndUpdate(flairId, updateData, {
      new: true,
      runValidators: true,
    });

    // Mod log oluştur
    await ModLog.create({
      subreddit: subreddit._id,
      moderator: userId,
      action: 'flair_update',
      details: `Updated ${flair.type} flair: ${flair.name}`,
    });

    res.status(200).json({
      success: true,
      message: 'Flair başarıyla güncellendi',
      data: updatedFlair,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Flair güncellenirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * Flair'i sil
 * @route DELETE /api/subreddits/:subredditName/flairs/:flairId
 * @access Private/Moderator
 */
const deleteFlair = async (req, res) => {
  try {
    const { subredditName, flairId } = req.params;
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

    // Flair'i bul
    const flair = await Flair.findOne({
      _id: flairId,
      subreddit: subreddit._id,
    });

    if (!flair) {
      return res.status(404).json({
        success: false,
        message: 'Flair bulunamadı',
      });
    }

    // Flair'i sil
    await flair.remove();

    // İlgili post veya kullanıcı flair'lerini temizle
    if (flair.type === 'user') {
      // Kullanıcı flairlerini sil
      await User.updateMany({ 'flairs.flair': flairId }, { $pull: { flairs: { flair: flairId } } });
    } else {
      // Post flairlerini sil
      await Post.updateMany({ flair: flairId }, { $unset: { flair: 1 } });
    }

    // Mod log oluştur
    await ModLog.create({
      subreddit: subreddit._id,
      moderator: userId,
      action: 'flair_delete',
      details: `Deleted ${flair.type} flair: ${flair.name}`,
    });

    res.status(200).json({
      success: true,
      message: 'Flair başarıyla silindi',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Flair silinirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * Kullanıcıya flair ata
 * @route POST /api/subreddits/:subredditName/flairs/assign-user
 * @access Private/Moderator
 */
const assignUserFlair = async (req, res) => {
  try {
    const { subredditName } = req.params;
    const { username, flairId, flairText } = req.body;
    const moderatorId = req.user._id;

    // Subreddit'i bul
    const subreddit = await Subreddit.findOne({ name: subredditName });

    if (!subreddit) {
      return res.status(404).json({
        success: false,
        message: 'Subreddit bulunamadı',
      });
    }

    // Kullanıcının moderatör olup olmadığını kontrol et
    const isModerator = await isUserModerator(moderatorId, subreddit._id);
    if (!isModerator) {
      return res.status(403).json({
        success: false,
        message: 'Bu işlem için moderatör yetkiniz bulunmamaktadır',
      });
    }

    // Hedef kullanıcıyı bul
    const user = await User.findOne({ username });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Kullanıcı bulunamadı',
      });
    }

    // Flair'i bul
    const flair = await Flair.findOne({
      _id: flairId,
      subreddit: subreddit._id,
      type: 'user',
    });

    if (!flair) {
      return res.status(404).json({
        success: false,
        message: "Kullanıcı flair'i bulunamadı",
      });
    }

    // Kullanıcının subreddit üyeliği var mı kontrol et
    const membership = await SubredditMembership.findOne({
      user: user._id,
      subreddit: subreddit._id,
    });

    if (!membership) {
      return res.status(400).json({
        success: false,
        message: "Kullanıcı bu subreddit'e üye değil",
      });
    }

    // Kullanıcıya flair ekle veya güncelle
    const flairIndex = user.flairs.findIndex(
      (f) => f.subreddit.toString() === subreddit._id.toString(),
    );

    if (flairIndex >= 0) {
      // Mevcut flair'i güncelle
      user.flairs[flairIndex] = {
        subreddit: subreddit._id,
        flair: flair._id,
        text: flairText || '',
        assignedBy: moderatorId,
        assignedAt: Date.now(),
      };
    } else {
      // Yeni flair ekle
      user.flairs.push({
        subreddit: subreddit._id,
        flair: flair._id,
        text: flairText || '',
        assignedBy: moderatorId,
        assignedAt: Date.now(),
      });
    }

    await user.save();

    // Mod log oluştur
    await ModLog.create({
      subreddit: subreddit._id,
      moderator: moderatorId,
      targetUser: user._id,
      action: 'assign_user_flair',
      details: `Assigned "${flair.name}" flair to u/${username}`,
    });

    res.status(200).json({
      success: true,
      message: "Kullanıcı flair'i başarıyla atandı",
      data: {
        user: username,
        flair: {
          id: flair._id,
          name: flair.name,
          text: flairText || '',
        },
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Kullanıcı flair'i atanırken bir hata oluştu",
      error: error.message,
    });
  }
};

/**
 * Posta flair ata
 * @route POST /api/posts/:postId/flair
 * @access Private/Moderator or Post Author
 */
const assignPostFlair = async (req, res) => {
  try {
    const { postId } = req.params;
    const { flairId } = req.body;
    const userId = req.user._id;

    // Postu bul
    const post = await Post.findById(postId);

    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Gönderi bulunamadı',
      });
    }

    // Subreddit'i bul
    const subreddit = await Subreddit.findById(post.subreddit);

    if (!subreddit) {
      return res.status(404).json({
        success: false,
        message: 'Subreddit bulunamadı',
      });
    }

    // Kullanıcının yetkisini kontrol et (yazar veya moderatör olmalı)
    const isAuthor = post.author.toString() === userId.toString();
    const isModerator = await isUserModerator(userId, subreddit._id);

    if (!isAuthor && !isModerator) {
      return res.status(403).json({
        success: false,
        message: 'Bu işlem için yetkiniz bulunmamaktadır',
      });
    }

    // Flair'i bul
    const flair = await Flair.findOne({
      _id: flairId,
      subreddit: subreddit._id,
      type: 'post',
    });

    if (!flair) {
      return res.status(404).json({
        success: false,
        message: "Post flair'i bulunamadı",
      });
    }

    // Moderatör olmayan kullanıcılar mod-only flair'leri kullanamaz
    if (flair.isModOnly && !isModerator) {
      return res.status(403).json({
        success: false,
        message: 'Bu flair sadece moderatörler tarafından kullanılabilir',
      });
    }

    // Posta flair ata
    post.flair = flair._id;
    await post.save();

    // Log oluştur (moderatör ise)
    if (isModerator && !isAuthor) {
      await ModLog.create({
        subreddit: subreddit._id,
        moderator: userId,
        targetPost: post._id,
        action: 'assign_post_flair',
        details: `Assigned "${flair.name}" flair to post`,
      });
    }

    res.status(200).json({
      success: true,
      message: "Post flair'i başarıyla atandı",
      data: {
        post: post._id,
        flair: {
          id: flair._id,
          name: flair.name,
          backgroundColor: flair.backgroundColor,
          textColor: flair.textColor,
        },
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Post flair'i atanırken bir hata oluştu",
      error: error.message,
    });
  }
};

/**
 * Kullanıcının flair'ini kaldır
 * @route DELETE /api/subreddits/:subredditName/users/:username/flair
 * @access Private/Moderator
 */
const removeUserFlair = async (req, res) => {
  try {
    const { subredditName, username } = req.params;
    const moderatorId = req.user._id;

    // Subreddit'i bul
    const subreddit = await Subreddit.findOne({ name: subredditName });

    if (!subreddit) {
      return res.status(404).json({
        success: false,
        message: 'Subreddit bulunamadı',
      });
    }

    // Kullanıcının moderatör olup olmadığını kontrol et
    const isModerator = await isUserModerator(moderatorId, subreddit._id);
    if (!isModerator) {
      return res.status(403).json({
        success: false,
        message: 'Bu işlem için moderatör yetkiniz bulunmamaktadır',
      });
    }

    // Hedef kullanıcıyı bul
    const user = await User.findOne({ username });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Kullanıcı bulunamadı',
      });
    }

    // Kullanıcının flair'ini bul ve kaldır
    const flairIndex = user.flairs.findIndex(
      (f) => f.subreddit.toString() === subreddit._id.toString(),
    );

    if (flairIndex === -1) {
      return res.status(404).json({
        success: false,
        message: "Kullanıcının bu subreddit'te flair'i yok",
      });
    }

    // Flair'i kaydet (mod log için)
    const removedFlair = user.flairs[flairIndex];

    // Flair'i kaldır
    user.flairs.splice(flairIndex, 1);
    await user.save();

    // Mod log oluştur
    await ModLog.create({
      subreddit: subreddit._id,
      moderator: moderatorId,
      targetUser: user._id,
      action: 'remove_user_flair',
      details: `Removed user flair from u/${username}`,
    });

    res.status(200).json({
      success: true,
      message: "Kullanıcı flair'i başarıyla kaldırıldı",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Kullanıcı flair'i kaldırılırken bir hata oluştu",
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
  getSubredditFlairs,
  createFlair,
  updateFlair,
  deleteFlair,
  assignUserFlair,
  assignPostFlair,
  removeUserFlair,
};
