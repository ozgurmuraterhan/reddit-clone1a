const mongoose = require('mongoose');
const { Transaction, User, AwardInstance, UserPremium } = require('../models');
const asyncHandler = require('../middleware/async');
const ErrorResponse = require('../utils/errorResponse');

/**
 * @desc    Kullanıcının işlemlerini getir
 * @route   GET /api/transactions
 * @access  Private
 */
const getUserTransactions = asyncHandler(async (req, res, next) => {
  const userId = req.user._id;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const skip = (page - 1) * limit;
  const { type, status, sortBy = 'createdAt', order = 'desc' } = req.query;

  // Filtreleme seçenekleri
  const filter = { user: userId };

  if (
    type &&
    [
      'purchase',
      'award_given',
      'award_received',
      'premium_purchase',
      'premium_gift',
      'refund',
      'other',
    ].includes(type)
  ) {
    filter.type = type;
  }

  if (status && ['pending', 'completed', 'failed', 'refunded'].includes(status)) {
    filter.status = status;
  }

  // Sıralama ayarları
  const sortOptions = {};
  if (['createdAt', 'amount', 'updatedAt'].includes(sortBy)) {
    sortOptions[sortBy] = order === 'asc' ? 1 : -1;
  } else {
    sortOptions.createdAt = -1;
  }

  // İşlemleri getir
  const transactions = await Transaction.find(filter)
    .sort(sortOptions)
    .skip(skip)
    .limit(limit)
    .populate('relatedAward', 'awardType recipientType')
    .populate('relatedPremium', 'tier duration startDate endDate')
    .populate('relatedTransaction', 'type amount status');

  const total = await Transaction.countDocuments(filter);

  res.status(200).json({
    success: true,
    count: transactions.length,
    total,
    totalPages: Math.ceil(total / limit),
    currentPage: page,
    data: transactions,
  });
});

/**
 * @desc    İşlem detaylarını getir
 * @route   GET /api/transactions/:id
 * @access  Private
 */
const getTransactionById = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user._id;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorResponse('Geçersiz işlem ID formatı', 400));
  }

  const transaction = await Transaction.findById(id)
    .populate('relatedAward', 'awardType recipientType')
    .populate('relatedPremium', 'tier duration startDate endDate')
    .populate('relatedTransaction', 'type amount status');

  if (!transaction) {
    return next(new ErrorResponse('İşlem bulunamadı', 404));
  }

  // Yetki kontrolü
  if (transaction.user.toString() !== userId.toString() && req.user.role !== 'admin') {
    return next(new ErrorResponse('Bu işlemi görüntüleme yetkiniz yok', 403));
  }

  res.status(200).json({
    success: true,
    data: transaction,
  });
});

/**
 * @desc    Coin satın alma işlemi oluştur
 * @route   POST /api/transactions/purchase/coins
 * @access  Private
 */
const createCoinPurchase = asyncHandler(async (req, res, next) => {
  const { packageId, amount, paymentMethod, paymentReference } = req.body;
  const userId = req.user._id;

  // Giriş doğrulaması
  if (!packageId || !amount || amount <= 0 || !paymentMethod) {
    return next(new ErrorResponse('Lütfen gerekli tüm alanları doldurun', 400));
  }

  // Ödeme yöntemi doğrulaması
  const validPaymentMethods = ['credit_card', 'paypal', 'apple_pay', 'google_pay', 'other'];
  if (!validPaymentMethods.includes(paymentMethod)) {
    return next(new ErrorResponse('Geçersiz ödeme yöntemi', 400));
  }

  // Coin paketi bilgilerini al (gerçek uygulamada veritabanından gelir)
  const coinPackages = {
    basic: { coins: 500, price: 4.99, currency: 'USD' },
    standard: { coins: 1100, price: 9.99, currency: 'USD' },
    premium: { coins: 2400, price: 19.99, currency: 'USD' },
    ultimate: { coins: 7200, price: 49.99, currency: 'USD' },
  };

  const selectedPackage = coinPackages[packageId];
  if (!selectedPackage) {
    return next(new ErrorResponse('Geçersiz coin paketi', 400));
  }

  // Tutar doğrulaması
  if (selectedPackage.price !== amount) {
    return next(new ErrorResponse('Geçersiz ödeme tutarı', 400));
  }

  // İşlem oluştur
  const transaction = await Transaction.create({
    user: userId,
    type: 'purchase',
    amount: selectedPackage.price,
    currency: selectedPackage.currency,
    description: `${selectedPackage.coins} Coin satın alımı`,
    status: 'pending', // Başlangıçta beklemede
    paymentMethod,
    paymentReference: paymentReference || null,
    metadata: {
      packageId,
      coinAmount: selectedPackage.coins,
    },
  });

  // Ödeme entegrasyonu burada gerçekleşir
  // Bu örnek için işlemi hemen tamamlıyoruz
  transaction.status = 'completed';
  await transaction.save();

  // Kullanıcının coin bakiyesini güncelle
  const user = await User.findById(userId);
  user.coins = (user.coins || 0) + selectedPackage.coins;
  await user.save();

  res.status(201).json({
    success: true,
    data: transaction,
    coins: user.coins,
  });
});

