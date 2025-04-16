const Flair = require('../models/Flair');
const Subreddit = require('../models/Subreddit');
const Post = require('../models/Post');
const User = require('../models/User');
const SubredditMembership = require('../models/SubredditMembership');
const ModLog = require('../models/ModLog');
const asyncHandler = require('../middleware/async');
const ErrorResponse = require('../utils/errorResponse');
const mongoose = require('mongoose');
const { isModeratorOf } = require('../utils/roleHelpers');

/**
 * @desc    Bir subreddit için tüm flairleri getir
 * @route   GET /api/subreddits/:subredditId/flairs
 * @access  Public
 */
const getFlairs = asyncHandler(async (req, res, next) => {
  const { subredditId } = req.params;
  const { type } = req.query;

  // ID formatı kontrolü
  if (!mongoose.Types.ObjectId.isValid(subredditId)) {
    return next(new ErrorResponse('Geçersiz subreddit ID formatı', 400));
  }

  // Subreddit kontrolü
  const subreddit = await Subreddit.findById(subredditId);
  if (!subreddit) {
    return next(new ErrorResponse('Subreddit bulunamadı', 404));
  }

  // Filtre oluştur
  const filter = { subreddit: subredditId };

  // Tipe göre filtrele
  if (type && ['post', 'user'].includes(type)) {
    filter.type = type;
  }

  // Flairleri getir
  const flairs = await Flair.find(filter)
    .sort({ position: 1, createdAt: 1 })
    .populate('createdBy', 'username')
    .populate('updatedBy', 'username');

  res.status(200).json({
    success: true,
    count: flairs.length,
    data: flairs,
  });
});

/**
 * @desc    Belirli bir flairi getir
 * @route   GET /api/flairs/:id
 * @access  Public
 */
const getFlair = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  // ID formatı kontrolü
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorResponse('Geçersiz flair ID formatı', 400));
  }

  // Flairi bul
  const flair = await Flair.findById(id)
    .populate('createdBy', 'username')
    .populate('updatedBy', 'username')
    .populate('subreddit', 'name title');

  if (!flair) {
    return next(new ErrorResponse('Flair bulunamadı', 404));
  }

  res.status(200).json({
    success: true,
    data: flair,
  });
});

/**
 * @desc    Yeni flair oluştur
 * @route   POST /api/subreddits/:subredditId/flairs
 * @access  Private (Moderatör)
 */
const createFlair = asyncHandler(async (req, res, next) => {
  const { subredditId } = req.params;
  const { type, text, backgroundColor, textColor, emoji, position, allowUserEditable } = req.body;
  const userId = req.user._id;

  // ID formatı kontrolü
  if (!mongoose.Types.ObjectId.isValid(subredditId)) {
    return next(new ErrorResponse('Geçersiz subreddit ID formatı', 400));
  }

  // Subreddit kontrolü
  const subreddit = await Subreddit.findById(subredditId);
  if (!subreddit) {
    return next(new ErrorResponse('Subreddit bulunamadı', 404));
  }

  // Moderatör yetkisi kontrolü
  const isModerator = await isModeratorOf(userId, subredditId);
  if (!isModerator && req.user.role !== 'admin') {
    return next(new ErrorResponse('Bu işlem için moderatör yetkisi gerekiyor', 403));
  }

  // Tür kontrolü
  if (!type || !['post', 'user'].includes(type)) {
    return next(new ErrorResponse('Geçerli bir flair türü belirtmelisiniz (post veya user)', 400));
  }

  // Metin kontrolü
  if (!text || text.trim() === '') {
    return next(new ErrorResponse('Flair metni boş olamaz', 400));
  }

  // Pozisyon değeri girilmemişse mevcut en yüksek pozisyonu bul
  let flairPosition = position;
  if (flairPosition === undefined) {
    const highestPositionFlair = await Flair.findOne({
      subreddit: subredditId,
      type,
    }).sort({ position: -1 });

    flairPosition = highestPositionFlair ? highestPositionFlair.position + 1 : 0;
  }

  // Yeni flair oluştur
  const flair = await Flair.create({
    subreddit: subredditId,
    type,
    text,
    backgroundColor: backgroundColor || '#edeff1',
    textColor: textColor || '#1a1a1b',
    emoji: emoji || null,
    position: flairPosition,
    allowUserEditable: allowUserEditable || false,
    createdBy: userId,
  });

  // Moderasyon logu oluştur
  await ModLog.create({
    subreddit: subredditId,
    moderator: userId,
    action: 'create_flair',
    details: `${type === 'post' ? 'Gönderi' : 'Kullanıcı'} flairi oluşturuldu: "${text}"`,
    targetType: 'flair',
    targetId: flair._id,
  });

  res.status(201).json({
    success: true,
    data: flair,
  });
});

