const mongoose = require('mongoose');
const Award = require('../models/Award');
const AwardInstance = require('../models/AwardInstance');
const User = require('../models/User');
const Subreddit = require('../models/Subreddit');
const Transaction = require('../models/Transaction');
const Post = require('../models/Post');
const Comment = require('../models/Comment');
const UserPremium = require('../models/UserPremium');
const ErrorResponse = require('../utils/errorResponse');
const asyncHandler = require('../middleware/async');
const { isModeratorOf } = require('../utils/roleHelpers');

/**
 * @desc    Tüm ödülleri getir
 * @route   GET /api/awards
 * @route   GET /api/subreddits/:subredditId/awards
 * @access  Public
 */
const getAwards = asyncHandler(async (req, res, next) => {
  const { subredditId } = req.params;

  let query = { isActive: true };

  // Subreddit kontrolü
  if (subredditId) {
    if (!mongoose.Types.ObjectId.isValid(subredditId)) {
      return next(new ErrorResponse('Geçersiz subreddit ID formatı', 400));
    }

    const subreddit = await Subreddit.findById(subredditId);
    if (!subreddit) {
      return next(new ErrorResponse('Subreddit bulunamadı', 404));
    }

    // Subreddit'e özel ve sistem ödüllerini getir
    query = {
      isActive: true,
      $or: [{ subreddit: subredditId }, { category: 'system' }, { category: 'premium' }],
    };
  }

  // Filtreler
  if (req.query.category) {
    if (!['premium', 'community', 'moderator', 'system'].includes(req.query.category)) {
      return next(new ErrorResponse('Geçersiz kategori', 400));
    }
    query.category = req.query.category;
  }
  if (req.query.maxPrice) {
    query.coinPrice = { $lte: parseInt(req.query.maxPrice) };
  }

  // Admin ve moderatörler, admin paneli için tüm ödülleri görebilir
  if (req.query.showAll === 'true' && req.user) {
    if (req.user.role === 'admin') {
      delete query.isActive;
    } else if (subredditId) {
      // Subreddit moderatörleri sadece kendi subreddit'lerine ait ödülleri görebilir
      const isModerator = await isModeratorOf(req.user._id, subredditId);

      if (isModerator) {
        delete query.isActive;
      }
    }
  }

  // Sıralama
  let sort = {};
  if (req.query.sort) {
    if (req.query.sort === 'price-asc') {
      sort.coinPrice = 1;
    } else if (req.query.sort === 'price-desc') {
      sort.coinPrice = -1;
    } else if (req.query.sort === 'name') {
      sort.name = 1;
    } else if (req.query.sort === 'newest') {
      sort.createdAt = -1;
    }
  } else {
    // Varsayılan olarak kategoriye göre ve sonra fiyata göre sırala
    sort = { category: 1, coinPrice: 1 };
  }

  // Sayfalama
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 50;
  const startIndex = (page - 1) * limit;
  const endIndex = page * limit;

  const total = await Award.countDocuments(query);
  const awards = await Award.find(query)
    .sort(sort)
    .skip(startIndex)
    .limit(limit)
    .populate('subreddit', 'name title icon')
    .populate('createdBy', 'username');

  // Popülerlik istatistiklerini getir
  if (req.query.includeStats === 'true' && awards.length > 0) {
    const awardIds = awards.map((award) => award._id);

    const awardStats = await AwardInstance.aggregate([
      { $match: { award: { $in: awardIds } } },
      {
        $group: {
          _id: '$award',
          usageCount: { $sum: 1 },
        },
      },
    ]);

    // İstatistikleri ödül objelerine ekle
    const statsMap = {};
    awardStats.forEach((stat) => {
      statsMap[stat._id.toString()] = stat.usageCount;
    });

    awards.forEach((award) => {
      award._doc.usageCount = statsMap[award._id.toString()] || 0;
    });
  }

  // Sayfalama sonuçları
  const pagination = {};

  if (endIndex < total) {
    pagination.next = {
      page: page + 1,
      limit,
    };
  }

  if (startIndex > 0) {
    pagination.prev = {
      page: page - 1,
      limit,
    };
  }

  res.status(200).json({
    success: true,
    count: awards.length,
    pagination,
    data: awards,
  });
});

/**
 * @desc    Belirli bir ödülü getir
 * @route   GET /api/awards/:id
 * @access  Public
 */
