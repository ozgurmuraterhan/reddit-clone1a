const SubredditRule = require('../models/SubredditRule');
const SubredditMembership = require('../models/SubredditMembership'); // Assuming this model exists
const Subreddit = require('../models/Subreddit');
const asyncHandler = require('../middleware/async');
const ErrorResponse = require('../utils/errorResponse');
const mongoose = require('mongoose');

/**
 * @desc    Subreddit kurallarını getir
 * @route   GET /api/subreddits/:subredditId/rules
 * @access  Public
 */
const getSubredditRules = asyncHandler(async (req, res, next) => {
  const { subredditId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(subredditId)) {
    return next(new ErrorResponse('Geçersiz subreddit ID formatı', 400));
  }

  // Subreddit'in var olduğunu kontrol et
  const subreddit = await Subreddit.findById(subredditId);
  if (!subreddit) {
    return next(new ErrorResponse('Subreddit bulunamadı', 404));
  }

  // Kuralları pozisyona göre sıralanmış olarak getir
  const rules = await SubredditRule.find({ subreddit: subredditId })
    .sort({ position: 1 })
    .populate('createdBy', 'username')
    .populate('updatedBy', 'username');

  res.status(200).json({
    success: true,
    count: rules.length,
    data: rules,
  });
});

/**
 * @desc    Bir subreddit kuralını ID'ye göre getir
 * @route   GET /api/subreddits/:subredditId/rules/:id
 * @access  Public
 */
const getSubredditRule = asyncHandler(async (req, res, next) => {
  const { id, subredditId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(subredditId)) {
    return next(new ErrorResponse('Geçersiz ID formatı', 400));
  }

  // Kuralı bul ve yaratıcı/düzenleyicileri popüle et
  const rule = await SubredditRule.findOne({
    _id: id,
    subreddit: subredditId,
  })
    .populate('createdBy', 'username')
    .populate('updatedBy', 'username')
    .populate('subreddit', 'name title');

  if (!rule) {
    return next(new ErrorResponse('Kural bulunamadı', 404));
  }

  res.status(200).json({
    success: true,
    data: rule,
  });
});

/**
 * @desc    Yeni subreddit kuralı oluştur
 * @route   POST /api/subreddits/:subredditId/rules
 * @access  Private (Moderator/Admin)
 */
const createSubredditRule = asyncHandler(async (req, res, next) => {
  const { subredditId } = req.params;
  const userId = req.user._id;

  if (!mongoose.Types.ObjectId.isValid(subredditId)) {
    return next(new ErrorResponse('Geçersiz subreddit ID formatı', 400));
  }

  // Subreddit'in var olduğunu kontrol et
  const subreddit = await Subreddit.findById(subredditId);
  if (!subreddit) {
    return next(new ErrorResponse('Subreddit bulunamadı', 404));
  }

  // Moderatör/Admin yetkisi kontrol et
  const isModerator = await checkModeratorPermission(userId, subredditId);
  if (!isModerator) {
    return next(new ErrorResponse('Bu işlem için moderatör yetkisi gerekiyor', 403));
  }

  // En son pozisyonu bul
  const lastRule = await SubredditRule.findOne({ subreddit: subredditId }).sort('-position');

  const nextPosition = lastRule ? lastRule.position + 1 : 0;

  // Kuralı oluştur
  const rule = await SubredditRule.create({
    ...req.body,
    subreddit: subredditId,
    createdBy: userId,
    position: nextPosition,
  });

  res.status(201).json({
    success: true,
    data: rule,
  });
});

/**
 * @desc    Subreddit kuralını güncelle
 * @route   PUT /api/subreddits/:subredditId/rules/:id
 * @access  Private (Moderator/Admin)
 */