/**
 * @desc    Flair güncelle
 * @route   PUT /api/flairs/:id
 * @access  Private (Moderatör)
 */
const updateFlair = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { text, backgroundColor, textColor, emoji, position, allowUserEditable } = req.body;
  const userId = req.user._id;

  // ID formatı kontrolü
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorResponse('Geçersiz flair ID formatı', 400));
  }

  // Flairi bul
  let flair = await Flair.findById(id);
  if (!flair) {
    return next(new ErrorResponse('Flair bulunamadı', 404));
  }

  // Moderatör yetkisi kontrolü
  const isModerator = await isModeratorOf(userId, flair.subreddit);
  if (!isModerator && req.user.role !== 'admin') {
    return next(new ErrorResponse('Bu işlem için moderatör yetkisi gerekiyor', 403));
  }

  // Metin kontrolü
  if (text !== undefined && text.trim() === '') {
    return next(new ErrorResponse('Flair metni boş olamaz', 400));
  }

  // Güncelleme verileri
  const updateData = {
    updatedBy: userId,
    updatedAt: Date.now(),
  };

  if (text !== undefined) updateData.text = text;
  if (backgroundColor !== undefined) updateData.backgroundColor = backgroundColor;
  if (textColor !== undefined) updateData.textColor = textColor;
  if (emoji !== undefined) updateData.emoji = emoji;
  if (position !== undefined) updateData.position = position;
  if (allowUserEditable !== undefined) updateData.allowUserEditable = allowUserEditable;

  // Flairi güncelle
  flair = await Flair.findByIdAndUpdate(id, updateData, { new: true, runValidators: true });

  // Moderasyon logu oluştur
  await ModLog.create({
    subreddit: flair.subreddit,
    moderator: userId,
    action: 'update_flair',
    details: `${flair.type === 'post' ? 'Gönderi' : 'Kullanıcı'} flairi güncellendi: "${flair.text}"`,
    targetType: 'flair',
    targetId: flair._id,
  });

  res.status(200).json({
    success: true,
    data: flair,
  });
});

/**
 * @desc    Flair sil
 * @route   DELETE /api/flairs/:id
 * @access  Private (Moderatör)
 */
const deleteFlair = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user._id;

  // ID formatı kontrolü
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorResponse('Geçersiz flair ID formatı', 400));
  }

  // Flairi bul
  const flair = await Flair.findById(id);
  if (!flair) {
    return next(new ErrorResponse('Flair bulunamadı', 404));
  }

  // Moderatör yetkisi kontrolü
  const isModerator = await isModeratorOf(userId, flair.subreddit);
  if (!isModerator && req.user.role !== 'admin') {
    return next(new ErrorResponse('Bu işlem için moderatör yetkisi gerekiyor', 403));
  }

  // Bu flairi kullanan post veya kullanıcı kontrolü
  if (flair.type === 'post') {
    const postCount = await Post.countDocuments({ flair: id });
    if (postCount > 0) {
      return next(new ErrorResponse('Bu flair gönderi(ler)de kullanıldığı için silinemez', 400));
    }
  }

  // Moderasyon logu bilgisi için flair bilgilerini sakla
  const flairType = flair.type;
  const flairText = flair.text;
  const subredditId = flair.subreddit;

  // Flairi sil
  await flair.remove();

  // Moderasyon logu oluştur
  await ModLog.create({
    subreddit: subredditId,
    moderator: userId,
    action: 'delete_flair',
    details: `${flairType === 'post' ? 'Gönderi' : 'Kullanıcı'} flairi silindi: "${flairText}"`,
    targetType: 'flair',
  });

  res.status(200).json({
    success: true,
    data: {},
    message: 'Flair başarıyla silindi',
  });
});

/**
 * @desc    Flairleri sırala (pozisyonları güncelle)
 * @route   PUT /api/subreddits/:subredditId/flairs/reorder
 * @access  Private (Moderatör)
 */
