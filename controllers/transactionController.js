const Transaction = require('../models/Transaction');
const User = require('../models/User');
const AwardInstance = require('../models/AwardInstance'); // Varsayımsal model
const UserPremium = require('../models/UserPremium'); // Varsayımsal model
const asyncHandler = require('../middleware/async');
const ErrorResponse = require('../utils/errorResponse');
const mongoose = require('mongoose');

/**
 * @desc    Kullanıcının işlemlerini getir
 * @route   GET /api/transactions
 * @access  Private
 */
const getUserTransactions = asyncHandler(async (req, res, next) => {
  const userId = req.user._id;

  // Pagination
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;
  const startIndex = (page - 1) * limit;

  // Filtreleme seçenekleri
  const filter = { user: userId };

  // İşlem tipine göre filtreleme
  if (
    req.query.type &&
    [
      'purchase',
      'award_given',
      'award_received',
      'premium_purchase',
      'premium_gift',
      'refund',
      'other',
    ].includes(req.query.type)
  ) {
    filter.type = req.query.type;
  }

  // Duruma göre filtreleme
  if (
    req.query.status &&
    ['pending', 'completed', 'failed', 'refunded'].includes(req.query.status)
  ) {
    filter.status = req.query.status;
  }

  // Para birimine göre filtreleme
  if (req.query.currency && ['USD', 'EUR', 'GBP', 'coins'].includes(req.query.currency)) {
    filter.currency = req.query.currency;
  }

  // Tarih aralığına göre filtreleme
  if (req.query.startDate) {
    if (!filter.createdAt) filter.createdAt = {};
    filter.createdAt.$gte = new Date(req.query.startDate);
  }

  if (req.query.endDate) {
    if (!filter.createdAt) filter.createdAt = {};
    filter.createdAt.$lte = new Date(req.query.endDate);
  }

  // Toplam sayıyı hesapla
  const total = await Transaction.countDocuments(filter);

  // İşlemleri getir
  const transactions = await Transaction.find(filter)
    .sort({ createdAt: -1 })
    .skip(startIndex)
    .limit(limit)
    .populate('relatedTransaction', 'type amount currency status')
    .populate('relatedAward', 'name value icon')
    .populate('relatedPremium', 'type duration startDate endDate');

  // Özet istatistikleri hesapla (isteğe bağlı)
  let summary = null;
  if (req.query.includeSummary === 'true') {
    const aggregationResults = await Transaction.aggregate([
      { $match: { user: mongoose.Types.ObjectId(userId) } },
      {
        $group: {
          _id: '$currency',
          totalSpent: {
            $sum: {
              $cond: [
                { $in: ['$type', ['purchase', 'award_given', 'premium_purchase']] },
                '$amount',
                0,
              ],
            },
          },
          totalReceived: {
            $sum: {
              $cond: [{ $in: ['$type', ['award_received', 'refund']] }, '$amount', 0],
            },
          },
          count: { $sum: 1 },
        },
      },
    ]);

    // Özeti düzenle
    summary = {};
    aggregationResults.forEach((result) => {
      summary[result._id] = {
        totalSpent: result.totalSpent,
        totalReceived: result.totalReceived,
        balance: result.totalReceived - result.totalSpent,
        count: result.count,
      };
    });
  }

  res.status(200).json({
    success: true,
    count: total,
    pagination: {
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
    summary,
    data: transactions,
  });
});

/**
 * @desc    Belirli bir işlemi getir
 * @route   GET /api/transactions/:id
 * @access  Private
 */
const getTransaction = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user._id;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorResponse('Geçersiz işlem ID formatı', 400));
  }

  const transaction = await Transaction.findById(id)
    .populate('relatedTransaction', 'type amount currency status')
    .populate('relatedAward', 'name value icon')
    .populate('relatedPremium', 'type duration startDate endDate');

  if (!transaction) {
    return next(new ErrorResponse('İşlem bulunamadı', 404));
  }

  // Yetki kontrolü - sadece kendi işlemlerini görebilir (admin hariç)
  if (transaction.user.toString() !== userId.toString() && req.user.role !== 'admin') {
    return next(new ErrorResponse('Bu işlemi görüntüleme yetkiniz yok', 403));
  }

  res.status(200).json({
    success: true,
    data: transaction,
  });
});

/**
 * @desc    Coin satın alma işlemi başlat
 * @route   POST /api/transactions/purchase/coins
 * @access  Private
 */
const purchaseCoins = asyncHandler(async (req, res, next) => {
  const userId = req.user._id;
  const { amount, currency, paymentMethod, packageId } = req.body;

  // Gerekli alanları kontrol et
  if (!amount || amount <= 0) {
    return next(new ErrorResponse('Geçerli bir miktar gerekli', 400));
  }

  if (!currency || !['USD', 'EUR', 'GBP'].includes(currency)) {
    return next(new ErrorResponse('Geçerli bir para birimi gerekli (USD, EUR, GBP)', 400));
  }

  if (
    !paymentMethod ||
    !['credit_card', 'paypal', 'apple_pay', 'google_pay', 'other'].includes(paymentMethod)
  ) {
    return next(new ErrorResponse('Geçerli bir ödeme yöntemi gerekli', 400));
  }

  // Coin paketlerini kontrol et (varsayımsal bir yapı)
  let coinAmount = 0;
  let description = '';

  switch (packageId) {
    case 'basic':
      coinAmount = 500;
      description = `${coinAmount} Coin Satın Alma - Temel Paket`;
      break;
    case 'standard':
      coinAmount = 1200;
      description = `${coinAmount} Coin Satın Alma - Standart Paket`;
      break;
    case 'premium':
      coinAmount = 3000;
      description = `${coinAmount} Coin Satın Alma - Premium Paket`;
      break;
    case 'custom':
      coinAmount = calculateCustomCoinAmount(amount, currency);
      description = `${coinAmount} Coin Satın Alma - Özel Miktar`;
      break;
    default:
      return next(new ErrorResponse('Geçersiz paket ID', 400));
  }

  // Ödeme işlemini başlat (varsayımsal)
  // Gerçek uygulamada burada Stripe, PayPal vb. entegrasyonu olacaktır
  const paymentResponse = await processPayment({
    userId,
    amount,
    currency,
    paymentMethod,
    description,
  });

  // İşlemi oluştur
  const transaction = await Transaction.create({
    user: userId,
    type: 'purchase',
    amount,
    currency,
    description,
    status: 'pending',
    paymentMethod,
    paymentReference: paymentResponse.paymentId,
    metadata: {
      coinAmount,
      packageId,
      paymentDetails: paymentResponse.details,
    },
  });

  res.status(201).json({
    success: true,
    message: 'Coin satın alma işlemi başlatıldı',
    data: {
      transaction,
      paymentDetails: paymentResponse.clientResponse,
    },
  });
});