const updateSubredditRule = asyncHandler(async (req, res, next) => {
  const { id, subredditId } = req.params;
  const userId = req.user._id;

  if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(subredditId)) {
    return next(new ErrorResponse('Geçersiz ID formatı', 400));
  }

  // Moderatör/Admin yetkisi kontrol et
  const isModerator = await checkModeratorPermission(userId, subredditId);
  if (!isModerator) {
    return next(new ErrorResponse('Bu işlem için moderatör yetkisi gerekiyor', 403));
  }

  // Güncelleme alanlarını hazırla, pozisyon değişimi hariç
  const updateFields = { ...req.body, updatedBy: userId };

  // Pozisyon elle değiştirilemez, bunun için özel endpoint kullanılmalı
  if ('position' in updateFields) {
    delete updateFields.position;
  }

  // Kuralı güncelle
  const rule = await SubredditRule.findOneAndUpdate(
    { _id: id, subreddit: subredditId },
    updateFields,
    {
      new: true,
      runValidators: true,
    },
  );

  if (!rule) {
    return next(new ErrorResponse('Kural bulunamadı', 404));
  }

  res.status(200).json({
    success: true,
    data: rule,
  });
});

/**
 * @desc    Subreddit kuralını sil
 * @route   DELETE /api/subreddits/:subredditId/rules/:id
 * @access  Private (Moderator/Admin)
 */
const deleteSubredditRule = asyncHandler(async (req, res, next) => {
  const { id, subredditId } = req.params;
  const userId = req.user._id;

  if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(subredditId)) {
    return next(new ErrorResponse('Geçersiz ID formatı', 400));
  }

  // Moderatör/Admin yetkisi kontrol et
  const isModerator = await checkModeratorPermission(userId, subredditId);
  if (!isModerator) {
    return next(new ErrorResponse('Bu işlem için moderatör yetkisi gerekiyor', 403));
  }

  // Kuralı bul
  const rule = await SubredditRule.findOne({ _id: id, subreddit: subredditId });
  if (!rule) {
    return next(new ErrorResponse('Kural bulunamadı', 404));
  }

  // Kuralı sil
  await rule.remove();

  // Kalan kuralların pozisyonunu yeniden düzenle
  await reorderRules(subredditId);

  res.status(200).json({
    success: true,
    data: {},
  });
});

/**
 * @desc    Subreddit kuralının pozisyonunu değiştir
 * @route   PUT /api/subreddits/:subredditId/rules/:id/position
 * @access  Private (Moderator/Admin)
 */
const changeRulePosition = asyncHandler(async (req, res, next) => {
  const { id, subredditId } = req.params;
  const { newPosition } = req.body;
  const userId = req.user._id;

  if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(subredditId)) {
    return next(new ErrorResponse('Geçersiz ID formatı', 400));
  }

  if (typeof newPosition !== 'number' || newPosition < 0) {
    return next(new ErrorResponse('Geçersiz pozisyon değeri', 400));
  }

  // Moderatör/Admin yetkisi kontrol et
  const isModerator = await checkModeratorPermission(userId, subredditId);
  if (!isModerator) {
    return next(new ErrorResponse('Bu işlem için moderatör yetkisi gerekiyor', 403));
  }

  // Kuralı bul
  const rule = await SubredditRule.findOne({ _id: id, subreddit: subredditId });
  if (!rule) {
    return next(new ErrorResponse('Kural bulunamadı', 404));
  }

  // Tüm kuralları al
  const allRules = await SubredditRule.find({ subreddit: subredditId }).sort({ position: 1 });

  // Geçerli bir pozisyon değeri olduğunu kontrol et
  if (newPosition >= allRules.length) {
    return next(
      new ErrorResponse(`Pozisyon değeri 0 ile ${allRules.length - 1} arasında olmalıdır`, 400),
    );
  }

  // Eğer zaten istenen pozisyondaysa işlem yapma
  if (rule.position === newPosition) {
    return res.status(200).json({
      success: true,
      data: rule,
    });
  }

  // Sürükleme yönünü belirle
  const isMovingDown = newPosition > rule.position;

  // Diğer kuralların pozisyonlarını güncelle
  if (isMovingDown) {
    // Aşağı taşınıyorsa, arada kalan kuralları bir yukarı kaydır
    await SubredditRule.updateMany(
      {
        subreddit: subredditId,
        position: { $gt: rule.position, $lte: newPosition },
      },
      { $inc: { position: -1 } },
    );
  } else {
    // Yukarı taşınıyorsa, arada kalan kuralları bir aşağı kaydır
    await SubredditRule.updateMany(
      {
        subreddit: subredditId,
        position: { $lt: rule.position, $gte: newPosition },
      },
      { $inc: { position: 1 } },
    );
  }

  // Kuralın yeni pozisyonunu ayarla
  rule.position = newPosition;
  rule.updatedBy = userId;
  await rule.save();

  res.status(200).json({
    success: true,
    data: rule,
  });
});