/**
 * @desc    Premium üyelik satın alma işlemi oluştur
 * @route   POST /api/transactions/purchase/premium
 * @access  Private
 */
const createPremiumPurchase = asyncHandler(async (req, res, next) => {
  const { tier, duration, paymentMethod, paymentReference, useCoins } = req.body;
  const userId = req.user._id;

  // Giriş doğrulaması
  if (!tier || !duration || (!paymentMethod && !useCoins)) {
    return next(new ErrorResponse('Lütfen gerekli tüm alanları doldurun', 400));
  }

  // Premium paket bilgilerini al
  const premiumPlans = {
    basic: {
      1: { price: 5.99, coins: 700 },
      3: { price: 14.99, coins: 1750 },
      12: { price: 49.99, coins: 5800 },
    },
    standard: {
      1: { price: 8.99, coins: 1050 },
      3: { price: 22.99, coins: 2650 },
      12: { price: 79.99, coins: 9300 },
    },
    pro: {
      1: { price: 12.99, coins: 1500 },
      3: { price: 33.99, coins: 3950 },
      12: { price: 119.99, coins: 13900 },
    },
    ultimate: {
      1: { price: 19.99, coins: 2300 },
      3: { price: 53.99, coins: 6250 },
      12: { price: 189.99, coins: 22000 },
    },
  };

  // Plan geçerliliğini kontrol et
  if (!premiumPlans[tier] || !premiumPlans[tier][duration]) {
    return next(new ErrorResponse('Geçersiz premium paket veya süre', 400));
  }

  const selectedPlan = premiumPlans[tier][duration];
  let transactionData;

  // Kullanıcıyı al
  const user = await User.findById(userId);

  // Coin ile ödeme işlemi
  if (useCoins) {
    // Kullanıcının yeterli coini var mı kontrol et
    if (!user.coins || user.coins < selectedPlan.coins) {
      return next(new ErrorResponse('Yetersiz coin bakiyesi', 400));
    }

    // Coin işlemini oluştur
    transactionData = {
      user: userId,
      type: 'premium_purchase',
      amount: selectedPlan.coins,
      currency: 'coins',
      description: `${tier} premium üyelik (${duration} ay) - Coin ile ödeme`,
      status: 'completed',
      metadata: {
        premiumTier: tier,
        durationMonths: duration,
      },
    };

    // Kullanıcının coin bakiyesini düşür
    user.coins -= selectedPlan.coins;
    await user.save();
  }
  // Gerçek para ile ödeme işlemi
  else {
    // Ödeme yöntemi doğrulaması
    const validPaymentMethods = ['credit_card', 'paypal', 'apple_pay', 'google_pay', 'other'];
    if (!validPaymentMethods.includes(paymentMethod)) {
      return next(new ErrorResponse('Geçersiz ödeme yöntemi', 400));
    }

    transactionData = {
      user: userId,
      type: 'premium_purchase',
      amount: selectedPlan.price,
      currency: 'USD',
      description: `${tier} premium üyelik (${duration} ay)`,
      status: 'pending',
      paymentMethod,
      paymentReference: paymentReference || null,
      metadata: {
        premiumTier: tier,
        durationMonths: duration,
      },
    };

    // Ödeme entegrasyonu burada gerçekleşir
    // Bu örnek için işlemi hemen tamamlıyoruz
    transactionData.status = 'completed';
  }

  // İşlemi oluştur
  const transaction = await Transaction.create(transactionData);

  // Premium üyelik kaydı oluştur
  const startDate = new Date();
  const endDate = new Date();
  endDate.setMonth(endDate.getMonth() + parseInt(duration));

  const userPremium = await UserPremium.create({
    user: userId,
    tier,
    startDate,
    endDate,
    duration: parseInt(duration),
    active: true,
    source: useCoins ? 'coin_purchase' : 'direct_purchase',
  });

  // İşlem ve premium üyelik arasında bağlantı kur
  transaction.relatedPremium = userPremium._id;
  await transaction.save();

  // Kullanıcı premium durumunu güncelle
  user.isPremium = true;
  user.premiumTier = tier;
  user.premiumExpiry = endDate;
  await user.save();

  res.status(201).json({
    success: true,
    data: {
      transaction,
      premium: userPremium,
      userCoins: user.coins,
    },
  });
});