const getAward = asyncHandler(async (req, res, next) => {
  const award = await Award.findById(req.params.id)
    .populate('subreddit', 'name title icon')
    .populate('createdBy', 'username');

  if (!award) {
    return next(new ErrorResponse('Ödül bulunamadı', 404));
  }

  // Aktif olmayan ödüller sadece admin veya moderatörler tarafından görüntülenebilir
  if (!award.isActive) {
    if (!req.user) {
      return next(new ErrorResponse('Ödül bulunamadı', 404));
    }

    if (req.user.role !== 'admin') {
      if (award.subreddit) {
        const isModerator = await isModeratorOf(req.user._id, award.subreddit);

        if (!isModerator) {
          return next(new ErrorResponse('Ödül bulunamadı', 404));
        }
      } else {
        return next(new ErrorResponse('Ödül bulunamadı', 404));
      }
    }
  }

  // İstatistikler
  if (req.query.includeStats === 'true') {
    const usageCount = await AwardInstance.countDocuments({ award: award._id });
    award._doc.usageCount = usageCount;

    // Son kullanımlar
    const recentUsage = await AwardInstance.find({ award: award._id })
      .sort({ createdAt: -1 })
      .limit(5)
      .populate('giver', 'username')
      .populate({
        path: 'targetType',
        select: 'targetPost targetComment targetUser',
        populate: {
          path: 'targetPost targetComment targetUser',
          select: 'title content username',
        },
      });

    award._doc.recentUsage = recentUsage;
  }

  res.status(200).json({
    success: true,
    data: award,
  });
});

/**
 * @desc    Yeni ödül oluştur
 * @route   POST /api/awards
 * @route   POST /api/subreddits/:subredditId/awards
 * @access  Private (Admin veya Subreddit Moderator)
 */
const createAward = asyncHandler(async (req, res, next) => {
  const { subredditId } = req.params;
  const { name, description, icon, coinPrice, category, effects, isActive } = req.body;

  // Yetki kontrolü
  if (!req.user) {
    return next(new ErrorResponse('Bu işlem için giriş yapmalısınız', 401));
  }

  // Ödül kategorisi belirleme
  let awardCategory = category;

  // Site geneli ödüller için admin olma şartı
  if (!subredditId) {
    if (req.user.role !== 'admin') {
      return next(
        new ErrorResponse('Site geneli ödül oluşturmak için admin yetkileri gereklidir', 403),
      );
    }

    // Admin değilse premium veya system kategorisinde ödül oluşturamaz
    if (['premium', 'system'].includes(awardCategory) && req.user.role !== 'admin') {
      return next(
        new ErrorResponse(
          'Bu kategori tipinde ödül oluşturmak için admin yetkileri gereklidir',
          403,
        ),
      );
    }
  } else {
    // Subreddit'e özel ödüller
    if (!mongoose.Types.ObjectId.isValid(subredditId)) {
      return next(new ErrorResponse('Geçersiz subreddit ID formatı', 400));
    }

    const subreddit = await Subreddit.findById(subredditId);
    if (!subreddit) {
      return next(new ErrorResponse('Subreddit bulunamadı', 404));
    }

    // Moderatör kontrolü
    if (req.user.role !== 'admin') {
      const isModerator = await isModeratorOf(req.user._id, subredditId);

      if (!isModerator) {
        return next(new ErrorResponse('Bu subreddit için ödül oluşturma yetkiniz yok', 403));
      }
    }

    // Subreddit ödülleri sadece community kategorisinde olabilir
    awardCategory = 'community';
  }

  // Ödül oluşturma
  const award = await Award.create({
    name,
    description,
    icon,
    coinPrice: parseInt(coinPrice),
    category: awardCategory,
    effects: {
      givesCoins: effects?.givesCoins || 0,
      givesPremium: effects?.givesPremium || false,
      premiumDurationDays: effects?.premiumDurationDays || 0,
      awardeeKarma: effects?.awardeeKarma || 0,
      awarderKarma: effects?.awarderKarma || 0,
      trophy: effects?.trophy || false,
    },
    subreddit: subredditId || null,
    createdBy: req.user._id,
    isActive: isActive !== false,
  });

  res.status(201).json({
    success: true,
    data: award,
  });
});

/**
 * @desc    Ödül güncelle
 * @route   PUT /api/awards/:id
 * @access  Private (Admin veya Subreddit Moderator)
 */
