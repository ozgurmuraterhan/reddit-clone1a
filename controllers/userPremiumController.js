const User = require('../models/User');
const UserPremium = require('../models/UserPremium');
const Transaction = require('../models/Transaction');
const asyncHandler = require('../middleware/async');
const ErrorResponse = require('../utils/errorResponse');
const mongoose = require('mongoose');

/**
 * @desc    Kullanıcının premium durumunu getir
 * @route   GET /api/users/premium/status
 * @access  Private
 */
const getPremiumStatus = asyncHandler(async (req, res, next) => {
  const userId = req.user.id;

  // Aktif premium aboneliği bul
  const premium = await UserPremium.findOne({
    user: userId,
    isActive: true,
    endDate: { $gt: new Date() },
  }).sort({ endDate: -1 });

  if (!premium) {
    return res.status(200).json({
      success: true,
      data: {
        isPremium: false,
        message: 'Bu kullanıcı için aktif premium abonelik bulunmamaktadır.',
      },
    });
  }

  // Kalan süreyi hesapla
  const remainingDays = Math.ceil((new Date(premium.endDate) - new Date()) / (1000 * 60 * 60 * 24));

  res.status(200).json({
    success: true,
    data: {
      isPremium: true,
      premiumDetails: {
        id: premium._id,
        startDate: premium.startDate,
        endDate: premium.endDate,
        source: premium.source,
        remainingDays,
      },
    },
  });
});

/**
 * @desc    Premium satın al
 * @route   POST /api/users/premium/purchase
 * @access  Private
 */
const purchasePremium = asyncHandler(async (req, res, next) => {
  const userId = req.user.id;
  const { duration, paymentMethod, paymentReference } = req.body;

  if (!duration || !paymentMethod || !paymentReference) {
    return next(new ErrorResponse('Süre, ödeme yöntemi ve ödeme referansı gereklidir', 400));
  }

  // Geçerli süre seçenekleri
  const validDurations = {
    monthly: { months: 1, price: 5.99, coins: 700 },
    quarterly: { months: 3, price: 14.99, coins: 2100 },
    yearly: { months: 12, price: 49.99, coins: 8400 },
  };

  if (!validDurations[duration]) {
    return next(new ErrorResponse('Geçersiz abonelik süresi', 400));
  }

  const selectedPlan = validDurations[duration];

  // Transaction başlat
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Ödeme işlemini kaydet
    const transaction = new Transaction({
      user: userId,
      type: 'premium_purchase',
      amount: selectedPlan.price,
      currency: 'USD',
      description: `Reddit Premium ${duration} aboneliği`,
      status: 'completed',
      paymentMethod,
      paymentReference,
      metadata: {
        duration,
        planDetails: selectedPlan,
      },
      createdAt: new Date(),
    });

    await transaction.save({ session });

    // Premium bitiş tarihini hesapla
    const now = new Date();
    const endDate = new Date();
    endDate.setMonth(endDate.getMonth() + selectedPlan.months);

    // Mevcut aktif aboneliği bul
    const existingPremium = await UserPremium.findOne({
      user: userId,
      isActive: true,
      endDate: { $gt: now },
    }).sort({ endDate: -1 });

    let premium;

    if (existingPremium) {
      // Var olan aboneliği uzat
      const newEndDate = new Date(existingPremium.endDate);
      newEndDate.setMonth(newEndDate.getMonth() + selectedPlan.months);

      existingPremium.endDate = newEndDate;
      existingPremium.isActive = true;
      premium = await existingPremium.save({ session });
    } else {
      // Yeni abonelik oluştur
      premium = new UserPremium({
        user: userId,
        startDate: now,
        endDate: endDate,
        source: 'purchase',
        sourceReference: transaction._id.toString(),
        isActive: true,
      });

      await premium.save({ session });
    }

    // Coin ekle
    const user = await User.findById(userId);
    if (!user) {
      throw new Error('Kullanıcı bulunamadı');
    }

    // User modelinde coins field'i yoksa bir önceki işlemde eklenmesi gerekir
    // Bu örnekte, User modelinde coins field'inin olduğunu varsayıyoruz
    user.coins = (user.coins || 0) + selectedPlan.coins;
    await user.save({ session });

    // Coin işlemini kaydet
    const coinTransaction = new Transaction({
      user: userId,
      type: 'purchase',
      amount: selectedPlan.coins,
      currency: 'coins',
      description: `Premium ${duration} aboneliği ile ${selectedPlan.coins} coin`,
      status: 'completed',
      paymentMethod: 'other',
      relatedTransaction: transaction._id,
      createdAt: new Date(),
    });

    await coinTransaction.save({ session });

    // İşlemi tamamla
    await session.commitTransaction();

    res.status(200).json({
      success: true,
      data: {
        premium,
        transaction: {
          id: transaction._id,
          amount: transaction.amount,
          currency: transaction.currency,
          status: transaction.status,
        },
        coinsAdded: selectedPlan.coins,
        message: `Reddit Premium başarıyla satın alındı. Aboneliğiniz ${premium.endDate.toLocaleDateString()} tarihine kadar geçerlidir.`,
      },
    });
  } catch (error) {
    await session.abortTransaction();
    return next(new ErrorResponse('Premium satın alma işlemi sırasında bir hata oluştu', 500));
  } finally {
    session.endSession();
  }
});