/**
 * @desc    Ödül verme işlemi oluştur
 * @route   POST /api/transactions/award
 * @access  Private
 */
const createAwardTransaction = asyncHandler(async (req, res, next) => {
  const { awardType, recipientId, targetType, targetId } = req.body;
  const userId = req.user._id;

  // Giriş doğrulaması
  if (!awardType || !recipientId || !targetType || !targetId) {
    return next(new ErrorResponse('Lütfen gerekli tüm alanları doldurun', 400));
  }

  if (!mongoose.Types.ObjectId.isValid(recipientId) || !mongoose.Types.ObjectId.isValid(targetId)) {
    return next(new ErrorResponse('Geçersiz ID formatı', 400));
  }

  if (!['post', 'comment'].includes(targetType)) {
    return next(new ErrorResponse('Geçersiz hedef türü', 400));
  }

  // Ödül bilgilerini al
  const awardTypes = {
    silver: { price: 100, benefits: { karma: 10, coins: 0, premium: 0 } },
    gold: { price: 500, benefits: { karma: 50, coins: 100, premium: 7 } },
    platinum: { price: 1800, benefits: { karma: 100, coins: 700, premium: 30 } },
    wholesome: { price: 150, benefits: { karma: 15, coins: 0, premium: 0 } },
    helpful: { price: 150, benefits: { karma: 15, coins: 0, premium: 0 } },
  };

  const selectedAward = awardTypes[awardType];
  if (!selectedAward) {
    return next(new ErrorResponse('Geçersiz ödül türü', 400));
  }

  // Kullanıcının coin bakiyesini kontrol et
  const user = await User.findById(userId);
  if (!user) {
    return next(new ErrorResponse('Kullanıcı bulunamadı', 404));
  }

  if (!user.coins || user.coins < selectedAward.price) {
    return next(new ErrorResponse('Yetersiz coin bakiyesi', 400));
  }

  // Alıcı kullanıcıyı kontrol et
  const recipient = await User.findById(recipientId);
  if (!recipient) {
    return next(new ErrorResponse('Alıcı kullanıcı bulunamadı', 404));
  }

  // Hedef içeriği kontrol et (post veya comment)
  let targetModel, targetContent;
  if (targetType === 'post') {
    targetModel = Post;
  } else {
    targetModel = Comment;
  }

  targetContent = await targetModel.findById(targetId);
  if (!targetContent) {
    return next(
      new ErrorResponse(`Hedef ${targetType === 'post' ? 'gönderi' : 'yorum'} bulunamadı`, 404),
    );
  }

  // Kullanıcının coin bakiyesini düşür
  user.coins -= selectedAward.price;
  await user.save();

  // Ödül örneği oluştur
  const awardInstance = await AwardInstance.create({
    awardType,
    giver: userId,
    recipient: recipientId,
    targetType,
    targetId,
    benefits: selectedAward.benefits,
  });

  // Verilen ödül için işlem oluştur
  const giverTransaction = await Transaction.create({
    user: userId,
    type: 'award_given',
    amount: -selectedAward.price,
    currency: 'coins',
    description: `${awardType} ödülü verildi`,
    status: 'completed',
    relatedAward: awardInstance._id,
    metadata: {
      recipientId,
      targetType,
      targetId,
      awardType,
    },
  });

  // Alınan ödül için işlem oluştur (coin hediyesi varsa)
  if (selectedAward.benefits.coins > 0) {
    const recipientTransaction = await Transaction.create({
      user: recipientId,
      type: 'award_received',
      amount: selectedAward.benefits.coins,
      currency: 'coins',
      description: `${awardType} ödülü alındı`,
      status: 'completed',
      relatedAward: awardInstance._id,
      relatedTransaction: giverTransaction._id,
      metadata: {
        giverId: userId,
        targetType,
        targetId,
        awardType,
      },
    });

    // Alıcının coin bakiyesini güncelle
    recipient.coins = (recipient.coins || 0) + selectedAward.benefits.coins;

    // Gönderici işlemini güncelle
    giverTransaction.relatedTransaction = recipientTransaction._id;
    await giverTransaction.save();
  }

  // Alıcının karma puanını güncelle
  if (selectedAward.benefits.karma > 0) {
    recipient.karma = (recipient.karma || 0) + selectedAward.benefits.karma;
  }

  // Premium süre eklemesi varsa
  if (selectedAward.benefits.premium > 0) {
    const premiumDays = selectedAward.benefits.premium;
    let currentExpiry = recipient.premiumExpiry || new Date();

    // Eğer zaten süresi geçmişse şimdiki tarihten başlat
    if (currentExpiry < new Date()) {
      currentExpiry = new Date();
    }

    // Premium süresini uzat
    const newExpiry = new Date(currentExpiry);
    newExpiry.setDate(newExpiry.getDate() + premiumDays);

    // Kullanıcı premium bilgilerini güncelle
    recipient.isPremium = true;
    recipient.premiumExpiry = newExpiry;

    // Premium kaydı oluştur
    const userPremium = await UserPremium.create({
      user: recipientId,
      tier: 'basic', // Ödül premium'u basic seviyesinden başlar
      startDate: new Date(),
      endDate: newExpiry,
      duration: premiumDays / 30, // Ay olarak (yaklaşık)
      active: true,
      source: 'award_gift',
    });

    // İşlem ve premium arasında bağlantı kur
    giverTransaction.relatedPremium = userPremium._id;
    await giverTransaction.save();
  }

  // Alıcı kullanıcıyı kaydet
  await recipient.save();

  // Bildirim gönder
  await Notification.create({
    type: 'award_received',
    recipient: recipientId,
    sender: userId,
    [`related${targetType.charAt(0).toUpperCase() + targetType.slice(1)}`]: targetId,
    message: `${user.username} size ${awardType} ödülü verdi`,
  });

  res.status(201).json({
    success: true,
    data: {
      awardInstance,
      transaction: giverTransaction,
      remainingCoins: user.coins,
    },
  });
});