const updateAward = asyncHandler(async (req, res, next) => {
  let award = await Award.findById(req.params.id);

  if (!award) {
    return next(new ErrorResponse('Ödül bulunamadı', 404));
  }

  // Yetki kontrolü
  if (req.user.role !== 'admin') {
    // Subreddit'e özel ödül ise moderatör kontrolü
    if (award.subreddit) {
      const isModerator = await isModeratorOf(req.user._id, award.subreddit._id);

      if (!isModerator) {
        return next(new ErrorResponse('Bu ödülü güncelleme yetkiniz yok', 403));
      }
    } else {
      // Site geneli ödüller sadece admin tarafından güncellenebilir
      return next(new ErrorResponse('Bu ödülü güncelleme yetkiniz yok', 403));
    }

    // Community dışındaki kategoriler sadece admin tarafından düzenlenebilir
    if (award.category !== 'community') {
      return next(
        new ErrorResponse('Bu kategorideki ödülleri sadece adminler düzenleyebilir', 403),
      );
    }
  }

  // Güncellenecek verileri hazırla
  const updateData = {};

  // Temel özellikler
  if (req.body.name) updateData.name = req.body.name;
  if (req.body.description) updateData.description = req.body.description;
  if (req.body.icon) updateData.icon = req.body.icon;
  if (req.body.coinPrice) updateData.coinPrice = parseInt(req.body.coinPrice);
  if (req.body.isActive !== undefined) updateData.isActive = req.body.isActive;

  // Kategoriler (sadece admin değiştirebilir)
  if (req.body.category && req.user.role === 'admin') {
    if (!['premium', 'community', 'moderator', 'system'].includes(req.body.category)) {
      return next(new ErrorResponse('Geçersiz kategori', 400));
    }
    updateData.category = req.body.category;
  }

  // Ödül etkileri
  if (req.body.effects) {
    updateData.effects = {
      ...award.effects,
    };

    // Admin olmayan kullanıcılar sadece sınırlı efektleri değiştirebilir
    if (req.user.role !== 'admin') {
      // Moderatörler sadece awardeeKarma ve awarderKarma değerlerini düzenleyebilir
      if (req.body.effects.awardeeKarma !== undefined) {
        // Karma değerlerini sınırla (max 100)
        updateData.effects.awardeeKarma = Math.min(
          100,
          parseInt(req.body.effects.awardeeKarma) || 0,
        );
      }
      if (req.body.effects.awarderKarma !== undefined) {
        updateData.effects.awarderKarma = Math.min(
          100,
          parseInt(req.body.effects.awarderKarma) || 0,
        );
      }
    } else {
      // Admin tüm efektleri değiştirebilir
      if (req.body.effects.givesCoins !== undefined) {
        updateData.effects.givesCoins = parseInt(req.body.effects.givesCoins) || 0;
      }
      if (req.body.effects.givesPremium !== undefined) {
        updateData.effects.givesPremium = req.body.effects.givesPremium || false;
      }
      if (req.body.effects.premiumDurationDays !== undefined) {
        updateData.effects.premiumDurationDays =
          parseInt(req.body.effects.premiumDurationDays) || 0;
      }
      if (req.body.effects.awardeeKarma !== undefined) {
        updateData.effects.awardeeKarma = parseInt(req.body.effects.awardeeKarma) || 0;
      }
      if (req.body.effects.awarderKarma !== undefined) {
        updateData.effects.awarderKarma = parseInt(req.body.effects.awarderKarma) || 0;
      }
      if (req.body.effects.trophy !== undefined) {
        updateData.effects.trophy = req.body.effects.trophy || false;
      }
    }
  }

  // Ödülü güncelle
  award = await Award.findByIdAndUpdate(req.params.id, updateData, {
    new: true,
    runValidators: true,
  });

  res.status(200).json({
    success: true,
    data: award,
  });
});

/**
 * @desc    Ödül sil (soft delete - isActive false yapar)
 * @route   DELETE /api/awards/:id
 * @access  Private (Admin veya Subreddit Moderator)
 */