/**
 * @desc    Premium aboneliği iptal et
 * @route   POST /api/users/premium/cancel
 * @access  Private
 */
const cancelPremium = asyncHandler(async (req, res, next) => {
  const userId = req.user.id;

  // Aktif premium aboneliği bul
  const premium = await UserPremium.findOne({
    user: userId,
    isActive: true,
    endDate: { $gt: new Date() },
    source: 'purchase', // Sadece satın alınan abonelikler iptal edilebilir
  });

  if (!premium) {
    return next(new ErrorResponse('İptal edilebilecek aktif bir premium abonelik bulunamadı', 404));
  }

  // Aboneliği iptal et (bitiş tarihine kadar devam eder)
  premium.isActive = false;
  await premium.save();

  // İptal işlemini kaydet
  const transaction = await Transaction.create({
    user: userId,
    type: 'other',
    amount: 0,
    currency: 'USD',
    description: 'Reddit Premium aboneliği iptal edildi',
    status: 'completed',
    paymentMethod: 'other',
    relatedPremium: premium._id,
  });

  res.status(200).json({
    success: true,
    data: {
      message: `Premium aboneliğiniz iptal edildi. Aboneliğiniz ${premium.endDate.toLocaleDateString()} tarihine kadar aktif kalacaktır.`,
      endDate: premium.endDate,
    },
  });
});

/**
 * @desc    Premium abonelik geçmişini getir
 * @route   GET /api/users/premium/history
 * @access  Private
 */