/**
 * @desc    Premium üyelik satın alma işlemi başlat
 * @route   POST /api/transactions/purchase/premium
 * @access  Private
 */
const purchasePremium = asyncHandler(async (req, res, next) => {
  const userId = req.user._id;
  const { planType, duration, paymentMethod, payWithCoins } = req.body;

  // Gerekli alanları kontrol et
  if (!planType || !['standard', 'gold', 'platinum'].includes(planType)) {
    return next(new ErrorResponse('Geçerli bir premium plan tipi gerekli', 400));
  }

  if (!duration || !['month', 'year'].includes(duration)) {
    return next(new ErrorResponse('Geçerli bir süre gerekli (month, year)', 400));
  }

  // Planın fiyatını hesapla (varsayımsal fiyat yapısı)
  const { amount, currency, coinPrice } = calculatePremiumPrice(planType, duration);

  // Kullanıcının mevcut premium durumunu kontrol et
  const existingPremium = await UserPremium.findOne({
    user: userId,
    status: 'active',
    endDate: { $gt: new Date() },
  });

  // Eğer aktif premium varsa, uzatma işlemi yap
  const isPremiumExtension = !!existingPremium;

  // Coin ile ödeme yapılacaksa
  if (payWithCoins) {
    // Kullanıcının coin bakiyesini kontrol et
    const user = await User.findById(userId);
    if (!user.coins || user.coins < coinPrice) {
      return next(
        new ErrorResponse(
          `Yetersiz coin bakiyesi. Gereken: ${coinPrice}, Mevcut: ${user.coins || 0}`,
          400,
        ),
      );
    }

    // Premium üyelik oluştur
    const premiumMembership = await createPremiumMembership(
      userId,
      planType,
      duration,
      existingPremium,
    );

    // İşlemi oluştur
    const transaction = await Transaction.create({
      user: userId,
      type: 'premium_purchase',
      amount: coinPrice,
      currency: 'coins',
      description: `${planType.charAt(0).toUpperCase() + planType.slice(1)} Premium Üyelik - ${duration === 'month' ? 'Aylık' : 'Yıllık'}`,
      status: 'completed',
      paymentMethod: 'coins',
      relatedPremium: premiumMembership._id,
      metadata: {
        planType,
        duration,
        isPremiumExtension,
      },
    });

    // Kullanıcının coin bakiyesini güncelle
    await User.findByIdAndUpdate(userId, {
      $inc: { coins: -coinPrice },
    });

    return res.status(201).json({
      success: true,
      message: 'Premium üyelik satın alındı',
      data: {
        transaction,
        premium: premiumMembership,
        coinBalance: user.coins - coinPrice,
      },
    });
  }

  // Kredi kartı/diğer ödeme yöntemleri ile ödeme
  if (
    !paymentMethod ||
    !['credit_card', 'paypal', 'apple_pay', 'google_pay', 'other'].includes(paymentMethod)
  ) {
    return next(new ErrorResponse('Geçerli bir ödeme yöntemi gerekli', 400));
  }

  // Ödeme işlemini başlat (varsayımsal)
  const description = `${planType.charAt(0).toUpperCase() + planType.slice(1)} Premium Üyelik - ${duration === 'month' ? 'Aylık' : 'Yıllık'}`;
  const paymentResponse = await processPayment({
    userId,
    amount,
    currency,
    paymentMethod,
    description,
  });

  // Premium üyelik oluştur (ödeme tamamlandığında aktifleşecek)
  const premiumMembership = await createPendingPremiumMembership(
    userId,
    planType,
    duration,
    existingPremium,
  );

  // İşlemi oluştur
  const transaction = await Transaction.create({
    user: userId,
    type: 'premium_purchase',
    amount,
    currency,
    description,
    status: 'pending',
    paymentMethod,
    paymentReference: paymentResponse.paymentId,
    relatedPremium: premiumMembership._id,
    metadata: {
      planType,
      duration,
      isPremiumExtension,
    },
  });

  res.status(201).json({
    success: true,
    message: 'Premium üyelik satın alma işlemi başlatıldı',
    data: {
      transaction,
      paymentDetails: paymentResponse.clientResponse,
    },
  });
});

/**
 * @desc    Ödül verme işlemi
 * @route   POST /api/transactions/award
 * @access  Private
 */