const deleteAward = asyncHandler(async (req, res, next) => {
  const award = await Award.findById(req.params.id);

  if (!award) {
    return next(new ErrorResponse('Ödül bulunamadı', 404));
  }

  // Yetki kontrolü
  if (req.user.role !== 'admin') {
    // Subreddit'e özel ödül ise moderatör kontrolü
    if (award.subreddit) {
      const isModerator = await isModeratorOf(req.user._id, award.subreddit);

      if (!isModerator) {
        return next(new ErrorResponse('Bu ödülü silme yetkiniz yok', 403));
      }
    } else {
      // Site geneli ödüller sadece admin tarafından silinebilir
      return next(new ErrorResponse('Bu ödülü silme yetkiniz yok', 403));
    }

    // Community dışındaki kategoriler sadece admin tarafından silinebilir
    if (award.category !== 'community') {
      return next(new ErrorResponse('Bu kategorideki ödülleri sadece adminler silebilir', 403));
    }
  }

  // Ödül kullanımda mı kontrol et
  const awardUsageCount = await AwardInstance.countDocuments({ award: award._id });

  if (awardUsageCount > 0 && req.query.force !== 'true') {
    // Aktif olarak kullanılan ödüller tamamen silinmez, sadece devre dışı bırakılır
    award.isActive = false;
    await award.save();

    return res.status(200).json({
      success: true,
      message: 'Bu ödül aktif olarak kullanıldığı için devre dışı bırakıldı.',
      data: award,
    });
  }

  // Ödülü sil (force parametre varsa tamamen sil)
  if (req.query.force === 'true' && req.user.role === 'admin') {
    await award.remove();

    return res.status(200).json({
      success: true,
      message: 'Ödül tamamen silindi.',
      data: {},
    });
  } else {
    // Soft delete - isActive false yap
    award.isActive = false;
    await award.save();

    return res.status(200).json({
      success: true,
      message: 'Ödül devre dışı bırakıldı.',
      data: award,
    });
  }
});

/**
 * @desc    Ödül ver (post, yorum veya kullanıcıya)
 * @route   POST /api/awards/give
 * @access  Private
 */