/**
 * @desc    Subreddit'teki tüm kuralları getirme (rapor nedeni olarak işaretlenmiş)
 * @route   GET /api/subreddits/:subredditId/rules/report-reasons
 * @access  Public
 */
const getReportReasons = asyncHandler(async (req, res, next) => {
  const { subredditId } = req.params;
  const { type } = req.query; // 'posts', 'comments', veya her ikisi

  if (!mongoose.Types.ObjectId.isValid(subredditId)) {
    return next(new ErrorResponse('Geçersiz subreddit ID formatı', 400));
  }

  // Filtreleme kriterlerini oluştur
  const filter = {
    subreddit: subredditId,
    reportReason: true,
  };

  // Eğer tip belirtilmişse, appliesTo alanına göre filtrele
  if (type === 'posts' || type === 'comments') {
    filter.$or = [{ appliesTo: type }, { appliesTo: 'both' }];
  }

  // Rapor nedeni olarak işaretlenmiş kuralları getir
  const rules = await SubredditRule.find(filter)
    .sort({ position: 1 })
    .select('title description appliesTo position');

  res.status(200).json({
    success: true,
    count: rules.length,
    data: rules,
  });
});

/**
 * @desc    Kuralları yeniden düzenle (pozisyonlarını sıfırla)
 * @route   POST /api/subreddits/:subredditId/rules/reorder
 * @access  Private (Moderator/Admin)
 */