const giveAward = asyncHandler(async (req, res, next) => {
  const userId = req.user._id;
  const { awardId, recipientId, itemType, itemId, message } = req.body;

  // Gerekli alanları kontrol et
  if (!awardId || !mongoose.Types.ObjectId.isValid(awardId)) {
    return next(new ErrorResponse('Geçerli bir ödül ID gerekli', 400));
  }

  if (!recipientId || !mongoose.Types.ObjectId.isValid(recipientId)) {
    return next(new ErrorResponse('Geçerli bir alıcı ID gerekli', 400));
  }

  if (!itemType || !['post', 'comment'].includes(itemType)) {
    return next(new ErrorResponse('Geçerli bir öğe tipi gerekli (post, comment)', 400));
  }

  if (!itemId || !mongoose.Types.ObjectId.isValid(itemId)) {
    return next(new ErrorResponse('Geçerli bir öğe ID gerekli', 400));
  }

  // Ödülü kontrol et
  const award = await Award.findById(awardId);
  if (!award) {
    return next(new ErrorResponse('Ödül bulunamadı', 404));
  }

  // Alıcıyı kontrol et
  const recipient = await User.findById(recipientId);
  if (!recipient) {
    return next(new ErrorResponse('Alıcı kullanıcı bulunamadı', 404));
  }

  // Öğeyi kontrol et
  let item;
  let Model;
  if (itemType === 'post') {
    Model = mongoose.model('Post');
    item = await Model.findById(itemId);
  } else {
    Model = mongoose.model('Comment');
    item = await Model.findById(itemId);
  }

  if (!item) {
    return next(new ErrorResponse(`${itemType === 'post' ? 'Gönderi' : 'Yorum'} bulunamadı`, 404));
  }

  // Öğenin sahibinin alıcı olduğunu kontrol et
  if (item.author.toString() !== recipientId.toString()) {
    return next(new ErrorResponse('Alıcı ID, öğenin sahibi ile eşleşmiyor', 400));
  }

  // Kullanıcının coin bakiyesini kontrol et
  const user = await User.findById(userId);
  if (!user.coins || user.coins < award.cost) {
    return next(
      new ErrorResponse(
        `Yetersiz coin bakiyesi. Gereken: ${award.cost}, Mevcut: ${user.coins || 0}`,
        400,
      ),
    );
  }

  // Ödül verme işlemini başlat
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Kullanıcının coin bakiyesini düşür
    await User.findByIdAndUpdate(userId, { $inc: { coins: -award.cost } }, { session });

    // Alıcının coin bakiyesini arttır (eğer ödülün coin ödülü varsa)
    if (award.coinReward > 0) {
      await User.findByIdAndUpdate(recipientId, { $inc: { coins: award.coinReward } }, { session });
    }

    // Ödül örneği oluştur
    const awardInstance = await AwardInstance.create(
      [
        {
          award: awardId,
          giver: userId,
          recipient: recipientId,
          item: itemId,
          itemType,
          message: message || '',
          isAnonymous: !!req.body.isAnonymous,
        },
      ],
      { session },
    );

    // Verilen ödül işlemini oluştur
    const giverTransaction = await Transaction.create(
      [
        {
          user: userId,
          type: 'award_given',
          amount: award.cost,
          currency: 'coins',
          description: `${award.name} ödülü verme`,
          status: 'completed',
          relatedAward: awardInstance[0]._id,
          metadata: {
            recipientId,
            itemType,
            itemId,
            awardName: award.name,
          },
        },
      ],
      { session },
    );

    // Alınan ödül işlemini oluştur (eğer coin ödülü varsa)
    let recipientTransaction = null;
    if (award.coinReward > 0) {
      recipientTransaction = await Transaction.create(
        [
          {
            user: recipientId,
            type: 'award_received',
            amount: award.coinReward,
            currency: 'coins',
            description: `${award.name} ödülü alındı`,
            status: 'completed',
            relatedAward: awardInstance[0]._id,
            relatedTransaction: giverTransaction[0]._id,
            metadata: {
              giverId: userId,
              itemType,
              itemId,
              awardName: award.name,
              isAnonymous: !!req.body.isAnonymous,
            },
          },
        ],
        { session },
      );
    }

    // Öğeye ödülü ekle
    await Model.findByIdAndUpdate(itemId, { $push: { awards: awardInstance[0]._id } }, { session });

    await session.commitTransaction();

    // Verilen transaksiyon ID'sini ilgili işleme ekle
    if (recipientTransaction) {
      await Transaction.findByIdAndUpdate(giverTransaction[0]._id, {
        relatedTransaction: recipientTransaction[0]._id,
      });
    }

    res.status(201).json({
      success: true,
      message: 'Ödül başarıyla verildi',
      data: {
        transaction: giverTransaction[0],
        awardInstance: awardInstance[0],
        remainingCoins: user.coins - award.cost,
      },
    });
  } catch (error) {
    await session.abortTransaction();
    return next(new ErrorResponse('Ödül verme işlemi başarısız oldu', 500));
  } finally {
    session.endSession();
  }
});

/**
 * @desc    Premium hediye etme
 * @route   POST /api/transactions/gift/premium
 * @access  Private
 */