/**
 * @desc    İade işlemi oluştur
 * @route   POST /api/transactions/refund
 * @access  Private (Admin)
 */
const processRefund = asyncHandler(async (req, res, next) => {
  const { transactionId, reason } = req.body;

  // Admin yetkisi kontrolü
  if (req.user.role !== 'admin') {
    return next(new ErrorResponse('Bu işlem için admin yetkisi gereklidir', 403));
  }

  if (!transactionId || !mongoose.Types.ObjectId.isValid(transactionId)) {
    return next(new ErrorResponse("Geçerli bir işlem ID'si giriniz", 400));
  }

  // İşlemi bul
  const transaction = await Transaction.findById(transactionId);
  if (!transaction) {
    return next(new ErrorResponse('İşlem bulunamadı', 404));
  }

  // İşlemin iade edilebilir olup olmadığını kontrol et
  if (['failed', 'refunded'].includes(transaction.status)) {
    return next(new ErrorResponse('Bu işlem zaten başarısız olmuş veya iade edilmiş', 400));
  }

  if (!['purchase', 'premium_purchase'].includes(transaction.type)) {
    return next(new ErrorResponse('Yalnızca satın alma işlemleri iade edilebilir', 400));
  }

  // İşlemin durumunu güncelle
  transaction.status = 'refunded';
  await transaction.save();

  // İade işlemi oluştur
  const refundTransaction = await Transaction.create({
    user: transaction.user,
    type: 'refund',
    amount: transaction.amount,
    currency: transaction.currency,
    description: `İade: ${transaction.description}`,
    status: 'completed',
    paymentMethod: transaction.paymentMethod,
    paymentReference: `refund_${transaction.paymentReference || transaction._id}`,
    relatedTransaction: transaction._id,
    metadata: {
      originalTransactionId: transaction._id,
      reason: reason || 'Müşteri talebi üzerine iade edildi',
    },
  });

  // Eğer premium satın alımı ise premium üyeliği iptal et
  if (transaction.type === 'premium_purchase' && transaction.relatedPremium) {
    const premium = await UserPremium.findById(transaction.relatedPremium);
    if (premium && premium.active) {
      premium.active = false;
      premium.cancelledAt = Date.now();
      premium.cancellationReason = 'Ödeme iadesi';
      await premium.save();

      // Kullanıcının premium durumunu güncelle
      const user = await User.findById(transaction.user);
      if (user) {
        // Diğer aktif premium'lar var mı kontrol et
        const hasOtherActivePremium = await UserPremium.exists({
          user: user._id,
          active: true,
          endDate: { $gt: new Date() },
        });

        if (!hasOtherActivePremium) {
          user.isPremium = false;
          user.premiumTier = null;
          user.premiumExpiry = null;
          await user.save();
        }
      }
    }
  }

  res.status(200).json({
    success: true,
    data: {
      originalTransaction: transaction,
      refundTransaction,
    },
  });
});