const getPremiumHistory = asyncHandler(async (req, res, next) => {
  const userId = req.user.id;

  // Pagination
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 10;
  const startIndex = (page - 1) * limit;
  const endIndex = page * limit;

  // Kullanıcının tüm premium aboneliklerini getir
  const premiumCount = await UserPremium.countDocuments({ user: userId });

  const premiums = await UserPremium.find({ user: userId })
    .sort({ startDate: -1 })
    .skip(startIndex)
    .limit(limit);

  // İlgili işlemleri getir
  const premiumIds = premiums.map((p) => p._id);
  const transactions = await Transaction.find({
    $or: [
      { relatedPremium: { $in: premiumIds } },
      {
        user: userId,
        type: { $in: ['premium_purchase', 'premium_gift'] },
      },
    ],
  }).sort({ createdAt: -1 });

  // Pagination meta verisi
  const pagination = {};

  if (endIndex < premiumCount) {
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

  pagination.totalPages = Math.ceil(premiumCount / limit);

  res.status(200).json({
    success: true,
    count: premiums.length,
    pagination,
    data: {
      premiums: premiums.map((premium) => ({
        id: premium._id,
        startDate: premium.startDate,
        endDate: premium.endDate,
        source: premium.source,
        isActive: premium.isActive,
        isCurrent: premium.isCurrent,
        transactions: transactions
          .filter((t) => t.relatedPremium && t.relatedPremium.toString() === premium._id.toString())
          .map((t) => ({
            id: t._id,
            type: t.type,
            amount: t.amount,
            currency: t.currency,
            description: t.description,
            status: t.status,
            createdAt: t.createdAt,
          })),
      })),
    },
  });
});

/**
 * @desc    Premium abonelik hediye et
 * @route   POST /api/users/premium/gift
 * @access  Private
 */
const giftPremium = asyncHandler(async (req, res, next) => {
  const senderId = req.user.id;
  const { recipientUsername, duration, message } = req.body;

  if (!recipientUsername || !duration) {
    return next(new ErrorResponse('Alıcı kullanıcı adı ve süre gereklidir', 400));
  }

  // Geçerli süre seçenekleri
  const validDurations = {
    monthly: { months: 1, coins: 1800 },
    quarterly: { months: 3, coins: 4500 },
    yearly: { months: 12, coins: 18000 },
  };

  if (!validDurations[duration]) {
    return next(new ErrorResponse('Geçersiz abonelik süresi', 400));
  }

  const selectedPlan = validDurations[duration];

  // Alıcı kullanıcıyı bul
  const recipient = await User.findOne({ username: recipientUsername });

  if (!recipient) {
    return next(new ErrorResponse('Belirtilen kullanıcı bulunamadı', 404));
  }

  if (recipient._id.toString() === senderId) {
    return next(new ErrorResponse('Kendinize premium hediye edemezsiniz', 400));
  }

  // Gönderenin yeterli coin'i var mı kontrol et
  const sender = await User.findById(senderId);

  if (!sender.coins || sender.coins < selectedPlan.coins) {
    return next(
      new ErrorResponse(
        `Bu hediye için yeterli coininiz bulunmamaktadır. Gereken: ${selectedPlan.coins} coin`,
        400,
      ),
    );
  }

  // Transaction başlat
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Gönderenin coinlerini düş
    sender.coins -= selectedPlan.coins;
    await sender.save({ session });

    // Coin işlemini kaydet
    const coinTransaction = new Transaction({
      user: senderId,
      type: 'award_given',
      amount: -selectedPlan.coins,
      currency: 'coins',
      description: `${recipient.username} kullanıcısına ${duration} Premium hediyesi`,
      status: 'completed',
      paymentMethod: 'coins',
      createdAt: new Date(),
    });

    await coinTransaction.save({ session });

    // Premium bitiş tarihini hesapla
    const now = new Date();
    const endDate = new Date();
    endDate.setMonth(endDate.getMonth() + selectedPlan.months);

    // Alıcının mevcut aktif aboneliğini bul
    const existingPremium = await UserPremium.findOne({
      user: recipient._id,
      isActive: true,
      endDate: { $gt: now },
    }).sort({ endDate: -1 });

    let premium;

    if (existingPremium) {
      // Var olan aboneliği uzat
      const newEndDate = new Date(existingPremium.endDate);
      newEndDate.setMonth(newEndDate.getMonth() + selectedPlan.months);

      existingPremium.endDate = newEndDate;
      premium = await existingPremium.save({ session });
    } else {
      // Yeni abonelik oluştur
      premium = new UserPremium({
        user: recipient._id,
        startDate: now,
        endDate: endDate,
        source: 'gift',
        sourceReference: coinTransaction._id.toString(),
        isActive: true,
      });

      await premium.save({ session });
    }

    // Hediye işlemini kaydet
    const giftTransaction = new Transaction({
      user: recipient._id,
      type: 'premium_gift',
      amount: selectedPlan.coins,
      currency: 'coins',
      description: `${sender.username} kullanıcısından ${duration} Premium hediyesi`,
      status: 'completed',
      paymentMethod: 'coins',
      relatedTransaction: coinTransaction._id,
      relatedPremium: premium._id,
      metadata: {
        sender: senderId,
        senderUsername: sender.username,
        message: message || '',
        duration,
      },
      createdAt: new Date(),
    });

    await giftTransaction.save({ session });

    // Gönderene karma ver (awarder karma)
    sender.karma.awarder += 5;
    await sender.save({ session });

    // Alıcıya karma ver (awardee karma)
    recipient.karma.awardee += 5;
    await recipient.save({ session });

    // İşlemi tamamla
    await session.commitTransaction();

    // Bildirim gönder (bildirim sistemi varsa)
    try {
      if (mongoose.model('Notification')) {
        await mongoose.model('Notification').create({
          recipient: recipient._id,
          type: 'premium_gift',
          sender: senderId,
          message: `${sender.username} size ${duration} Premium hediye etti!`,
          data: {
            premiumId: premium._id,
            duration,
            message: message || '',
          },
          isRead: false,
          createdAt: new Date(),
        });
      }
    } catch (error) {
      console.error('Bildirim gönderme hatası:', error);
    }

    res.status(200).json({
      success: true,
      data: {
        recipient: {
          username: recipient.username,
          id: recipient._id,
        },
        premium: {
          id: premium._id,
          duration,
          endDate: premium.endDate,
        },
        coinsSpent: selectedPlan.coins,
        message: `${recipient.username} kullanıcısına başarıyla ${duration} Premium hediye edildi.`,
      },
    });
  } catch (error) {
    await session.abortTransaction();
    return next(new ErrorResponse('Premium hediye etme işlemi sırasında bir hata oluştu', 500));
  } finally {
    session.endSession();
  }
});