const giftPremium = asyncHandler(async (req, res, next) => {
  const userId = req.user._id;
  const { recipientId, planType, duration, payWithCoins, paymentMethod } = req.body;

  // Gerekli alanları kontrol et
  if (!recipientId || !mongoose.Types.ObjectId.isValid(recipientId)) {
    return next(new ErrorResponse('Geçerli bir alıcı ID gerekli', 400));
  }

  if (!planType || !['standard', 'gold', 'platinum'].includes(planType)) {
    return next(new ErrorResponse('Geçerli bir premium plan tipi gerekli', 400));
  }

  if (!duration || !['month', 'year'].includes(duration)) {
    return next(new ErrorResponse('Geçerli bir süre gerekli (month, year)', 400));
  }

  // Alıcıyı kontrol et
  const recipient = await User.findById(recipientId);
  if (!recipient) {
    return next(new ErrorResponse('Alıcı kullanıcı bulunamadı', 404));
  }

  // Planın fiyatını hesapla
  const { amount, currency, coinPrice } = calculatePremiumPrice(planType, duration);

  // Hediye açıklaması
  const giftDescription = `${planType.charAt(0).toUpperCase() + planType.slice(1)} Premium Hediyesi - ${duration === 'month' ? 'Aylık' : 'Yıllık'} (${recipient.username})`;

  // Alıcının mevcut premium durumunu kontrol et
  const existingPremium = await UserPremium.findOne({
    user: recipientId,
    status: 'active',
    endDate: { $gt: new Date() },
  });

  // Eğer aktif premium varsa, uzatma işlemi yap
  const isPremiumExtension = !!existingPremium;

  // Coin ile ödeme yapılacaksa
  if (payWithCoins) {
    // Kullanıcının coin bakiyesini kontrol et
    const user = await User.findById(userId);
    if (!user.coins || user.coins < coinPrice) {
      return next(
        new ErrorResponse(
          `Yetersiz coin bakiyesi. Gereken: ${coinPrice}, Mevcut: ${user.coins || 0}`,
          400,
        ),
      );
    }

    // Premium üyelik oluştur
    const premiumMembership = await createPremiumMembership(
      recipientId,
      planType,
      duration,
      existingPremium,
    );

    // İşlem başlat
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Kullanıcının coin bakiyesini düşür
      await User.findByIdAndUpdate(userId, { $inc: { coins: -coinPrice } }, { session });

      // Hediye veren işlemini oluştur
      const transaction = await Transaction.create(
        [
          {
            user: userId,
            type: 'premium_gift',
            amount: coinPrice,
            currency: 'coins',
            description: giftDescription,
            status: 'completed',
            paymentMethod: 'coins',
            relatedPremium: premiumMembership._id,
            metadata: {
              recipientId,
              planType,
              duration,
              isPremiumExtension,
            },
          },
        ],
        { session },
      );

      await session.commitTransaction();

      res.status(201).json({
        success: true,
        message: 'Premium üyelik hediye edildi',
        data: {
          transaction: transaction[0],
          premium: premiumMembership,
          coinBalance: user.coins - coinPrice,
        },
      });
    } catch (error) {
      await session.abortTransaction();
      return next(new ErrorResponse('Premium hediye etme işlemi başarısız oldu', 500));
    } finally {
      session.endSession();
    }
  } else {
    // Kredi kartı/diğer ödeme yöntemleri ile ödeme
    if (
      !paymentMethod ||
      !['credit_card', 'paypal', 'apple_pay', 'google_pay', 'other'].includes(paymentMethod)
    ) {
      return next(new ErrorResponse('Geçerli bir ödeme yöntemi gerekli', 400));
    }

    // Ödeme işlemini başlat (varsayımsal)
    const paymentResponse = await processPayment({
      userId,
      amount,
      currency,
      paymentMethod,
      description: giftDescription,
    });

    // Premium üyelik oluştur (ödeme tamamlandığında aktifleşecek)
    const premiumMembership = await createPendingPremiumMembership(
      recipientId,
      planType,
      duration,
      existingPremium,
    );

    // İşlemi oluştur
    const transaction = await Transaction.create({
      user: userId,
      type: 'premium_gift',
      amount,
      currency,
      description: giftDescription,
      status: 'pending',
      paymentMethod,
      paymentReference: paymentResponse.paymentId,
      relatedPremium: premiumMembership._id,
      metadata: {
        recipientId,
        planType,
        duration,
        isPremiumExtension,
      },
    });

    res.status(201).json({
      success: true,
      message: 'Premium üyelik hediye etme işlemi başlatıldı',
      data: {
        transaction,
        paymentDetails: paymentResponse.clientResponse,
      },
    });
  }
});

/**
 * @desc    İade işlemi başlat
 * @route   POST /api/transactions/:id/refund
 * @access  Private (Admin only)
 */
const initiateRefund = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { reason } = req.body;
  const adminId = req.user._id;

  // Admin yetkisi kontrolü
  if (req.user.role !== 'admin') {
    return next(new ErrorResponse('Bu işlem için admin yetkisi gerekiyor', 403));
  }

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorResponse('Geçersiz işlem ID formatı', 400));
  }

  // İşlemi kontrol et
  const transaction = await Transaction.findById(id);
  if (!transaction) {
    return next(new ErrorResponse('İşlem bulunamadı', 404));
  }

  // Sadece tamamlanmış işlemler iade edilebilir
  if (transaction.status !== 'completed') {
    return next(new ErrorResponse(`${transaction.status} durumundaki işlemler iade edilemez`, 400));
  }

  // Zaten iade edilmiş mi kontrol et
  const existingRefund = await Transaction.findOne({
    type: 'refund',
    relatedTransaction: id,
  });

  if (existingRefund) {
    return next(new ErrorResponse('Bu işlem zaten iade edilmiş', 400));
  }

  // İşlem tipine göre iade işlemi yap
  switch (transaction.type) {
    case 'purchase':
    case 'premium_purchase':
    case 'premium_gift':
      // Gerçek para ile yapılan işlemler için ödeme sistemine iade talebi (varsayımsal)
      if (transaction.currency !== 'coins' && transaction.paymentReference) {
        await processRefund(transaction.paymentReference, transaction.amount);
      }

      // İşlem sonucu kullanıcıya coinler verildiyse, coinleri geri al
      if (transaction.metadata && transaction.metadata.coinAmount) {
        // Kullanıcının mevcut coin bakiyesini kontrol et
        const user = await User.findById(transaction.user);
        if (!user) {
          return next(new ErrorResponse('Kullanıcı bulunamadı', 404));
        }

        // Verilen coinlerden daha az coin varsa kısmi iade yap
        const coinAmount = transaction.metadata.coinAmount;
        const refundableCoins = Math.min(user.coins || 0, coinAmount);

        if (refundableCoins > 0) {
          await User.findByIdAndUpdate(transaction.user, {
            $inc: { coins: -refundableCoins },
          });
        }
      }
      break;

    case 'award_given':
      // Ödül işlemleri için, ödül örneğini kaldır ve coinleri iade et
      if (transaction.relatedAward) {
        const awardInstance = await AwardInstance.findById(transaction.relatedAward);
        if (awardInstance) {
          // Ödül örneğini kaldır
          await AwardInstance.findByIdAndDelete(transaction.relatedAward);

          // İlgili öğeden ödülü kaldır
          const Model = mongoose.model(awardInstance.itemType === 'post' ? 'Post' : 'Comment');
          await Model.findByIdAndUpdate(awardInstance.item, {
            $pull: { awards: transaction.relatedAward },
          });

          // Kullanıcıya coinleri iade et
          await User.findByIdAndUpdate(transaction.user, {
            $inc: { coins: transaction.amount },
          });

          // Eğer alıcı kullanıcı coin kazandıysa, bu coinleri geri al
          if (transaction.relatedTransaction) {
            const relatedTransaction = await Transaction.findById(transaction.relatedTransaction);
            if (
              relatedTransaction &&
              relatedTransaction.type === 'award_received' &&
              relatedTransaction.amount > 0
            ) {
              const recipient = await User.findById(relatedTransaction.user);
              if (recipient) {
                const refundableRecipientCoins = Math.min(
                  recipient.coins || 0,
                  relatedTransaction.amount,
                );
                if (refundableRecipientCoins > 0) {
                  await User.findByIdAndUpdate(relatedTransaction.user, {
                    $inc: { coins: -refundableRecipientCoins },
                  });
                }
              }

              // Alıcı işlemini de iade edilmiş olarak işaretle
              await Transaction.findByIdAndUpdate(transaction.relatedTransaction, {
                status: 'refunded',
              });
            }
          }
        }
      }
      break;

    default:
      return next(new ErrorResponse(`${transaction.type} türündeki işlemler iade edilemez`, 400));
  }

  // İade işlemi oluştur
  const refundTransaction = await Transaction.create({
    user: transaction.user,
    type: 'refund',
    amount: transaction.amount,
    currency: transaction.currency,
    description: `İade: ${transaction.description}`,
    status: 'completed',
    paymentMethod: transaction.paymentMethod,
    paymentReference: transaction.paymentReference
      ? `refund_${transaction.paymentReference}`
      : null,
    relatedTransaction: transaction._id,
    relatedAward: transaction.relatedAward,
    relatedPremium: transaction.relatedPremium,
    metadata: {
      originalTransactionType: transaction.type,
      reason: reason || 'Admin tarafından başlatıldı',
      initiatedBy: adminId,
    },
  });

  // Orijinal işlemi iade edilmiş olarak işaretle
  await Transaction.findByIdAndUpdate(id, {
    status: 'refunded',
  });

  res.status(200).json({
    success: true,
    message: 'İade işlemi başarıyla tamamlandı',
    data: refundTransaction,
  });
});