const reorderFlairs = asyncHandler(async (req, res, next) => {
  const { subredditId } = req.params;
  const { flairIds, type } = req.body;
  const userId = req.user._id;

  // Zorunlu alanları kontrol et
  if (!flairIds || !Array.isArray(flairIds) || flairIds.length === 0) {
    return next(new ErrorResponse("Flair ID'leri geçerli bir dizi olmalıdır", 400));
  }

  if (!type || !['post', 'user'].includes(type)) {
    return next(new ErrorResponse('Geçerli bir flair türü belirtmelisiniz (post veya user)', 400));
  }

  // ID formatı kontrolü
  if (!mongoose.Types.ObjectId.isValid(subredditId)) {
    return next(new ErrorResponse('Geçersiz subreddit ID formatı', 400));
  }

  // Subreddit kontrolü
  const subreddit = await Subreddit.findById(subredditId);
  if (!subreddit) {
    return next(new ErrorResponse('Subreddit bulunamadı', 404));
  }

  // Moderatör yetkisi kontrolü
  const isModerator = await isModeratorOf(userId, subredditId);
  if (!isModerator && req.user.role !== 'admin') {
    return next(new ErrorResponse('Bu işlem için moderatör yetkisi gerekiyor', 403));
  }

  // Tüm flairlerin var olduğunu ve bu subreddit'e ait olduğunu kontrol et
  const flairs = await Flair.find({
    _id: { $in: flairIds },
    subreddit: subredditId,
    type,
  });

  if (flairs.length !== flairIds.length) {
    return next(
      new ErrorResponse("Bir veya daha fazla flair bulunamadı veya bu subreddit'e ait değil", 400),
    );
  }

  // Her bir flairi güncelle
  const updateOperations = flairIds.map((flairId, index) => {
    return {
      updateOne: {
        filter: { _id: flairId },
        update: {
          position: index,
          updatedBy: userId,
          updatedAt: Date.now(),
        },
      },
    };
  });

  await Flair.bulkWrite(updateOperations);

  // Moderasyon logu oluştur
  await ModLog.create({
    subreddit: subredditId,
    moderator: userId,
    action: 'reorder_flairs',
    details: `${type === 'post' ? 'Gönderi' : 'Kullanıcı'} flairleri yeniden sıralandı`,
    targetType: 'flair',
  });

  // Yeni sıralamaya göre flairleri getir
  const updatedFlairs = await Flair.find({
    subreddit: subredditId,
    type,
  }).sort({ position: 1 });

  res.status(200).json({
    success: true,
    data: updatedFlairs,
    message: 'Flairler başarıyla yeniden sıralandı',
  });
});

/**
 * @desc    Gönderiye flair atama
 * @route   PUT /api/posts/:postId/flair
 * @access  Private (Gönderi sahibi veya Moderatör)
 */
const assignFlairToPost = asyncHandler(async (req, res, next) => {
  const { postId } = req.params;
  const { flairId } = req.body;
  const userId = req.user._id;

  // ID formatı kontrolü
  if (!mongoose.Types.ObjectId.isValid(postId)) {
    return next(new ErrorResponse('Geçersiz gönderi ID formatı', 400));
  }

  if (flairId && !mongoose.Types.ObjectId.isValid(flairId)) {
    return next(new ErrorResponse('Geçersiz flair ID formatı', 400));
  }

  // Gönderiyi bul
  const post = await Post.findById(postId).populate('subreddit', 'name');
  if (!post) {
    return next(new ErrorResponse('Gönderi bulunamadı', 404));
  }

  // Flair belirtilmişse kontrol et
  let flair = null;
  if (flairId) {
    flair = await Flair.findById(flairId);
    if (!flair) {
      return next(new ErrorResponse('Flair bulunamadı', 404));
    }

    // Flair uygun türde mi ve doğru subreddit'e ait mi kontrol et
    if (flair.type !== 'post' || flair.subreddit.toString() !== post.subreddit._id.toString()) {
      return next(new ErrorResponse('Bu flair bu gönderiye atanamaz', 400));
    }
  }

  // Yetki kontrolü (gönderi sahibi veya moderatör olmalı)
  const isAuthor = post.author.toString() === userId.toString();
  if (!isAuthor) {
    const isModerator = await isModeratorOf(userId, post.subreddit._id);
    if (!isModerator && req.user.role !== 'admin') {
      return next(new ErrorResponse('Bu gönderiye flair atama yetkiniz yok', 403));
    }
  }

  // Eğer kullanıcı moderatör değilse ve flair kullanıcı tarafından düzenlenebilir değilse engelle
  if (!(await isModeratorOf(userId, post.subreddit._id)) && req.user.role !== 'admin') {
    if (flair && !flair.allowUserEditable) {
      return next(new ErrorResponse('Bu flair sadece moderatörler tarafından atanabilir', 403));
    }
  }

  // Gönderiyi güncelle (flair atama veya kaldırma)
  post.flair = flairId || null;
  await post.save();

  // Güncellenmiş gönderiyi getir
  const updatedPost = await Post.findById(postId)
    .populate('author', 'username profilePicture')
    .populate('subreddit', 'name title')
    .populate('flair', 'text backgroundColor textColor emoji');

  res.status(200).json({
    success: true,
    data: updatedPost,
    message: flairId ? 'Flair gönderiye başarıyla atandı' : 'Flair gönderiden kaldırıldı',
  });
});