/**
 * @desc    Premium avantajlarını listele
 * @route   GET /api/users/premium/benefits
 * @access  Public
 */
const getPremiumBenefits = asyncHandler(async (req, res, next) => {
  // Premium avantajlarını statik olarak döndür
  const benefits = [
    {
      id: 'no_ads',
      title: 'Reklamsız Deneyim',
      description: 'Platformda gezinirken hiçbir reklam görmezsiniz.',
      icon: 'ad-free.png',
    },
    {
      id: 'custom_avatar',
      title: 'Özel Avatar Ekstraları',
      description: 'Premium kullanıcılara özel avatar ekstraları ve özelleştirme seçenekleri.',
      icon: 'avatar.png',
    },
    {
      id: 'premium_awards',
      title: 'Premium Ödüller',
      description: 'Yalnızca premium kullanıcıların verebileceği özel ödüller.',
      icon: 'awards.png',
    },
    {
      id: 'coins_monthly',
      title: 'Aylık Coin',
      description:
        'Her ay 700 coin hediye (aylık abonelikte), çeyrek dönemde 2100, yıllık abonelikte 8400 coin.',
      icon: 'coins.png',
    },
    {
      id: 'premium_lounge',
      title: 'r/lounge Erişimi',
      description: 'Yalnızca premium kullanıcıların erişebildiği özel bir subreddit.',
      icon: 'lounge.png',
    },
    {
      id: 'username_highlighting',
      title: 'Kullanıcı Adı Vurgusu',
      description: 'Yorumlarda kullanıcı adınız özel renk ile vurgulanır.',
      icon: 'highlight.png',
    },
    {
      id: 'comment_highlighting',
      title: 'Yeni Yorum Vurgusu',
      description:
        'Daha önce ziyaret ettiğiniz bir gönderiye döndüğünüzde yeni yorumlar vurgulanır.',
      icon: 'new-comments.png',
    },
    {
      id: 'profile_trophy',
      title: 'Profil Kupası',
      description: 'Profilinizde premium üyeliğinizi gösteren özel bir kupa.',
      icon: 'trophy.png',
    },
  ];

  // Premium planlarını ve fiyatları
  const plans = [
    {
      id: 'monthly',
      name: 'Aylık',
      price: 5.99,
      currency: 'USD',
      coins: 700,
      discount: 0,
    },
    {
      id: 'quarterly',
      name: '3 Aylık',
      price: 14.99,
      currency: 'USD',
      coins: 2100,
      discount: 17,
    },
    {
      id: 'yearly',
      name: 'Yıllık',
      price: 49.99,
      currency: 'USD',
      coins: 8400,
      discount: 30,
    },
  ];

  res.status(200).json({
    success: true,
    data: {
      benefits,
      plans,
    },
  });
});

/**
 * @desc    Admin: Premium durumunu güncelle
 * @route   PUT /api/admin/users/:userId/premium
 * @access  Private/Admin
 */
