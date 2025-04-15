const { Award, Post, Comment, User, Notification } = require('../models');

/**
 * Tüm ödül tiplerini listele
 * @route GET /api/awards/types
 * @access Public
 */
const getAwardTypes = async (req, res) => {
  try {
    // Ödül tiplerini manuel olarak tanımlayalım (gerçek sistemde veritabanından gelebilir)
    const awardTypes = [
      {
        id: 'silver',
        name: 'Silver',
        description: 'Gümüş Ödül - Teşekkür etmenin bir yolu',
        icon: '/images/awards/silver.png',
        price: 100,
        benefits: {
          karma: 10,
          coins: 0,
          premium: 0,
        },
      },
      {
        id: 'gold',
        name: 'Gold',
        description: 'Altın Ödül - Bir hafta Premium üyelik kazandırır',
        icon: '/images/awards/gold.png',
        price: 500,
        benefits: {
          karma: 50,
          coins: 100,
          premium: 7, // 7 gün
        },
      },
      {
        id: 'platinum',
        name: 'Platinum',
        description: 'Platin Ödül - Bir ay Premium üyelik kazandırır',
        icon: '/images/awards/platinum.png',
        price: 1800,
        benefits: {
          karma: 100,
          coins: 700,
          premium: 30, // 30 gün
        },
      },
      {
        id: 'wholesome',
        name: 'Wholesome',
        description: 'İçten ve samimi içerikler için',
        icon: '/images/awards/wholesome.png',
        price: 150,
        benefits: {
          karma: 15,
          coins: 0,
          premium: 0,
        },
      },
      {
        id: 'helpful',
        name: 'Helpful',
        description: 'Yardımcı olan içerikler için',
        icon: '/images/awards/helpful.png',
        price: 150,
        benefits: {
          karma: 15,
          coins: 0,
          premium: 0,
        },
      },
    ];

    res.status(200).json({
      success: true,
      data: awardTypes,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Ödül tipleri getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * İçeriğe (post/comment) ödül ver
 * @route POST /api/awards
 * @access Private
 */
const giveAward = async (req, res) => {
  try {
    const { itemType, itemId, awardType, message, isAnonymous } = req.body;
    const userId = req.user._id;

    // Ödül veren kullanıcıyı getir (coin durumunu kontrol etmek için)
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Kullanıcı bulunamadı',
      });
    }

    // Ödül tipini doğrula
    const awardTypes = await getValidAwardTypes();
    const selectedAward = awardTypes.find((award) => award.id === awardType);

    if (!selectedAward) {
      return res.status(400).json({
        success: false,
        message: 'Geçersiz ödül tipi',
      });
    }

    // Kullanıcının yeterli coini var mı kontrol et
    if (user.coins < selectedAward.price) {
      return res.status(400).json({
        success: false,
        message: "Yeterli miktarda coin'iniz bulunmamaktadır",
      });
    }

    // İçeriği ve yazarını bul
    let targetItem;
    let authorId;
    let subredditId;

    if (itemType === 'post') {
      targetItem = await Post.findById(itemId);
      if (targetItem) {
        authorId = targetItem.author;
        subredditId = targetItem.subreddit;
      }
    } else if (itemType === 'comment') {
      targetItem = await Comment.findById(itemId);
      if (targetItem) {
        authorId = targetItem.author;

        // Yorumun bağlı olduğu postu bul
        const post = await Post.findById(targetItem.post);
        if (post) {
          subredditId = post.subreddit;
        }
      }
    } else {
      return res.status(400).json({
        success: false,
        message: 'Geçersiz içerik türü. "post" veya "comment" olmalıdır.',
      });
    }

    if (!targetItem) {
      return res.status(404).json({
        success: false,
        message: 'Ödül verilecek içerik bulunamadı',
      });
    }

    // Kullanıcının kendi içeriğine ödül verip vermediğini kontrol et
    if (authorId.toString() === userId.toString()) {
      return res.status(400).json({
        success: false,
        message: 'Kendinize ödül veremezsiniz',
      });
    }

    // Ödülü oluştur
    const award = await Award.create({
      type: awardType,
      giver: userId,
      recipient: authorId,
      itemType,
      [itemType]: itemId,
      subreddit: subredditId,
      message: message || '',
      isAnonymous: isAnonymous || false,
    });

    // Kullanıcının coinlerini azalt
    await User.findByIdAndUpdate(userId, {
      $inc: {
        coins: -selectedAward.price,
        'karma.awarder': 1, // Ödül verince karma puanı artar
      },
    });

    // Ödül alan kullanıcıya karmasını ve coinlerini ekle
    await User.findByIdAndUpdate(authorId, {
      $inc: {
        'karma.awardee': selectedAward.benefits.karma,
        totalKarma: selectedAward.benefits.karma,
        coins: selectedAward.benefits.coins,
      },
    });

    // Premium üyelik günü varsa ekle
    if (selectedAward.benefits.premium > 0) {
      const recipient = await User.findById(authorId);
      let premiumExpiresAt = recipient.premiumExpiresAt || new Date();

      // Eğer zaten premium üyelik varsa üzerine ekle, yoksa şimdiden başlat
      if (premiumExpiresAt < new Date()) {
        premiumExpiresAt = new Date();
      }

      premiumExpiresAt.setDate(premiumExpiresAt.getDate() + selectedAward.benefits.premium);

      await User.findByIdAndUpdate(authorId, {
        isPremium: true,
        premiumExpiresAt,
      });
    }

    // İçeriğe ödül sayısını ekle
    if (itemType === 'post') {
      await Post.findByIdAndUpdate(itemId, {
        $inc: { awardCount: 1 },
        $push: { awards: award._id },
      });
    } else {
      await Comment.findByIdAndUpdate(itemId, {
        $inc: { awardCount: 1 },
        $push: { awards: award._id },
      });
    }

    // Ödül alan kullanıcıya bildirim gönder
    await Notification.create({
      type: 'award',
      recipient: authorId,
      sender: isAnonymous ? null : userId,
      message: `${itemType === 'post' ? 'Gönderiniz' : 'Yorumunuz'} ${selectedAward.name} ödülü aldı!`,
      relatedAward: award._id,
      [itemType === 'post' ? 'relatedPost' : 'relatedComment']: itemId,
    });

    res.status(201).json({
      success: true,
      message: 'Ödül başarıyla verildi',
      data: award,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Ödül verilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * İçeriğe verilen ödülleri listele
 * @route GET /api/:itemType/:itemId/awards
 * @access Public
 */
const getItemAwards = async (req, res) => {
  try {
    const { itemType, itemId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    if (!['post', 'comment'].includes(itemType)) {
      return res.status(400).json({
        success: false,
        message: 'Geçersiz içerik türü. "post" veya "comment" olmalıdır.',
      });
    }

    // Filtreyi oluştur
    const filter = {
      itemType,
      [itemType]: itemId,
    };

    // Ödülleri getir
    const awards = await Award.find(filter)
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 })
      .populate({
        path: 'giver',
        select: 'username profilePicture',
        match: { isAnonymous: false },
      });

    const totalAwards = await Award.countDocuments(filter);

    // Ödül tiplerine göre gruplama yap
    const awardsByType = awards.reduce((acc, award) => {
      if (!acc[award.type]) {
        acc[award.type] = 0;
      }
      acc[award.type]++;
      return acc;
    }, {});

    res.status(200).json({
      success: true,
      count: awards.length,
      total: totalAwards,
      totalPages: Math.ceil(totalAwards / limit),
      currentPage: page,
      awardsByType,
      data: awards,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Ödüller getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * Kullanıcının aldığı ödülleri listele
 * @route GET /api/users/:username/awards/received
 * @access Public
 */
const getUserReceivedAwards = async (req, res) => {
  try {
    const { username } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    // Kullanıcıyı bul
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Kullanıcı bulunamadı',
      });
    }

    // Ödülleri getir
    const awards = await Award.find({ recipient: user._id })
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 })
      .populate({
        path: 'giver',
        select: 'username profilePicture',
      })
      .populate('post', 'title')
      .populate('comment', 'content');

    const totalAwards = await Award.countDocuments({ recipient: user._id });

    res.status(200).json({
      success: true,
      count: awards.length,
      total: totalAwards,
      totalPages: Math.ceil(totalAwards / limit),
      currentPage: page,
      data: awards,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Kullanıcının aldığı ödüller getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * Kullanıcının verdiği ödülleri listele
 * @route GET /api/users/:username/awards/given
 * @access Public
 */
const getUserGivenAwards = async (req, res) => {
  try {
    const { username } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const isCurrentUser = req.user && req.user.username === username;

    // Kullanıcıyı bul
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Kullanıcı bulunamadı',
      });
    }

    // Filtre oluştur
    const filter = { giver: user._id };

    // Eğer kendi profili değilse, sadece anonim olmayan ödülleri göster
    if (!isCurrentUser) {
      filter.isAnonymous = false;
    }

    // Ödülleri getir
    const awards = await Award.find(filter)
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 })
      .populate('recipient', 'username profilePicture')
      .populate('post', 'title')
      .populate('comment', 'content');

    const totalAwards = await Award.countDocuments(filter);

    res.status(200).json({
      success: true,
      count: awards.length,
      total: totalAwards,
      totalPages: Math.ceil(totalAwards / limit),
      currentPage: page,
      data: awards,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Kullanıcının verdiği ödüller getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * Kullanıcının coin satın alması
 * @route POST /api/awards/purchase-coins
 * @access Private
 */
const purchaseCoins = async (req, res) => {
  try {
    const userId = req.user._id;
    const { packageId } = req.body;

    // Coin paketlerini tanımla
    const coinPackages = [
      { id: 'small', amount: 500, price: 1.99, bonus: 0 },
      { id: 'medium', amount: 1100, price: 3.99, bonus: 100 },
      { id: 'large', amount: 3100, price: 7.99, bonus: 600 },
      { id: 'platinum', amount: 7200, price: 19.99, bonus: 1700 },
    ];

    const selectedPackage = coinPackages.find((pack) => pack.id === packageId);

    if (!selectedPackage) {
      return res.status(400).json({
        success: false,
        message: 'Geçersiz coin paketi',
      });
    }

    // Burada ödeme işlemi yapılabilir (örn. Stripe ile)
    // Ödeme başarılı olduktan sonra:

    // Kullanıcıya coinleri ekle
    await User.findByIdAndUpdate(userId, {
      $inc: { coins: selectedPackage.amount },
    });

    // İşlem kaydını oluştur (gerçek uygulamada ödeme geçmişi için)
    // await CoinTransaction.create({
    //   user: userId,
    //   amount: selectedPackage.amount,
    //   packageId,
    //   price: selectedPackage.price,
    //   paymentMethod: req.body.paymentMethod,
    //   paymentId: 'payment-123' // Ödeme sağlayıcıdan gelen ID
    // });

    res.status(200).json({
      success: true,
      message: `${selectedPackage.amount} coin başarıyla satın alındı`,
      data: {
        purchasedCoins: selectedPackage.amount,
        packageId,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Coin satın alınırken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * Geçerli ödül tiplerini getir (internal kullanım için)
 * @returns {Array} awardTypes
 */
const getValidAwardTypes = async () => {
  // Gerçek uygulamada veritabanından alınabilir
  return [
    {
      id: 'silver',
      name: 'Silver',
      price: 100,
      benefits: {
        karma: 10,
        coins: 0,
        premium: 0,
      },
    },
    {
      id: 'gold',
      name: 'Gold',
      price: 500,
      benefits: {
        karma: 50,
        coins: 100,
        premium: 7,
      },
    },
    {
      id: 'platinum',
      name: 'Platinum',
      price: 1800,
      benefits: {
        karma: 100,
        coins: 700,
        premium: 30,
      },
    },
    {
      id: 'wholesome',
      name: 'Wholesome',
      price: 150,
      benefits: {
        karma: 15,
        coins: 0,
        premium: 0,
      },
    },
    {
      id: 'helpful',
      name: 'Helpful',
      price: 150,
      benefits: {
        karma: 15,
        coins: 0,
        premium: 0,
      },
    },
  ];
};

module.exports = {
  getAwardTypes,
  giveAward,
  getItemAwards,
  getUserReceivedAwards,
  getUserGivenAwards,
  purchaseCoins,
};