/**
 * @desc    Kullanıcıya flair atama (subreddit özel)
 * @route   PUT /api/subreddits/:subredditId/users/:userId/flair
 * @access  Private (Moderatör)
 */
const assignFlairToUser = asyncHandler(async (req, res, next) => {
  const { subredditId, userId: targetUserId } = req.params;
  const { flairId, flairText } = req.body;
  const moderatorId = req.user._id;

  // ID formatı kontrolü
  if (!mongoose.Types.ObjectId.isValid(subredditId)) {
    return next(new ErrorResponse('Geçersiz subreddit ID formatı', 400));
  }

  if (!mongoose.Types.ObjectId.isValid(targetUserId)) {
    return next(new ErrorResponse('Geçersiz kullanıcı ID formatı', 400));
  }

  if (flairId && !mongoose.Types.ObjectId.isValid(flairId)) {
    return next(new ErrorResponse('Geçersiz flair ID formatı', 400));
  }

  // Subreddit kontrolü
  const subreddit = await Subreddit.findById(subredditId);
  if (!subreddit) {
    return next(new ErrorResponse('Subreddit bulunamadı', 404));
  }

  // Hedef kullanıcı kontrolü
  const targetUser = await User.findById(targetUserId);
  if (!targetUser) {
    return next(new ErrorResponse('Kullanıcı bulunamadı', 404));
  }

  // Kullanıcının subreddit üyeliğini kontrol et
  const membership = await SubredditMembership.findOne({
    user: targetUserId,
    subreddit: subredditId,
  });

  if (!membership) {
    return next(new ErrorResponse("Kullanıcı bu subreddit'e üye değil", 400));
  }

  // Moderatör yetkisi kontrolü
  const isModerator = await isModeratorOf(moderatorId, subredditId);
  if (!isModerator && req.user.role !== 'admin') {
    return next(new ErrorResponse('Bu işlem için moderatör yetkisi gerekiyor', 403));
  }

  // Flair ID verilmişse kontrol et
  let flair = null;
  if (flairId) {
    flair = await Flair.findById(flairId);
    if (!flair) {
      return next(new ErrorResponse('Flair bulunamadı', 404));
    }

    // Flair uygun türde mi ve doğru subreddit'e ait mi kontrol et
    if (flair.type !== 'user' || flair.subreddit.toString() !== subredditId) {
      return next(new ErrorResponse('Bu flair bu kullanıcıya atanamaz', 400));
    }
  }

  // Üyeliği güncelle
  const updateData = {};

  if (flairId) {
    updateData.userFlair = flairId;
  } else {
    updateData.userFlair = null;
  }

  if (flairText !== undefined) {
    updateData.userFlairText = flairText || null;
  }

  const updatedMembership = await SubredditMembership.findByIdAndUpdate(
    membership._id,
    updateData,
    { new: true },
  ).populate('userFlair', 'text backgroundColor textColor emoji');

  // Moderasyon logu oluştur
  await ModLog.create({
    subreddit: subredditId,
    moderator: moderatorId,
    action: 'assign_user_flair',
    targetType: 'user',
    targetId: targetUserId,
    details: flairId ? `Kullanıcıya flair atandı: "${flair.text}"` : 'Kullanıcı flairi kaldırıldı',
  });

  res.status(200).json({
    success: true,
    data: updatedMembership,
    message: flairId ? 'Flair kullanıcıya başarıyla atandı' : 'Flair kullanıcıdan kaldırıldı',
  });
});

/**
 * @desc    Bir kullanıcının kendi flairini ayarlaması
 * @route   PUT /api/subreddits/:subredditId/my-flair
 * @access  Private
 */