const giveAward = asyncHandler(async (req, res, next) => {
  const { awardId, targetType, targetId, message, isAnonymous } = req.body;

  // Gerekli alanlar kontrolü
  if (!awardId || !targetType || !targetId) {
    return next(new ErrorResponse('Ödül ID, hedef tipi ve hedef ID alanları zorunludur', 400));
  }

  // Hedef tipi kontrolü
  if (!['post', 'comment', 'user'].includes(targetType)) {
    return next(new ErrorResponse('Geçersiz hedef tipi. (post, comment veya user olmalı)', 400));
  }

  // ObjectId kontrolü
  if (!mongoose.Types.ObjectId.isValid(awardId) || !mongoose.Types.ObjectId.isValid(targetId)) {
    return next(new ErrorResponse('Geçersiz ID formatı', 400));
  }

  // Ödülü getir
  const award = await Award.findById(awardId);
  if (!award) {
    return next(new ErrorResponse('Ödül bulunamadı', 404));
  }

  // Aktif ödül kontrolü
  if (!award.isActive) {
    return next(new ErrorResponse('Bu ödül artık mevcut değil', 400));
  }

  // Hedefi doğrula
  let targetObject;
  let targetSubreddit;

  if (targetType === 'post') {
    targetObject = await Post.findById(targetId);
    if (!targetObject) {
      return next(new ErrorResponse('Gönderi bulunamadı', 404));
    }
    if (targetObject.isDeleted) {
      return next(new ErrorResponse('Silinmiş gönderiye ödül verilemez', 400));
    }
    targetSubreddit = targetObject.subreddit;
  } else if (targetType === 'comment') {
    targetObject = await Comment.findById(targetId);
    if (!targetObject) {
      return next(new ErrorResponse('Yorum bulunamadı', 404));
    }
    if (targetObject.isDeleted) {
      return next(new ErrorResponse('Silinmiş yoruma ödül verilemez', 400));
    }

    // Yorumun ait olduğu gönderiyi bul
    const post = await Post.findById(targetObject.post);
    targetSubreddit = post.subreddit;
  } else if (targetType === 'user') {
    targetObject = await User.findById(targetId);
    if (!targetObject) {
      return next(new ErrorResponse('Kullanıcı bulunamadı', 404));
    }
    if (targetObject.isDeleted || targetObject.accountStatus !== 'active') {
      return next(new ErrorResponse('Bu kullanıcıya ödül verilemez', 400));
    }
  }

  // Subreddit spesifik ödül kontrolü
  if (award.category === 'community' && award.subreddit) {
    // Eğer hedef bir kullanıcı ise, subreddit ödüllerini doğrudan veremezsiniz
    if (targetType === 'user') {
      return next(new ErrorResponse('Bu subreddit ödülü doğrudan kullanıcılara verilemez', 400));
    }

    // Hedefin ait olduğu subreddit ile ödülün subreddit'i eşleşmeli
    if (!targetSubreddit || !targetSubreddit.equals(award.subreddit)) {
      return next(
        new ErrorResponse("Bu ödül sadece ait olduğu subreddit'teki içeriklere verilebilir", 400),
      );
    }
  }

  // Kullanıcının yeterli coin'i var mı kontrol et
  const user = await User.findById(req.user._id);
  const coinBalance = user.coinBalance || 0;

  if (coinBalance < award.coinPrice) {
    return next(
      new ErrorResponse(
        `Bu ödülü vermek için yeterli coin'iniz yok. Gereken: ${award.coinPrice}, Mevcut: ${coinBalance}`,
        400,
      ),
    );
  }

  // İşlem başlat
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Kullanıcının coin bakiyesini güncelle
    await User.findByIdAndUpdate(
      req.user._id,
      { $inc: { coinBalance: -award.coinPrice } },
      { session },
    );

    // Ödül örneği oluştur
    const awardInstance = await AwardInstance.create(
      [
        {
          award: award._id,
          giver: req.user._id,
          targetType,
          targetPost: targetType === 'post' ? targetId : undefined,
          targetComment: targetType === 'comment' ? targetId : undefined,
          targetUser: targetType === 'user' ? targetId : undefined,
          message: message || undefined,
          isAnonymous: isAnonymous || false,
        },
      ],
      { session },
    );

    // İşlem kaydı oluştur
    await Transaction.create(
      [
        {
          user: req.user._id,
          type: 'award_given',
          amount: award.coinPrice,
          currency: 'coins',
          description: `${award.name} ödülü verildi`,
          status: 'completed',
          relatedAward: awardInstance[0]._id,
        },
      ],
      { session },
    );

    // Ödül efektlerini uygula

    // 1. Alıcıya coin verilecekse
    if (award.effects.givesCoins > 0) {
      let recipientId;

      if (targetType === 'user') {
        recipientId = targetId;
      } else if (targetType === 'post' || targetType === 'comment') {
        recipientId = targetObject.author;
      }

      if (recipientId) {
        await User.findByIdAndUpdate(
          recipientId,
          { $inc: { coinBalance: award.effects.givesCoins } },
          { session },
        );

        // Alıcı için işlem kaydı
        await Transaction.create(
          [
            {
              user: recipientId,
              type: 'award_received',
              amount: award.effects.givesCoins,
              currency: 'coins',
              description: `${award.name} ödülünden kazanılan coinler`,
              status: 'completed',
              relatedAward: awardInstance[0]._id,
            },
          ],
          { session },
        );
      }
    }

    // 2. Premium verilecekse
    if (award.effects.givesPremium && award.effects.premiumDurationDays > 0) {
      let recipientId;

      if (targetType === 'user') {
        recipientId = targetId;
      } else if (targetType === 'post' || targetType === 'comment') {
        recipientId = targetObject.author;
      }

      if (recipientId) {
        // Premium bitiş tarihini hesapla
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + award.effects.premiumDurationDays);

        // Premium kayıt oluştur
        await UserPremium.create(
          [
            {
              user: recipientId,
              startDate: new Date(),
              endDate,
              source: 'award',
              sourceReference: awardInstance[0]._id.toString(),
              isActive: true,
            },
          ],
          { session },
        );
      }
    }

    // 3. Karma puanları ekle
    if (award.effects.awardeeKarma > 0) {
      let recipientId;

      if (targetType === 'user') {
        recipientId = targetId;
      } else if (targetType === 'post' || targetType === 'comment') {
        recipientId = targetObject.author;
      }

      if (recipientId) {
        await User.findByIdAndUpdate(
          recipientId,
          { $inc: { 'karma.awardee': award.effects.awardeeKarma } },
          { session },
        );
      }
    }

    // 4. Veren kişiye karma puanı ekle
    if (award.effects.awarderKarma > 0) {
      await User.findByIdAndUpdate(
        req.user._id,
        { $inc: { 'karma.awarder': award.effects.awarderKarma } },
        { session },
      );
    }

    // İşlemi tamamla
    await session.commitTransaction();

    // Tam veriyi getir
    const fullAwardInstance = await AwardInstance.findById(awardInstance[0]._id)
      .populate('award', 'name icon effects')
      .populate('giver', 'username profilePicture')
      .populate({
        path: 'targetPost',
        select: 'title author',
        populate: {
          path: 'author',
          select: 'username',
        },
      })
      .populate({
        path: 'targetComment',
        select: 'content author',
        populate: {
          path: 'author',
          select: 'username',
        },
      })
      .populate('targetUser', 'username profilePicture');

    res.status(201).json({
      success: true,
      data: fullAwardInstance,
    });
  } catch (error) {
    // İşlem sırasında hata oluşursa geri al
    await session.abortTransaction();
    console.error('Ödül verme hatası:', error);
    return next(new ErrorResponse('Ödül verme işlemi sırasında bir hata oluştu', 500));
  } finally {
    // Oturumu kapat
    session.endSession();
  }
});