/**
 * @desc    İşlem durumunu güncelle
 * @route   PATCH /api/transactions/:id/status
 * @access  Private (Admin)
 */
const updateTransactionStatus = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { status, note } = req.body;

  // Admin yetkisi kontrolü
  if (req.user.role !== 'admin') {
    return next(new ErrorResponse('Bu işlem için admin yetkisi gereklidir', 403));
  }

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorResponse('Geçersiz işlem ID formatı', 400));
  }

  // Durum kontrolü
  if (!['pending', 'completed', 'failed', 'refunded'].includes(status)) {
    return next(new ErrorResponse('Geçersiz işlem durumu', 400));
  }

  // İşlemi bul
  const transaction = await Transaction.findById(id);
  if (!transaction) {
    return next(new ErrorResponse('İşlem bulunamadı', 404));
  }

  // Durum güncellemesi
  transaction.status = status;
  transaction.updatedAt = Date.now();

  // Not ekle
  if (note) {
    if (!transaction.metadata) {
      transaction.metadata = {};
    }
    transaction.metadata.statusUpdateNote = note;
    transaction.metadata.statusUpdatedBy = req.user._id;
    transaction.metadata.statusUpdatedAt = Date.now();
  }

  await transaction.save();

  // İşlem tamamlandıysa ve satın alma ise, kullanıcı bakiyesini güncelle
  if (
    status === 'completed' &&
    transaction.type === 'purchase' &&
    transaction.currency === 'coins'
  ) {
    const user = await User.findById(transaction.user);
    if (user) {
      const coinAmount =
        transaction.metadata && transaction.metadata.coinAmount
          ? parseInt(transaction.metadata.coinAmount)
          : 0;

      if (coinAmount > 0) {
        user.coins = (user.coins || 0) + coinAmount;
        await user.save();
      }
    }
  }

  res.status(200).json({
    success: true,
    data: transaction,
  });
});

/**
 * @desc    Tüm işlemleri getir (Admin)
 * @route   GET /api/transactions/admin
 * @access  Private (Admin)
 */
