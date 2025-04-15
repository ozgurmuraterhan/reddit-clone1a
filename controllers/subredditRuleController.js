const { SubredditRule, Subreddit, ModLog } = require('../models');

/**
 * Subreddit kurallarını getir
 * @route GET /api/subreddits/:subredditName/rules
 * @access Public
 */
const getRules = async (req, res) => {
  try {
    const { subredditName } = req.params;

    // Subreddit'i bul
    const subreddit = await Subreddit.findOne({ name: subredditName });

    if (!subreddit) {
      return res.status(404).json({
        success: false,
        message: 'Subreddit bulunamadı',
      });
    }

    // Kuralları getir
    const rules = await SubredditRule.find({ subreddit: subreddit._id }).sort({
      order: 1,
      createdAt: 1,
    });

    res.status(200).json({
      success: true,
      count: rules.length,
      data: rules,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Kurallar getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * Subreddit kuralı oluştur
 * @route POST /api/subreddits/:subredditName/rules
 * @access Private/Moderator
 */
const createRule = async (req, res) => {
  try {
    const { subredditName } = req.params;
    const { title, description, appliesTo, reportReason, isRemovalReason } = req.body;
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

    // Mevcut kural sayısını kontrol et
    const rulesCount = await SubredditRule.countDocuments({ subreddit: subreddit._id });

    if (rulesCount >= 15) {
      return res.status(400).json({
        success: false,
        message: 'Bir subreddit en fazla 15 kurala sahip olabilir',
      });
    }

    // Yeni kural oluştur
    const newRule = await SubredditRule.create({
      subreddit: subreddit._id,
      title,
      description,
      appliesTo: appliesTo || 'posts_and_comments',
      reportReason: reportReason || title,
      isRemovalReason: isRemovalReason || false,
      createdBy: userId,
      order: rulesCount + 1,
    });

    // Mod log oluştur
    await ModLog.create({
      subreddit: subreddit._id,
      moderator: userId,
      action: 'rule_create',
      details: `Created rule: ${title}`,
    });

    res.status(201).json({
      success: true,
      message: 'Kural başarıyla oluşturuldu',
      data: newRule,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Kural oluşturulurken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * Subreddit kuralını güncelle
 * @route PUT /api/subreddits/:subredditName/rules/:ruleId
 * @access Private/Moderator
 */
const updateRule = async (req, res) => {
  try {
    const { subredditName, ruleId } = req.params;
    const { title, description, appliesTo, reportReason, isRemovalReason, order } = req.body;
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

    // Kuralı bul
    const rule = await SubredditRule.findOne({
      _id: ruleId,
      subreddit: subreddit._id,
    });

    if (!rule) {
      return res.status(404).json({
        success: false,
        message: 'Kural bulunamadı',
      });
    }

    // Güncellenecek alanları belirle
    const updateData = {};
    if (title !== undefined) updateData.title = title;
    if (description !== undefined) updateData.description = description;
    if (appliesTo !== undefined) updateData.appliesTo = appliesTo;
    if (reportReason !== undefined) updateData.reportReason = reportReason;
    if (isRemovalReason !== undefined) updateData.isRemovalReason = isRemovalReason;
    if (order !== undefined) updateData.order = order;

    updateData.updatedAt = Date.now();
    updateData.updatedBy = userId;

    // Kuralı güncelle
    const updatedRule = await SubredditRule.findByIdAndUpdate(ruleId, updateData, {
      new: true,
      runValidators: true,
    });

    // Mod log oluştur
    await ModLog.create({
      subreddit: subreddit._id,
      moderator: userId,
      action: 'rule_update',
      details: `Updated rule: ${rule.title}`,
    });

    res.status(200).json({
      success: true,
      message: 'Kural başarıyla güncellendi',
      data: updatedRule,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Kural güncellenirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * Subreddit kuralını sil
 * @route DELETE /api/subreddits/:subredditName/rules/:ruleId
 * @access Private/Moderator
 */
const deleteRule = async (req, res) => {
  try {
    const { subredditName, ruleId } = req.params;
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

    // Kuralı bul
    const rule = await SubredditRule.findOne({
      _id: ruleId,
      subreddit: subreddit._id,
    });

    if (!rule) {
      return res.status(404).json({
        success: false,
        message: 'Kural bulunamadı',
      });
    }

    // Kuralı sil
    await rule.remove();

    // Kalan kuralların sırasını güncelle
    await SubredditRule.updateMany(
      { subreddit: subreddit._id, order: { $gt: rule.order } },
      { $inc: { order: -1 } },
    );

    // Mod log oluştur
    await ModLog.create({
      subreddit: subreddit._id,
      moderator: userId,
      action: 'rule_delete',
      details: `Deleted rule: ${rule.title}`,
    });

    res.status(200).json({
      success: true,
      message: 'Kural başarıyla silindi',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Kural silinirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * Kuralların sırasını güncelle
 * @route PUT /api/subreddits/:subredditName/rules/reorder
 * @access Private/Moderator
 */
const reorderRules = async (req, res) => {
  try {
    const { subredditName } = req.params;
    const { ruleOrders } = req.body; // { ruleId: order } şeklinde bir obje
    const userId = req.user._id;

    if (!ruleOrders || typeof ruleOrders !== 'object') {
      return res.status(400).json({
        success: false,
        message: 'Geçersiz kural sıralaması gönderildi',
      });
    }

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

    // Her kural için sırayı güncelle
    const updatePromises = Object.entries(ruleOrders).map(([ruleId, order]) => {
      return SubredditRule.findOneAndUpdate(
        { _id: ruleId, subreddit: subreddit._id },
        { order, updatedAt: Date.now(), updatedBy: userId },
        { new: true },
      );
    });

    await Promise.all(updatePromises);

    // Tüm kuralları alıp güncel sırayla döndür
    const updatedRules = await SubredditRule.find({ subreddit: subreddit._id }).sort({ order: 1 });

    // Mod log oluştur
    await ModLog.create({
      subreddit: subreddit._id,
      moderator: userId,
      action: 'rules_reorder',
      details: 'Reordered subreddit rules',
    });

    res.status(200).json({
      success: true,
      message: 'Kural sıralaması başarıyla güncellendi',
      data: updatedRules,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Kural sıralaması güncellenirken bir hata oluştu',
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
  getRules,
  createRule,
  updateRule,
  deleteRule,
  reorderRules,
};