/**
 * @desc    Kullanıcının coin işlemlerinin özeti
 * @route   GET /api/transactions/coin-summary
 * @access  Private
 */
const getCoinSummary = asyncHandler(async (req, res, next) => {
  const userId = req.user._id;

  // Kullanıcının mevcut coin bakiyesini al
  const user = await User.findById(userId, 'coins');
  if (!user) {
    return next(new ErrorResponse('Kullanıcı bulunamadı', 404));
  }

  // Son 30 günlük coin işlemleri
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  // Aggregation pipeline
  const coinTransactions = await Transaction.aggregate([
    {
      $match: {
        user: mongoose.Types.ObjectId(userId),
        $or: [
          { currency: 'coins' },
          {
            type: 'purchase',
            'metadata.coinAmount': { $exists: true, $ne: null },
          },
        ],
        createdAt: { $gte: thirtyDaysAgo },
      },
    },
    {
      $addFields: {
        effectiveAmount: {
          $cond: {
            if: { $eq: ['$type', 'purchase'] },
            then: { $ifNull: ['$metadata.coinAmount', 0] },
            else: {
              $cond: {
                if: { $in: ['$type', ['award_given', 'premium_purchase', 'premium_gift']] },
                then: { $multiply: ['$amount', -1] },
                else: '$amount',
              },
            },
          },
        },
      },
    },
    {
      $group: {
        _id: {
          $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
        },
        totalChange: { $sum: '$effectiveAmount' },
        awarded: {
          $sum: {
            $cond: [{ $eq: ['$type', 'award_given'] }, '$amount', 0],
          },
        },
        received: {
          $sum: {
            $cond: [{ $eq: ['$type', 'award_received'] }, '$amount', 0],
          },
        },
        purchased: {
          $sum: {
            $cond: [{ $eq: ['$type', 'purchase'] }, { $ifNull: ['$metadata.coinAmount', 0] }, 0],
          },
        },
        spent: {
          $sum: {
            $cond: [{ $in: ['$type', ['premium_purchase', 'premium_gift']] }, '$amount', 0],
          },
        },
        refunded: {
          $sum: {
            $cond: [{ $eq: ['$type', 'refund'] }, '$amount', 0],
          },
        },
        count: { $sum: 1 },
      },
    },
    {
      $sort: { _id: 1 },
    },
  ]);

  // Toplam istatistikler
  const totalStats = await Transaction.aggregate([
    {
      $match: {
        user: mongoose.Types.ObjectId(userId),
        $or: [
          { currency: 'coins' },
          {
            type: 'purchase',
            'metadata.coinAmount': { $exists: true, $ne: null },
          },
        ],
      },
    },
    {
      $addFields: {
        effectiveAmount: {
          $cond: {
            if: { $eq: ['$type', 'purchase'] },
            then: { $ifNull: ['$metadata.coinAmount', 0] },
            else: {
              $cond: {
                if: { $in: ['$type', ['award_given', 'premium_purchase', 'premium_gift']] },
                then: { $multiply: ['$amount', -1] },
                else: '$amount',
              },
            },
          },
        },
      },
    },
    {
      $group: {
        _id: null,
        totalAwarded: {
          $sum: {
            $cond: [{ $eq: ['$type', 'award_given'] }, '$amount', 0],
          },
        },
        totalReceived: {
          $sum: {
            $cond: [{ $eq: ['$type', 'award_received'] }, '$amount', 0],
          },
        },
        totalPurchased: {
          $sum: {
            $cond: [{ $eq: ['$type', 'purchase'] }, { $ifNull: ['$metadata.coinAmount', 0] }, 0],
          },
        },
        totalSpent: {
          $sum: {
            $cond: [{ $in: ['$type', ['premium_purchase', 'premium_gift']] }, '$amount', 0],
          },
        },
        totalRefunded: {
          $sum: {
            $cond: [{ $eq: ['$type', 'refund'] }, '$amount', 0],
          },
        },
        netChange: { $sum: '$effectiveAmount' },
        transactionCount: { $sum: 1 },
      },
    },
  ]);

  // Coin bakiyesi ve geçmiş
  res.status(200).json({
    success: true,
    data: {
      currentBalance: user.coins || 0,
      history: coinTransactions,
      totals:
        totalStats.length > 0
          ? totalStats[0]
          : {
              totalAwarded: 0,
              totalReceived: 0,
              totalPurchased: 0,
              totalSpent: 0,
              totalRefunded: 0,
              netChange: 0,
              transactionCount: 0,
            },
    },
  });
});