/**
 * @desc    Kullanıcının sahip olduğu ödülleri getir
 * @route   GET /api/awards/my-awards
 * @access  Private
 */
const getMyAwards = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.user._id);

  // Kullanıcının coin bakiyesini getir
  const coinBalance = user.coinBalance || 0;

  // Kullanıcının satın aldığı veya kazandığı ödülleri getir
  const myAwards = await AwardInstance.find({
    giver: req.user._id,
    isUsed: false, // Henüz kullanılmamış ödüller
  })
    .populate('award', 'name description icon coinPrice category effects')
    .sort({ createdAt: -1 });

  // Satın alınabilir tüm ödülleri getir (aktif olanlar)
  const availableAwards = await Award.find({
    isActive: true,
    coinPrice: { $lte: coinBalance }, // Kullanıcının alabileceği ödüller
  })
    .sort({ category: 1, coinPrice: 1 })
    .select('name description icon coinPrice category effects');

  res.status(200).json({
    success: true,
    data: {
      coinBalance,
      myAwards,
      availableAwards,
    },
  });
});

/**
 * @desc    Kullanıcının aldığı ödülleri getir
 * @route   GET /api/awards/received
 * @access  Private
 */
const getReceivedAwards = asyncHandler(async (req, res, next) => {
  // Kullanıcıya direkt verilen ödüller
  const directAwards = await AwardInstance.find({
    targetType: 'user',
    targetUser: req.user._id,
  })
    .populate('award', 'name description icon coinPrice category effects')
    .populate('giver', 'username profilePicture')
    .sort({ createdAt: -1 });

  // Kullanıcının postlarına verilen ödüller
  const userPosts = await Post.find({ author: req.user._id }).select('_id');
  const postIds = userPosts.map((post) => post._id);

  const postAwards = await AwardInstance.find({
    targetType: 'post',
    targetPost: { $in: postIds },
  })
    .populate('award', 'name description icon coinPrice category effects')
    .populate('giver', 'username profilePicture')
    .populate('targetPost', 'title')
    .sort({ createdAt: -1 });

  // Kullanıcının yorumlarına verilen ödüller
  const userComments = await Comment.find({ author: req.user._id }).select('_id');
  const commentIds = userComments.map((comment) => comment._id);

  const commentAwards = await AwardInstance.find({
    targetType: 'comment',
    targetComment: { $in: commentIds },
  })
    .populate('award', 'name description icon coinPrice category effects')
    .populate('giver', 'username profilePicture')
    .populate('targetComment', 'content')
    .populate({
      path: 'targetComment',
      populate: {
        path: 'post',
        select: 'title',
      },
    })
    .sort({ createdAt: -1 });

  res.status(200).json({
    success: true,
    counts: {
      directAwards: directAwards.length,
      postAwards: postAwards.length,
      commentAwards: commentAwards.length,
      total: directAwards.length + postAwards.length + commentAwards.length,
    },
    data: {
      directAwards,
      postAwards,
      commentAwards,
    },
  });
});

/**
 * @desc    Bir içeriğe verilen ödülleri getir
 * @route   GET /api/posts/:postId/awards
 * @route   GET /api/comments/:commentId/awards
 * @route   GET /api/users/:userId/awards
 * @access  Public
 */