const reorderAllRules = asyncHandler(async (req, res, next) => {
  const { subredditId } = req.params;
  const userId = req.user._id;

  if (!mongoose.Types.ObjectId.isValid(subredditId)) {
    return next(new ErrorResponse('Geçersiz subreddit ID formatı', 400));
  }

  // Moderatör/Admin yetkisi kontrol et
  const isModerator = await checkModeratorPermission(userId, subredditId);
  if (!isModerator) {
    return next(new ErrorResponse('Bu işlem için moderatör yetkisi gerekiyor', 403));
  }

  // Kuralları yeniden sırala
  await reorderRules(subredditId);

  // Güncellenmiş kuralları getir
  const rules = await SubredditRule.find({ subreddit: subredditId }).sort({ position: 1 });

  // ... continued from previous code

  res.status(200).json({
    success: true,
    message: 'Kurallar başarıyla yeniden sıralandı',
    count: rules.length,
    data: rules,
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
 * Subreddit kurallarını yeniden sırala
 * @param {ObjectId} subredditId - Subreddit ID
 */
const reorderRules = async (subredditId) => {
  // Tüm kuralları al
  const rules = await SubredditRule.find({ subreddit: subredditId }).sort({ position: 1 });

  // Her kurala sırayla yeni pozisyon ver
  const updateOperations = rules.map((rule, index) => ({
    updateOne: {
      filter: { _id: rule._id },
      update: { position: index },
    },
  }));

  if (updateOperations.length > 0) {
    await SubredditRule.bulkWrite(updateOperations);
  }
};

/**
 * @desc    Bir kural birden çok subreddit'e kopyala
 * @route   POST /api/subreddits/:subredditId/rules/:id/copy
 * @access  Private (Admin)
 */
const copyRuleToSubreddits = asyncHandler(async (req, res, next) => {
  const { id, subredditId } = req.params;
  const { targetSubreddits } = req.body;
  const userId = req.user._id;

  if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(subredditId)) {
    return next(new ErrorResponse('Geçersiz ID formatı', 400));
  }

  // Admin yetkisi kontrol et
  const user = await mongoose.model('User').findById(userId);
  if (!user || user.role !== 'admin') {
    return next(new ErrorResponse('Bu işlem için admin yetkisi gerekiyor', 403));
  }

  // Hedef subreddit'lerin geçerli olduğunu kontrol et
  if (!Array.isArray(targetSubreddits) || targetSubreddits.length === 0) {
    return next(new ErrorResponse('Geçerli hedef subreddit listesi gerekiyor', 400));
  }

  // Orijinal kuralı bul
  const rule = await SubredditRule.findOne({ _id: id, subreddit: subredditId });
  if (!rule) {
    return next(new ErrorResponse('Kural bulunamadı', 404));
  }

  // Her hedef subreddit için kuralı kopyala
  const results = {
    success: [],
    failed: [],
  };

  for (const targetId of targetSubreddits) {
    if (!mongoose.Types.ObjectId.isValid(targetId)) {
      results.failed.push({ id: targetId, error: 'Geçersiz ID formatı' });
      continue;
    }

    try {
      // Hedef subreddit'in var olduğunu kontrol et
      const targetSubreddit = await Subreddit.findById(targetId);
      if (!targetSubreddit) {
        results.failed.push({ id: targetId, error: 'Subreddit bulunamadı' });
        continue;
      }

      // Mevcut son pozisyonu bul
      const lastRule = await SubredditRule.findOne({ subreddit: targetId }).sort('-position');

      const nextPosition = lastRule ? lastRule.position + 1 : 0;

      // Kuralı kopyala
      const newRule = await SubredditRule.create({
        subreddit: targetId,
        title: rule.title,
        description: rule.description,
        appliesTo: rule.appliesTo,
        reportReason: rule.reportReason,
        createdBy: userId,
        position: nextPosition,
      });

      results.success.push({
        id: targetId,
        name: targetSubreddit.name,
        rule: newRule._id,
      });
    } catch (error) {
      results.failed.push({
        id: targetId,
        error: error.message || 'Kopyalama sırasında hata oluştu',
      });
    }
  }

  res.status(200).json({
    success: true,
    data: results,
  });
});

/**
 * @desc    Kuralları sıralama sırasını değiştir (sürükle & bırak için)
 * @route   PUT /api/subreddits/:subredditId/rules/reorder-batch
 * @access  Private (Moderator/Admin)
 */
const reorderRulesBatch = asyncHandler(async (req, res, next) => {
  const { subredditId } = req.params;
  const { ruleOrder } = req.body;
  const userId = req.user._id;

  if (!mongoose.Types.ObjectId.isValid(subredditId)) {
    return next(new ErrorResponse('Geçersiz subreddit ID formatı', 400));
  }

  // Moderatör/Admin yetkisi kontrol et
  const isModerator = await checkModeratorPermission(userId, subredditId);
  if (!isModerator) {
    return next(new ErrorResponse('Bu işlem için moderatör yetkisi gerekiyor', 403));
  }

  // Giriş verilerini doğrula
  if (!Array.isArray(ruleOrder)) {
    return next(new ErrorResponse('Kural sırası array olarak verilmelidir', 400));
  }

  // Tüm kuralları al
  const existingRules = await SubredditRule.find({ subreddit: subredditId });

  // Tüm kuralların var olduğundan emin ol
  if (ruleOrder.length !== existingRules.length) {
    return next(new ErrorResponse('Verilen kural sırası mevcut tüm kuralları içermelidir', 400));
  }

  // Her kurala yeni pozisyon ver
  const updateOperations = ruleOrder.map((ruleId, index) => {
    if (!mongoose.Types.ObjectId.isValid(ruleId)) {
      throw new Error(`Geçersiz kural ID formatı: ${ruleId}`);
    }

    // Bu ID'nin mevcut kurallar arasında olduğunu kontrol et
    const ruleExists = existingRules.some((rule) => rule._id.toString() === ruleId);
    if (!ruleExists) {
      throw new Error(`Kural bulunamadı: ${ruleId}`);
    }

    return {
      updateOne: {
        filter: { _id: ruleId, subreddit: subredditId },
        update: { position: index, updatedBy: userId },
      },
    };
  });

  // Toplu güncelleme işlemini gerçekleştir
  await SubredditRule.bulkWrite(updateOperations);

  // Güncellenmiş kuralları getir
  const rules = await SubredditRule.find({ subreddit: subredditId }).sort({ position: 1 });

  res.status(200).json({
    success: true,
    message: 'Kurallar başarıyla yeniden sıralandı',
    count: rules.length,
    data: rules,
  });
});

module.exports = {
  getSubredditRules,
  getSubredditRule,
  createSubredditRule,
  updateSubredditRule,
  deleteSubredditRule,
  changeRulePosition,
  getReportReasons,
  reorderAllRules,
  copyRuleToSubreddits,
  reorderRulesBatch,
};