const adminUpdatePremiumStatus = asyncHandler(async (req, res, next) => {
  const { userId } = req.params;
  const { action, duration, reason } = req.body;

  if (!['grant', 'revoke', 'extend'].includes(action)) {
    return next(new ErrorResponse('Geçersiz işlem. grant, revoke veya extend olmalıdır', 400));
  }

  // Kullanıcıyı kontrol et
  const user = await User.findById(userId);
  if (!user) {
    return next(new ErrorResponse('Kullanıcı bulunamadı', 404));
  }

  // Transaction başlat
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    let premium;
    const now = new Date();

    if (action === 'grant' || action === 'extend') {
      if (!duration) {
        return next(new ErrorResponse('Süre belirtilmelidir', 400));
      }

      // Süreyi ay cinsinden analiz et
      let months = 0;
      if (duration === 'monthly') months = 1;
      else if (duration === 'quarterly') months = 3;
      else if (duration === 'yearly') months = 12;
      else months = parseInt(duration, 10);

      if (isNaN(months) || months <= 0) {
        return next(new ErrorResponse('Geçersiz süre', 400));
      }

      // Mevcut aktif aboneliği kontrol et
      const existingPremium = await UserPremium.findOne({
        user: userId,
        isActive: true,
        endDate: { $gt: now },
      }).sort({ endDate: -1 });

      const endDate = new Date();

      if (action === 'grant' && existingPremium) {
        return next(new ErrorResponse('Kullanıcının zaten aktif bir premium aboneliği var', 400));
      }

      if (action === 'extend' && !existingPremium) {
        return next(new ErrorResponse('Uzatılacak aktif bir premium abonelik bulunamadı', 404));
      }

      if (existingPremium && action === 'extend') {
        // Mevcut aboneliği uzat
        const newEndDate = new Date(existingPremium.endDate);
        newEndDate.setMonth(newEndDate.getMonth() + months);

        existingPremium.endDate = newEndDate;
        premium = await existingPremium.save({ session });
      } else {
        // Yeni abonelik oluştur
        endDate.setMonth(endDate.getMonth() + months);

        premium = new UserPremium({
          user: userId,
          startDate: now,
          endDate: endDate,
          source: 'promotion',
          sourceReference: `admin_action_${req.user.id}`,
          isActive: true,
        });

        await premium.save({ session });
      }

      // İşlemi kaydet
      await Transaction.create(
        {
          user: userId,
          type: 'premium_purchase',
          amount: 0,
          currency: 'USD',
          description: `Admin tarafından ${months} ay Premium ${action === 'grant' ? 'tanımlandı' : 'uzatıldı'}: ${reason || 'Belirtilmedi'}`,
          status: 'completed',
          paymentMethod: 'other',
          relatedPremium: premium._id,
          metadata: {
            adminId: req.user.id,
            adminUsername: req.user.username,
            action,
            reason: reason || '',
            duration: `${months} ay`,
          },
        },
        { session },
      );
    } else if (action === 'revoke') {
      // Aktif premium aboneliği bul
      premium = await UserPremium.findOne({
        user: userId,
        isActive: true,
        endDate: { $gt: now },
      });

      if (!premium) {
        return next(new ErrorResponse('İptal edilecek aktif bir premium abonelik bulunamadı', 404));
      }

      // Aboneliği iptal et
      premium.isActive = false;
      await premium.save({ session });

      // İşlemi kaydet
      await Transaction.create(
        {
          user: userId,
          type: 'other',
          amount: 0,
          currency: 'USD',
          description: `Admin tarafından Premium iptal edildi: ${reason || 'Belirtilmedi'}`,
          status: 'completed',
          paymentMethod: 'other',
          relatedPremium: premium._id,
          metadata: {
            adminId: req.user.id,
            adminUsername: req.user.username,
            action: 'revoke',
            reason: reason || '',
          },
        },
        { session },
      );
    }

    // İşlemi tamamla
    await session.commitTransaction();

    res.status(200).json({
      success: true,
      data: {
        premium,
        message: `Kullanıcının premium durumu başarıyla ${
          action === 'grant' ? 'tanımlandı' : action === 'extend' ? 'uzatıldı' : 'iptal edildi'
        }.`,
      },
    });
  } catch (error) {
    await session.abortTransaction();
    return next(new ErrorResponse('Premium durumu güncellenirken bir hata oluştu', 500));
  } finally {
    session.endSession();
  }
});

/**
 * @desc    İade işlemi
 * @route   POST /api/admin/premium/refund
 * @access  Private/Admin
 */