/**
 * @desc    Ödeme webhook işleyici
 * @route   POST /api/transactions/webhook
 * @access  Public (with secret validation)
 */
const handlePaymentWebhook = asyncHandler(async (req, res, next) => {
  // Webhook'un geçerliliğini doğrula
  const isValidWebhook = validatePaymentWebhook(req);

  if (!isValidWebhook) {
    return res.status(403).json({
      success: false,
      message: 'Geçersiz webhook imzası',
    });
  }

  const { event_type, payment_id, status, metadata } = req.body;

  // İlgili işlemi bul
  const transaction = await Transaction.findOne({
    paymentReference: payment_id,
    status: { $in: ['pending', 'processing'] },
  });

  if (!transaction) {
    return res.status(200).json({
      success: false,
      message: 'İlgili işlem bulunamadı',
    });
  }

  // Webhook türüne göre işlem yap
  switch (event_type) {
    case 'payment.succeeded':
      // İşlemi tamamlandı olarak işaretle
      await Transaction.findByIdAndUpdate(transaction._id, {
        status: 'completed',
        metadata: { ...transaction.metadata, webhookData: req.body },
      });

      // İşlem türüne göre ek işlemler yap
      if (
        transaction.type === 'purchase' &&
        transaction.metadata &&
        transaction.metadata.coinAmount
      ) {
        // Coin satın alma - kullanıcının bakiyesini güncelle
        await User.findByIdAndUpdate(transaction.user, {
          $inc: { coins: transaction.metadata.coinAmount },
        });
      } else if (transaction.type === 'premium_purchase' || transaction.type === 'premium_gift') {
        // Premium satın alma - premium üyeliği aktifleştir
        if (transaction.relatedPremium) {
          await UserPremium.findByIdAndUpdate(transaction.relatedPremium, {
            status: 'active',
          });
        }
      }
      break;

    case 'payment.failed':
      // İşlemi başarısız olarak işaretle
      await Transaction.findByIdAndUpdate(transaction._id, {
        status: 'failed',
        metadata: {
          ...transaction.metadata,
          webhookData: req.body,
          failureReason: req.body.failure_reason || 'Ödeme başarısız oldu',
        },
      });

      // İlgili premium üyelik varsa iptal et
      if (
        (transaction.type === 'premium_purchase' || transaction.type === 'premium_gift') &&
        transaction.relatedPremium
      ) {
        await UserPremium.findByIdAndUpdate(transaction.relatedPremium, {
          status: 'cancelled',
        });
      }
      break;

    case 'payment.refunded':
      // İşlemi iade edildi olarak işaretle
      await Transaction.findByIdAndUpdate(transaction._id, {
        status: 'refunded',
        metadata: { ...transaction.metadata, webhookData: req.body },
      });

      // İade işlemi oluştur
      await Transaction.create({
        user: transaction.user,
        type: 'refund',
        amount: transaction.amount,
        currency: transaction.currency,
        description: `Otomatik İade: ${transaction.description}`,
        status: 'completed',
        paymentMethod: transaction.paymentMethod,
        paymentReference: `refund_${payment_id}`,
        relatedTransaction: transaction._id,
        metadata: {
          webhookData: req.body,
          reason: 'Ödeme sistemi tarafından iade edildi',
        },
      });
      break;

    default:
      // Diğer event türlerini log'la ama işlem yapma
      console.log(`Bilinmeyen ödeme webhook eventi: ${event_type}`);
  }

  // Webhook'u başarıyla aldığımızı bildir
  res.status(200).json({
    success: true,
    message: 'Webhook başarıyla işlendi',
  });
});

/**
 * @desc    Fatura oluştur
 * @route   GET /api/transactions/:id/invoice
 * @access  Private
 */