const getAllTransactions = asyncHandler(async (req, res, next) => {
  // Admin yetkisi kontrolü
  if (req.user.role !== 'admin') {
    return next(new ErrorResponse('Bu işlem için admin yetkisi gereklidir', 403));
  }

  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const skip = (page - 1) * limit;
  const {
    type,
    status,
    currency,
    userId,
    minAmount,
    maxAmount,
    startDate,
    endDate,
    sortBy = 'createdAt',
    order = 'desc',
  } = req.query;

  // Filtreleme seçenekleri
  const filter = {};

  if (type) {
    filter.type = type;
  }

  if (status) {
    filter.status = status;
  }

  if (currency) {
    filter.currency = currency;
  }

  if (userId && mongoose.Types.ObjectId.isValid(userId)) {
    filter.user = userId;
  }

  if (minAmount) {
    filter.amount = { ...filter.amount, $gte: parseFloat(minAmount) };
  }

  if (maxAmount) {
    filter.amount = { ...filter.amount, $lte: parseFloat(maxAmount) };
  }

  // Tarih filtreleri
  if (startDate) {
    filter.createdAt = { ...filter.createdAt, $gte: new Date(startDate) };
  }

  if (endDate) {
    filter.createdAt = { ...filter.createdAt, $lte: new Date(endDate) };
  }

  // Sıralama ayarları
  const sortOptions = {};
  if (['createdAt', 'amount', 'updatedAt'].includes(sortBy)) {
    sortOptions[sortBy] = order === 'asc' ? 1 : -1;
  } else {
    sortOptions.createdAt = -1;
  }

  // İşlemleri getir
  const transactions = await Transaction.find(filter)
    .sort(sortOptions)
    .skip(skip)
    .limit(limit)
    .populate('user', 'username email')
    .populate('relatedAward', 'awardType recipientType')
    .populate('relatedPremium', 'tier duration startDate endDate')
    .populate('relatedTransaction', 'type amount status');

  const total = await Transaction.countDocuments(filter);

  res.status(200).json({
    success: true,
    count: transactions.length,
    total,
    totalPages: Math.ceil(total / limit),
    currentPage: page,
    data: transactions,
  });
});

/**
 * @desc    İşlem istatistiklerini getir (Admin)
 * @route   GET /api/transactions/stats
 * @access  Private (Admin)
 */
const getTransactionStats = asyncHandler(async (req, res, next) => {
  // Admin yetkisi kontrolü
  if (req.user.role !== 'admin') {
    return next(new ErrorResponse('Bu işlem için admin yetkisi gereklidir', 403));
  }

  const { startDate, endDate, groupBy = 'day' } = req.query;

  // Tarih aralığı oluştur
  const dateFilter = {};
  if (startDate) {
    dateFilter.createdAt = { ...dateFilter.createdAt, $gte: new Date(startDate) };
  } else {
    // Varsayılan son 30 gün
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    dateFilter.createdAt = { $gte: thirtyDaysAgo };
  }

  if (endDate) {
    dateFilter.createdAt = { ...dateFilter.createdAt, $lte: new Date(endDate) };
  }

  // Zaman gruplandırma formatı
  let dateFormat;
  if (groupBy === 'month') {
    dateFormat = { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } };
  } else if (groupBy === 'week') {
    dateFormat = { year: { $year: '$createdAt' }, week: { $week: '$createdAt' } };
  } else {
    dateFormat = {
      year: { $year: '$createdAt' },
      month: { $month: '$createdAt' },
      day: { $dayOfMonth: '$createdAt' },
    };
  }

  // Genel istatistikler
  const totalStats = await Transaction.aggregate([
    { $match: dateFilter },
    {
      $group: {
        _id: null,
        totalTransactions: { $sum: 1 },
        totalAmount: {
          $sum: {
            $cond: [{ $eq: ['$currency', 'coins'] }, 0, '$amount'],
          },
        },
        totalCoins: {
          $sum: {
            $cond: [{ $eq: ['$currency', 'coins'] }, '$amount', 0],
          },
        },
        avgAmount: {
          $avg: {
            $cond: [{ $eq: ['$currency', 'coins'] }, 0, '$amount'],
          },
        },
        completedTransactions: {
          $sum: {
            $cond: [{ $eq: ['$status', 'completed'] }, 1, 0],
          },
        },
        failedTransactions: {
          $sum: {
            $cond: [{ $eq: ['$status', 'failed'] }, 1, 0],
          },
        },
        refundedTransactions: {
          $sum: {
            $cond: [{ $eq: ['$status', 'refunded'] }, 1, 0],
          },
        },
      },
    },
  ]);

  // İşlem türüne göre istatistikler
  const typeStats = await Transaction.aggregate([
    { $match: dateFilter },
    {
      $group: {
        _id: '$type',
        count: { $sum: 1 },
        totalAmount: { $sum: '$amount' },
      },
    },
    { $sort: { count: -1 } },
  ]);

  // Para birimine göre istatistikler
  const currencyStats = await Transaction.aggregate([
    { $match: dateFilter },
    {
      $group: {
        _id: '$currency',
        count: { $sum: 1 },
        totalAmount: { $sum: '$amount' },
      },
    },
    { $sort: { totalAmount: -1 } },
  ]);

  // Zamana göre istatistikler
  const timeStats = await Transaction.aggregate([
    { $match: dateFilter },
    {
      $group: {
        _id: dateFormat,
        count: { $sum: 1 },
        totalAmount: {
          $sum: {
            $cond: [{ $eq: ['$currency', 'coins'] }, 0, '$amount'],
          },
        },
        totalCoins: {
          $sum: {
            $cond: [{ $eq: ['$currency', 'coins'] }, '$amount', 0],
          },
        },
      },
    },
    {
      $project: {
        _id: 0,
        date: '$_id',
        count: 1,
        totalAmount: 1,
        totalCoins: 1,
      },
    },
    { $sort: { 'date.year': 1, 'date.month': 1, 'date.day': 1, 'date.week': 1 } },
  ]);

  res.status(200).json({
    success: true,
    data: {
      overview:
        totalStats.length > 0
          ? totalStats[0]
          : {
              totalTransactions: 0,
              totalAmount: 0,
              totalCoins: 0,
              avgAmount: 0,
              completedTransactions: 0,
              failedTransactions: 0,
              refundedTransactions: 0,
            },
      byType: typeStats,
      byCurrency: currencyStats,
      byTime: timeStats,
    },
  });
});