const setMyFlair = asyncHandler(async (req, res, next) => {
  const { subredditId } = req.params;
  const { flairId, flairText } = req.body;
  const userId = req.user._id;

  // ID formatı kontrolü
  if (!mongoose.Types.ObjectId.isValid(subredditId)) {
    return next(new ErrorResponse('Geçersiz subreddit ID formatı', 400));
  }

  if (flairId && !mongoose.Types.ObjectId.isValid(flairId)) {
    return next(new ErrorResponse('Geçersiz flair ID formatı', 400));
  }

  // Subreddit kontrolü
  const subreddit = await Subreddit.findById(subredditId);
  if (!subreddit) {
    return next(new ErrorResponse('Subreddit bulunamadı', 404));
  }

  // Kullanıcının subreddit üyeliğini kontrol et
  const membership = await SubredditMembership.findOne({
    user: userId,
    subreddit: subredditId,
  });

  if (!membership) {
    return next(new ErrorResponse("Bu subreddit'e üye değilsiniz", 400));
  }

  // Flair ID verilmişse kontrol et
  let flair = null;
  if (flairId) {
    flair = await Flair.findById(flairId);
    if (!flair) {
      return next(new ErrorResponse('Flair bulunamadı', 404));
    }

    // Flair uygun türde mi ve doğru subreddit'e ait mi kontrol et
    if (flair.type !== 'user' || flair.subreddit.toString() !== subredditId) {
      return next(new ErrorResponse('Bu flair bu subreddit için geçerli değil', 400));
    }

    // Kullanıcının bu flairi seçme yetkisi var mı kontrol et
    if (!flair.allowUserEditable) {
      const isModerator = await isModeratorOf(userId, subredditId);
      if (!isModerator && req.user.role !== 'admin') {
        return next(new ErrorResponse('Bu flair sadece moderatörler tarafından atanabilir', 403));
      }
    }
  }

  // Üyeliği güncelle
  const updateData = {};

  if (flairId) {
    updateData.userFlair = flairId;
  } else {
    updateData.userFlair = null;
  }

  if (flairText !== undefined) {
    updateData.userFlairText = flairText || null;
  }

  const updatedMembership = await SubredditMembership.findByIdAndUpdate(
    membership._id,
    updateData,
    { new: true },
  ).populate('userFlair', 'text backgroundColor textColor emoji');

  res.status(200).json({
    success: true,
    data: updatedMembership,
    message: flairId ? 'Flair başarıyla ayarlandı' : 'Flair kaldırıldı',
  });
});

/**
 * @desc    Flair istatistiklerini getir
 * @route   GET /api/subreddits/:subredditId/flairs/stats
 * @access  Private (Moderatör)
 */
const getFlairStats = asyncHandler(async (req, res, next) => {
  const { subredditId } = req.params;
  const userId = req.user._id;

  // ID formatı kontrolü
  if (!mongoose.Types.ObjectId.isValid(subredditId)) {
    return next(new ErrorResponse('Geçersiz subreddit ID formatı', 400));
  }

  // Subreddit kontrolü
  const subreddit = await Subreddit.findById(subredditId);
  if (!subreddit) {
    return next(new ErrorResponse('Subreddit bulunamadı', 404));
  }

  // Moderatör yetkisi kontrolü
  const isModerator = await isModeratorOf(userId, subredditId);
  if (!isModerator && req.user.role !== 'admin') {
    return next(new ErrorResponse('Bu işlem için moderatör yetkisi gerekiyor', 403));
  }

  // Post flairlerini getir
  const postFlairs = await Flair.find({
    subreddit: subredditId,
    type: 'post',
  });

  // User flairlerini getir
  const userFlairs = await Flair.find({
    subreddit: subredditId,
    type: 'user',
  });

  // Her flair için kullanım sayısını hesapla
  const postFlairStats = await Promise.all(
    postFlairs.map(async (flair) => {
      const count = await Post.countDocuments({
        subreddit: subredditId,
        flair: flair._id,
        isDeleted: false,
      });

      return {
        _id: flair._id,
        text: flair.text,
        backgroundColor: flair.backgroundColor,
        textColor: flair.textColor,
        emoji: flair.emoji,
        count,
      };
    }),
  );

  const userFlairStats = await Promise.all(
    userFlairs.map(async (flair) => {
      const count = await SubredditMembership.countDocuments({
        subreddit: subredditId,
        userFlair: flair._id,
      });

      return {
        _id: flair._id,
        text: flair.text,
        backgroundColor: flair.backgroundColor,
        textColor: flair.textColor,
        emoji: flair.emoji,
        count,
      };
    }),
  );

  res.status(200).json({
    success: true,
    data: {
      postFlairs: postFlairStats,
      userFlairs: userFlairStats,
      totalPostFlairs: postFlairs.length,
      totalUserFlairs: userFlairs.length,
    },
  });
});

module.exports = {
  getFlairs,
  getFlair,
  createFlair,
  updateFlair,
  deleteFlair,
  reorderFlairs,
  assignFlairToPost,
  assignFlairToUser,
  setMyFlair,
  getFlairStats,
};