const processPremiumRefund = asyncHandler(async (req, res, next) => {
  const { transactionId, reason } = req.body;

  if (!transactionId) {
    return next(new ErrorResponse("İşlem ID'si gereklidir", 400));
  }

  // İşlemi bul
  const transaction = await Transaction.findById(transactionId);

  if (!transaction) {
    return next(new ErrorResponse('İşlem bulunamadı', 404));
  }

  if (transaction.type !== 'premium_purchase' || transaction.status !== 'completed') {
    return next(new ErrorResponse('Bu işlem iade edilemez', 400));
  }

  // Daha önce iade edilmiş mi kontrol et
  const existingRefund = await Transaction.findOne({
    type: 'refund',
    relatedTransaction: transactionId,
  });

  if (existingRefund) {
    return next(new ErrorResponse('Bu işlem zaten iade edilmiş', 400));
  }

  // İlgili premium aboneliği bul
  const premium = await UserPremium.findOne({
    $or: [{ sourceReference: transactionId.toString() }, { _id: transaction.relatedPremium }],
  });

  if (!premium) {
    return next(new ErrorResponse('İlgili premium abonelik bulunamadı', 404));
  }

  // Kullanıcıyı bul
  const user = await User.findById(transaction.user);

  if (!user) {
    return next(new ErrorResponse('Kullanıcı bulunamadı', 404));
  }

  // Transaction başlat
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Aboneliği iptal et
    premium.isActive = false;
    await premium.save({ session });

    // İade işlemini kaydet
    const refundTransaction = new Transaction({
      user: transaction.user,
      type: 'refund',
      amount: transaction.amount,
      currency: transaction.currency,
      description: `Premium abonelik iadesi: ${reason || 'Müşteri talebi'}`,
      status: 'completed',
      paymentMethod: transaction.paymentMethod,
      paymentReference: `refund_${transaction.paymentReference}`,
      relatedTransaction: transaction._id,
      relatedPremium: premium._id,
      metadata: {
        adminId: req.user.id,
        adminUsername: req.user.username,
        reason: reason || 'Müşteri talebi',
        originalTransactionAmount: transaction.amount,
        originalTransactionDate: transaction.createdAt,
      },
    });

    await refundTransaction.save({ session });

    // Premium ile verilen coinleri geri al (eğer hala kullanıcıda bu miktar varsa)
    if (
      transaction.metadata &&
      transaction.metadata.planDetails &&
      transaction.metadata.planDetails.coins
    ) {
      const coinsToDeduct = transaction.metadata.planDetails.coins;

      if (user.coins >= coinsToDeduct) {
        user.coins -= coinsToDeduct;
        await user.save({ session });

        // Coin iade işlemini kaydet
        await Transaction.create(
          {
            user: transaction.user,
            type: 'refund',
            amount: -coinsToDeduct,
            currency: 'coins',
            description: 'Premium abonelik iadesiyle birlikte coinlerin iadesi',
            status: 'completed',
            paymentMethod: 'other',
            relatedTransaction: refundTransaction._id,
            metadata: {
              adminId: req.user.id,
              adminUsername: req.user.username,
              reason: 'Premium iadesiyle ilişkili coin iadesi',
            },
          },
          { session },
        );
      }
    }

    // İşlemi tamamla
    await session.commitTransaction();

    res.status(200).json({
      success: true,
      data: {
        refundTransaction,
        premium,
        message: 'Premium abonelik iadesi başarıyla gerçekleştirildi.',
      },
    });
  } catch (error) {
    await session.abortTransaction();
    return next(new ErrorResponse('İade işlemi sırasında bir hata oluştu', 500));
  } finally {
    session.endSession();
  }
});

/**
 * @desc    Premium kullanıcıları listele (admin)
 * @route   GET /api/admin/premium/users
 * @access  Private/Admin
 */