const generateInvoice = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user._id;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorResponse('Geçersiz işlem ID formatı', 400));
  }

  const transaction = await Transaction.findById(id).populate('user', 'username email');

  if (!transaction) {
    return next(new ErrorResponse('İşlem bulunamadı', 404));
  }

  // Yetki kontrolü - sadece kendi işlemlerinin faturasını görebilir (admin hariç)
  if (transaction.user._id.toString() !== userId.toString() && req.user.role !== 'admin') {
    return next(new ErrorResponse('Bu işlemin faturasını görüntüleme yetkiniz yok', 403));
  }

  // Sadece para ile yapılan gerçek işlemlerin faturası oluşturulabilir
  if (
    transaction.currency === 'coins' ||
    !['purchase', 'premium_purchase', 'premium_gift'].includes(transaction.type)
  ) {
    return next(new ErrorResponse('Bu işlem türü için fatura oluşturulamaz', 400));
  }

  // İşlem tamamlanmış olmalı
  if (transaction.status !== 'completed') {
    return next(new ErrorResponse('Tamamlanmamış işlemler için fatura oluşturulamaz', 400));
  }

  // Fatura verilerini hazırla
  const invoiceData = {
    invoiceNumber: `INV-${transaction._id.toString().slice(-8).toUpperCase()}`,
    date: transaction.createdAt,
    customer: {
      name: transaction.user.username,
      email: transaction.user.email,
    },
    items: [
      {
        description: transaction.description,
        quantity: 1,
        unitPrice: transaction.amount,
        currency: transaction.currency,
        amount: transaction.amount,
      },
    ],
    subtotal: transaction.amount,
    tax: 0, // Vergi hesaplaması gerekiyorsa burada yapılabilir
    total: transaction.amount,
    paymentMethod: transaction.paymentMethod,
    paymentReference: transaction.paymentReference,
    notes: 'Bu fatura bilgilendirme amaçlıdır.',
  };

  // Fatura PDF'ini oluştur (varsayımsal)
  const pdfBuffer = await generateInvoicePDF(invoiceData);

  // PDF'i gönder
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="invoice-${invoiceData.invoiceNumber}.pdf"`,
    'Content-Length': pdfBuffer.length,
  });

  res.send(pdfBuffer);
});

/**
 * @desc    Admin için işlem istatistikleri
 * @route   GET /api/transactions/admin/stats
 * @access  Private (Admin only)
 */
const getAdminTransactionStats = asyncHandler(async (req, res, next) => {
  // Admin yetkisi kontrolü
  if (req.user.role !== 'admin') {
    return next(new ErrorResponse('Bu işlem için admin yetkisi gerekiyor', 403));
  }

  // Tarih aralığı parametreleri
  const { startDate, endDate, interval = 'day' } = req.query;
  let dateFormat = '%Y-%m-%d';
  let dateField = { $dateToString: { format: dateFormat, date: '$createdAt' } };

  // Zaman aralığına göre format belirle
  if (interval === 'month') {
    dateFormat = '%Y-%m';
    dateField = { $dateToString: { format: dateFormat, date: '$createdAt' } };
  } else if (interval === 'year') {
    dateFormat = '%Y';
    dateField = { $dateToString: { format: dateFormat, date: '$createdAt' } };
  } else if (interval === 'hour') {
    dateFormat = '%Y-%m-%d %H:00';
    dateField = { $dateToString: { format: dateFormat, date: '$createdAt' } };
  }

  // Tarih filtreleme
  const matchStage = {};
  if (startDate) {
    if (!matchStage.createdAt) matchStage.createdAt = {};
    matchStage.createdAt.$gte = new Date(startDate);
  }

  if (endDate) {
    if (!matchStage.createdAt) matchStage.createdAt = {};
    matchStage.createdAt.$lte = new Date(endDate);
  }

  // İstatistikler için aggregation pipeline
  const stats = await Transaction.aggregate([
    {
      $match: matchStage,
    },
    {
      $group: {
        _id: {
          date: dateField,
          type: '$type',
          currency: '$currency',
          status: '$status',
        },
        count: { $sum: 1 },
        totalAmount: { $sum: '$amount' },
      },
    },
    {
      $group: {
        _id: {
          date: '$_id.date',
          type: '$_id.type',
          currency: '$_id.currency',
        },
        statuses: {
          $push: {
            status: '$_id.status',
            count: '$count',
            amount: '$totalAmount',
          },
        },
        totalCount: { $sum: '$count' },
        totalAmount: { $sum: '$totalAmount' },
      },
    },
    {
      $group: {
        _id: {
          date: '$_id.date',
          type: '$_id.type',
        },
        currencies: {
          $push: {
            currency: '$_id.currency',
            statuses: '$statuses',
            count: '$totalCount',
            amount: '$totalAmount',
          },
        },
        totalCount: { $sum: '$totalCount' },
        totalAmount: { $sum: '$totalAmount' },
      },
    },
    {
      $group: {
        _id: '$_id.date',
        types: {
          $push: {
            type: '$_id.type',
            currencies: '$currencies',
            count: '$totalCount',
            amount: '$totalAmount',
          },
        },
        totalCount: { $sum: '$totalCount' },
        totalAmount: { $sum: '$totalAmount' },
      },
    },
    {
      $sort: { _id: 1 },
    },
  ]);

  // Özet istatistikler
  const summary = await Transaction.aggregate([
    {
      $match: matchStage,
    },
    {
      $group: {
        _id: {
          type: '$type',
          currency: '$currency',
          status: '$status',
        },
        count: { $sum: 1 },
        totalAmount: { $sum: '$amount' },
      },
    },
    {
      $sort: {
        '_id.type': 1,
        '_id.currency': 1,
        '_id.status': 1,
      },
    },
  ]);

  // Ödeme yöntemlerine göre dağılım
  const paymentMethodStats = await Transaction.aggregate([
    {
      $match: {
        ...matchStage,
        paymentMethod: { $exists: true, $ne: null },
      },
    },
    {
      $group: {
        _id: '$paymentMethod',
        count: { $sum: 1 },
        totalAmount: { $sum: '$amount' },
      },
    },
    {
      $sort: { count: -1 },
    },
  ]);

  res.status(200).json({
    success: true,
    data: {
      timeSeries: stats,
      summary,
      paymentMethods: paymentMethodStats,
    },
  });
});

// ==================== YARDIMCI FONKSİYONLAR ====================

/**
 * Ödeme işlemini gerçekleştir (varsayımsal)
 * @param {Object} paymentDetails - Ödeme detayları
 * @returns {Promise<Object>} Ödeme sonucu
 */
const processPayment = async (paymentDetails) => {
  // Burada gerçek ödeme işlemcisi entegrasyonu olacaktır
  // Örneğin: Stripe, PayPal, vs.

  // Simülasyon amaçlı
  return {
    success: true,
    paymentId: `PAY_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    status: 'pending',
    details: {
      processingTime: new Date(),
      paymentMethod: paymentDetails.paymentMethod,
      amount: paymentDetails.amount,
      currency: paymentDetails.currency,
    },
    clientResponse: {
      // Müşteri tarafında gösterilecek bilgiler
      redirectUrl: '/payment/processing',
      transactionReference: `REF_${Date.now()}`,
      expectedCompletionTime: new Date(Date.now() + 60000), // 1 dakika sonra
    },
  };
};

/**
 * İade işlemini gerçekleştir (varsayımsal)
 * @param {String} paymentId - Ödeme ID
 * @param {Number} amount - İade miktarı
 * @returns {Promise<Object>} İade sonucu
 */