const getContentAwards = asyncHandler(async (req, res, next) => {
  const { postId, commentId, userId } = req.params;

  let targetType;
  let targetId;

  if (postId) {
    targetType = 'post';
    targetId = postId;
  } else if (commentId) {
    targetType = 'comment';
    targetId = commentId;
  } else if (userId) {
    targetType = 'user';
    targetId = userId;
  } else {
    return next(new ErrorResponse('Geçerli bir hedef ID belirtilmedi', 400));
  }

  // ObjectId kontrolü
  if (!mongoose.Types.ObjectId.isValid(targetId)) {
    return next(new ErrorResponse('Geçersiz ID formatı', 400));
  }

  // Hedefe verilen ödülleri getir
  const query = {
    targetType,
    [targetType === 'post'
      ? 'targetPost'
      : targetType === 'comment'
        ? 'targetComment'
        : 'targetUser']: targetId,
  };

  const awards = await AwardInstance.find(query)
    .populate('award', 'name description icon coinPrice category effects')
    .populate('giver', 'username profilePicture')
    .sort({ createdAt: -1 });

  // Ödül özetini hazırla
  const awardSummary = {};
  awards.forEach((awardInstance) => {
    const awardId = awardInstance.award._id.toString();
    if (!awardSummary[awardId]) {
      awardSummary[awardId] = {
        award: awardInstance.award,
        count: 1,
      };
    } else {
      awardSummary[awardId].count += 1;
    }
  });

  res.status(200).json({
    success: true,
    count: awards.length,
    data: {
      awards,
      summary: Object.values(awardSummary),
    },
  });
});

/**
 * @desc    Ödül satın al (kullanıcı coin bakiyesine ekle)
 * @route   POST /api/awards/purchase
 * @access  Private
 */
const purchaseCoins = asyncHandler(async (req, res, next) => {
  const { packageId, paymentMethod, paymentDetails } = req.body;

  // Coin paketini doğrula
  const coinPackages = {
    small: { coins: 500, price: 1.99, currency: 'USD' },
    medium: { coins: 1100, price: 3.99, currency: 'USD' },
    large: { coins: 3000, price: 9.99, currency: 'USD' },
    xlarge: { coins: 7000, price: 19.99, currency: 'USD' },
    premium: { coins: 15000, price: 39.99, currency: 'USD' },
  };

  if (!packageId || !coinPackages[packageId]) {
    return next(new ErrorResponse('Geçersiz paket ID', 400));
  }

  const selectedPackage = coinPackages[packageId];

  // Ödeme yöntemi kontrolü
  if (!['credit_card', 'paypal', 'apple_pay', 'google_pay'].includes(paymentMethod)) {
    return next(new ErrorResponse('Geçersiz ödeme yöntemi', 400));
  }

  // Burada gerçek bir ödeme işlemi entegrasyonu yapılabilir (Stripe, PayPal vb.)
  // Bu örnekte başarılı ödeme varsayıyoruz

  // Örnek ödeme referansı oluştur
  const paymentReference = `PAY-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;

  // İşlem başlat
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Kullanıcı coin bakiyesini güncelle
    await User.findByIdAndUpdate(
      req.user._id,
      { $inc: { coinBalance: selectedPackage.coins } },
      { session },
    );

    // İşlem kaydı oluştur
    const transaction = await Transaction.create(
      [
        {
          user: req.user._id,
          type: 'purchase',
          amount: selectedPackage.price,
          currency: selectedPackage.currency,
          description: `${selectedPackage.coins} Reddit coin satın alındı`,
          status: 'completed',
          paymentMethod,
          paymentReference,
          metadata: { packageId, coinsReceived: selectedPackage.coins },
        },
      ],
      { session },
    );

    // İşlemi tamamla
    await session.commitTransaction();

    res.status(201).json({
      success: true,
      message: 'Coin satın alma işlemi başarılı',
      data: {
        coinsReceived: selectedPackage.coins,
        transaction: transaction[0],
      },
    });
  } catch (error) {
    // İşlem sırasında hata oluşursa geri al
    await session.abortTransaction();
    console.error('Coin satın alma hatası:', error);
    return next(new ErrorResponse('Satın alma işlemi sırasında bir hata oluştu', 500));
  } finally {
    // Oturumu kapat
    session.endSession();
  }
});

module.exports = {
  getAwards,
  getAward,
  createAward,
  updateAward,
  deleteAward,
  giveAward,
  getMyAwards,
  getReceivedAwards,
  getContentAwards,
  purchaseCoins,
};