const listPremiumUsers = asyncHandler(async (req, res, next) => {
  // Pagination
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 25;
  const startIndex = (page - 1) * limit;
  const endIndex = page * limit;

  // Filtreleme ve arama
  const { status, source, search } = req.query;

  let query = {};

  // Aktif/pasif duruma göre filtrele
  if (status === 'active') {
    query.isActive = true;
    query.endDate = { $gt: new Date() };
  } else if (status === 'inactive') {
    query.$or = [{ isActive: false }, { endDate: { $lte: new Date() } }];
  }

  // Kaynağa göre filtrele
  if (source && ['purchase', 'award', 'gift', 'promotion'].includes(source)) {
    query.source = source;
  }

  // Kullanıcı bilgisine göre ara
  let userIds = [];
  if (search) {
    const users = await User.find({
      $or: [
        { username: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ],
    }).select('_id');

    userIds = users.map((user) => user._id);

    if (userIds.length > 0) {
      query.user = { $in: userIds };
    } else {
      // Eğer arama kriterine uyan kullanıcı yoksa boş sonuç döndür
      return res.status(200).json({
        success: true,
        count: 0,
        pagination: {
          totalPages: 0,
          totalCount: 0,
        },
        data: [],
      });
    }
  }

  // Toplam sayı
  const total = await UserPremium.countDocuments(query);

  // Sıralama
  const sortBy = req.query.sortBy || 'endDate';
  const sortDir = req.query.sortDir === 'asc' ? 1 : -1;

  const sortOptions = {};
  sortOptions[sortBy] = sortDir;

  // Sorgu
  const premiumUsers = await UserPremium.find(query)
    .populate('user', 'username email profilePicture')
    .sort(sortOptions)
    .skip(startIndex)
    .limit(limit);

  // Pagination sonuçları
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

  pagination.totalPages = Math.ceil(total / limit);
  pagination.totalCount = total;

  res.status(200).json({
    success: true,
    count: premiumUsers.length,
    pagination,
    data: premiumUsers,
  });
});

/**
 * @desc    Premium istatistiklerini getir (admin)
 * @route   GET /api/admin/premium/statistics
 * @access  Private/Admin
 */
const getPremiumStatistics = asyncHandler(async (req, res, next) => {
  const now = new Date();

  // Aktif premium kullanıcı sayısı
  const activePremiumCount = await UserPremium.countDocuments({
    isActive: true,
    endDate: { $gt: now },
  });

  // Kaynak türüne göre premium kullanıcı dağılımı
  const premiumBySource = await UserPremium.aggregate([
    {
      $match: {
        isActive: true,
        endDate: { $gt: now },
      },
    },
    {
      $group: {
        _id: '$source',
        count: { $sum: 1 },
      },
    },
    {
      $project: {
        source: '$_id',
        count: 1,
        _id: 0,
      },
    },
  ]);

  // Son 30 gündeki premium satın almaları
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const premiumTransactions = await Transaction.find({
    type: 'premium_purchase',
    status: 'completed',
    createdAt: { $gte: thirtyDaysAgo },
  }).select('amount currency createdAt');

  // Günlere göre grupla
  const transactionsByDay = {};
  const revenue = {
    USD: 0,
    EUR: 0,
    GBP: 0,
  };

  premiumTransactions.forEach((transaction) => {
    const dateStr = transaction.createdAt.toISOString().split('T')[0];

    if (!transactionsByDay[dateStr]) {
      transactionsByDay[dateStr] = {
        count: 0,
        revenue: {
          USD: 0,
          EUR: 0,
          GBP: 0,
        },
      };
    }

    transactionsByDay[dateStr].count += 1;

    if (transaction.currency in transactionsByDay[dateStr].revenue) {
      transactionsByDay[dateStr].revenue[transaction.currency] += transaction.amount;
      revenue[transaction.currency] += transaction.amount;
    }
  });

  // Son 30 günü sırala
  const last30Days = [];
  for (let i = 0; i < 30; i++) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];

    last30Days.unshift({
      date: dateStr,
      count: transactionsByDay[dateStr] ? transactionsByDay[dateStr].count : 0,
      revenue: transactionsByDay[dateStr]
        ? transactionsByDay[dateStr].revenue
        : { USD: 0, EUR: 0, GBP: 0 },
    });
  }

  // İade istatistikleri
  const refundCount = await Transaction.countDocuments({
    type: 'refund',
    createdAt: { $gte: thirtyDaysAgo },
  });

  const refundAmount = await Transaction.aggregate([
    {
      $match: {
        type: 'refund',
        createdAt: { $gte: thirtyDaysAgo },
      },
    },
    {
      $group: {
        _id: '$currency',
        total: { $sum: '$amount' },
      },
    },
  ]);

  // Abonelik sürelerine göre dağılım (aylık, 3 aylık, yıllık)
  const premiumDurations = await Transaction.aggregate([
    {
      $match: {
        type: 'premium_purchase',
        status: 'completed',
        createdAt: { $gte: thirtyDaysAgo },
      },
    },
    {
      $addFields: {
        duration: { $ifNull: ['$metadata.duration', 'unknown'] },
      },
    },
    {
      $group: {
        _id: '$duration',
        count: { $sum: 1 },
      },
    },
    {
      $project: {
        duration: '$_id',
        count: 1,
        _id: 0,
      },
    },
  ]);

  res.status(200).json({
    success: true,
    data: {
      activePremiumCount,
      premiumBySource,
      transactions: {
        last30Days,
        total: premiumTransactions.length,
        revenue,
      },
      refunds: {
        count: refundCount,
        amount: refundAmount,
      },
      premiumDurations,
    },
  });
});

module.exports = {
  getPremiumStatus,
  purchasePremium,
  cancelPremium,
  getPremiumHistory,
  giftPremium,
  getPremiumBenefits,
  adminUpdatePremiumStatus,
  processPremiumRefund,
  listPremiumUsers,
  getPremiumStatistics,
};