/**
 * @desc    İşlem özeti getir
 * @route   GET /api/transactions/summary
 * @access  Private
 */
const getTransactionSummary = asyncHandler(async (req, res, next) => {
  const userId = req.user._id;
  const { period = '30days' } = req.query;

  // Tarih aralığı oluştur
  const startDate = new Date();

  if (period === '7days') {
    startDate.setDate(startDate.getDate() - 7);
  } else if (period === '30days') {
    startDate.setDate(startDate.getDate() - 30);
  } else if (period === '90days') {
    startDate.setDate(startDate.getDate() - 90);
  } else if (period === '1year') {
    startDate.setFullYear(startDate.getFullYear() - 1);
  } else {
    return next(new ErrorResponse('Geçersiz periyot', 400));
  }

  // Kullanıcının işlem özeti
  const summary = await Transaction.aggregate([
    {
      $match: {
        user: mongoose.Types.ObjectId(userId),
        createdAt: { $gte: startDate },
      },
    },
    {
      $group: {
        _id: '$type',
        count: { $sum: 1 },
        totalAmount: { $sum: '$amount' },
      },
    },
  ]);

  // Coin özeti
  const coinTransactions = await Transaction.find({
    user: userId,
    currency: 'coins',
    createdAt: { $gte: startDate },
  })
    .sort({ createdAt: -1 })
    .limit(5);

  // Premium işlemleri
  const premiumTransactions = await Transaction.find({
    user: userId,
    type: 'premium_purchase',
    createdAt: { $gte: startDate },
  }).sort({ createdAt: -1 });

  // Toplam coin harcaması ve kazancı
  const coinStats = await Transaction.aggregate([
    {
      $match: {
        user: mongoose.Types.ObjectId(userId),
        currency: 'coins',
        createdAt: { $gte: startDate },
      },
    },
    {
      $group: {
        _id: null,
        spent: {
          $sum: {
            $cond: [{ $lt: ['$amount', 0] }, { $abs: '$amount' }, 0],
          },
        },
        earned: {
          $sum: {
            $cond: [{ $gt: ['$amount', 0] }, '$amount', 0],
          },
        },
      },
    },
  ]);

  res.status(200).json({
    success: true,
    data: {
      summary,
      coinStats: coinStats.length > 0 ? coinStats[0] : { spent: 0, earned: 0 },
      recentCoinTransactions: coinTransactions,
      premiumTransactions,
    },
  });
});

module.exports = {
  getUserTransactions,
  getTransactionById,
  createCoinPurchase,
  createPremiumPurchase,
  createAwardTransaction,
  processRefund,
  updateTransactionStatus,
  getAllTransactions,
  getTransactionStats,
  getTransactionSummary,
};