const processRefund = async (paymentId, amount) => {
  // Burada gerçek ödeme işlemcisi entegrasyonu olacaktır
  // Örneğin: Stripe, PayPal, vs.

  // Simülasyon amaçlı
  return {
    success: true,
    refundId: `REF_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    status: 'completed',
    details: {
      processingTime: new Date(),
      originalPayment: paymentId,
      refundedAmount: amount,
    },
  };
};

/**
 * Premium üyelik oluştur
 * @param {ObjectId} userId - Kullanıcı ID
 * @param {String} planType - Plan türü
 * @param {String} duration - Süre
 * @param {Object} existingPremium - Mevcut premium üyelik
 * @returns {Promise<Object>} Premium üyelik
 */
const createPremiumMembership = async (userId, planType, duration, existingPremium) => {
  // Süre hesapla
  const durationInDays = duration === 'month' ? 30 : 365;
  let startDate = new Date();
  let endDate = new Date();

  // Eğer aktif premium varsa, o üyeliğin bitiş tarihinden devam et
  if (existingPremium && existingPremium.endDate > startDate) {
    startDate = existingPremium.endDate;
    endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + durationInDays);

    // Mevcut premium üyeliği güncelle
    return await UserPremium.findByIdAndUpdate(
      existingPremium._id,
      {
        endDate,
        updatedAt: new Date(),
      },
      { new: true },
    );
  } else {
    // Yeni premium üyelik oluştur
    endDate.setDate(endDate.getDate() + durationInDays);

    return await UserPremium.create({
      user: userId,
      type: planType,
      duration,
      startDate,
      endDate,
      status: 'active',
    });
  }
};

/**
 * Bekleyen premium üyelik oluştur
 * @param {ObjectId} userId - Kullanıcı ID
 * @param {String} planType - Plan türü
 * @param {String} duration - Süre
 * @param {Object} existingPremium - Mevcut premium üyelik
 * @returns {Promise<Object>} Premium üyelik
 */
const createPendingPremiumMembership = async (userId, planType, duration, existingPremium) => {
  // Süre hesapla
  const durationInDays = duration === 'month' ? 30 : 365;
  let startDate = new Date();
  let endDate = new Date();

  // Eğer aktif premium varsa, o üyeliğin bitiş tarihinden devam et
  if (existingPremium && existingPremium.endDate > startDate) {
    startDate = existingPremium.endDate;
    endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + durationInDays);
  } else {
    // Yeni bitiş tarihi
    endDate.setDate(endDate.getDate() + durationInDays);
  }

  // Bekleyen premium üyelik oluştur
  return await UserPremium.create({
    user: userId,
    type: planType,
    duration,
    startDate,
    endDate,
    status: 'pending',
  });
};

/**
 * Özel coin miktarını hesapla
 * @param {Number} amount - Para miktarı
 * @param {String} currency - Para birimi
 * @returns {Number} Coin miktarı
 */
const calculateCustomCoinAmount = (amount, currency) => {
  // Döviz kurlarına göre hesaplama (varsayımsal)
  const rates = {
    USD: 100, // 1 USD = 100 coin
    EUR: 110, // 1 EUR = 110 coin
    GBP: 130, // 1 GBP = 130 coin
  };

  return Math.floor(amount * rates[currency]);
};

/**
 * Premium fiyatını hesapla
 * @param {String} planType - Plan türü
 * @param {String} duration - Süre
 * @returns {Object} Fiyat bilgileri
 */
const calculatePremiumPrice = (planType, duration) => {
  // Varsayımsal fiyat yapısı
  const prices = {
    standard: {
      month: { USD: 5.99, EUR: 5.99, GBP: 4.99, coins: 600 },
      year: { USD: 59.99, EUR: 59.99, GBP: 49.99, coins: 6000 },
    },
    gold: {
      month: { USD: 8.99, EUR: 8.99, GBP: 7.99, coins: 900 },
      year: { USD: 89.99, EUR: 89.99, GBP: 79.99, coins: 9000 },
    },
    platinum: {
      month: { USD: 12.99, EUR: 12.99, GBP: 11.99, coins: 1300 },
      year: { USD: 129.99, EUR: 129.99, GBP: 119.99, coins: 13000 },
    },
  };

  return {
    amount: prices[planType][duration].USD,
    currency: 'USD',
    coinPrice: prices[planType][duration].coins,
  };
};

/**
 * Ödeme webhook'unu doğrula
 * @param {Object} req - Request objesi
 * @returns {Boolean} Webhook'un geçerli olup olmadığı
 */
const validatePaymentWebhook = (req) => {
  // Gerçek uygulamada, ödeme sağlayıcısından gelen webhook'un
  // imzasını doğrulama işlemi burada yapılır
  // Örnek: Stripe'ın imza doğrulama mekanizması

  const signature = req.headers['x-payment-signature'];
  if (!signature) {
    return false;
  }

  // Burada gerçek bir imza doğrulama algoritması kullanılmalıdır
  // Geliştirme için basit bir kontrol
  const webhookSecret = process.env.PAYMENT_WEBHOOK_SECRET || 'test_webhook_secret';

  // Simülasyon amaçlı basit doğrulama
  if (process.env.NODE_ENV === 'development') {
    return true;
  }

  try {
    // Gerçek bir uygulamada burada imza doğrulaması yapılır
    // Örnek: Stripe veya PayPal'ın imza doğrulama mekanizması
    return true;
  } catch (error) {
    console.error('Webhook imza doğrulama hatası:', error);
    return false;
  }
};

/**
 * Fatura PDF oluştur
 * @param {Object} invoiceData - Fatura verileri
 * @returns {Promise<Buffer>} PDF buffer
 */
const generateInvoicePDF = async (invoiceData) => {
  // Burada gerçek bir PDF oluşturma kütüphanesi kullanılmalıdır
  // Örnek: PDFKit, html-pdf, puppeteer vb.

  // Simülasyon amaçlı
  return Buffer.from(
    'Bu bir simülasyon fatura içeriğidir. Gerçek uygulamada burada bir PDF olacaktır.',
  );
};

module.exports = {
  getUserTransactions,
  getTransaction,
  purchaseCoins,
  purchasePremium,
  giveAward,
  giftPremium,
  initiateRefund,
  getCoinSummary,
  handlePaymentWebhook,
  generateInvoice,
  getAdminTransactionStats,
};
