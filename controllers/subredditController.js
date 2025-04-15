const {
  Subreddit,
  Post,
  SubredditMembership,
  User,
  SubredditRule,
  Flair,
  ModLog,
  Report,
} = require('../models');
const mongoose = require('mongoose');

/**
 * @desc    Yeni subreddit oluştur
 * @route   POST /api/subreddits
 * @access  Private
 */
const createSubreddit = async (req, res) => {
  try {
    const { name, title, description, type = 'public', nsfw = false } = req.body;
    const userId = req.user._id;

    // Subreddit adı validasyonu
    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Subreddit adı zorunludur',
      });
    }

    // Subreddit adı formatını kontrol et (Reddit formatı)
    const nameRegex = /^[a-zA-Z0-9_]{3,21}$/;
    if (!nameRegex.test(name)) {
      return res.status(400).json({
        success: false,
        message:
          'Subreddit adı yalnızca harfler, rakamlar ve alt çizgi içerebilir ve 3-21 karakter arasında olmalıdır',
      });
    }

    // Subreddit başlığı kontrolü
    if (!title || !title.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Subreddit başlığı zorunludur',
      });
    }

    // Zaten var mı kontrol et
    const existingSubreddit = await Subreddit.findOne({ name: name.toLowerCase() });
    if (existingSubreddit) {
      return res.status(400).json({
        success: false,
        message: 'Bu isimde bir subreddit zaten mevcut',
      });
    }

    // Tipi kontrol et
    if (!['public', 'restricted', 'private'].includes(type)) {
      return res.status(400).json({
        success: false,
        message: 'Geçersiz subreddit türü. public, restricted veya private olmalıdır',
      });
    }

    // Kullanıcının oluşturabileceği maksimum subreddit sayısını kontrol et
    const userSubreddits = await SubredditMembership.countDocuments({
      user: userId,
      status: 'admin',
    });

    // Kullanıcı başına max 10 subreddit sınırı
    const MAX_SUBREDDITS_PER_USER = 10;
    if (userSubreddits >= MAX_SUBREDDITS_PER_USER) {
      return res.status(403).json({
        success: false,
        message: `Bir kullanıcı maksimum ${MAX_SUBREDDITS_PER_USER} subreddit oluşturabilir`,
      });
    }

    // Yeni subreddit oluştur
    const subreddit = new Subreddit({
      name: name.toLowerCase(),
      title: title,
      description: description || '',
      createdBy: userId,
      type: type,
      nsfw: nsfw,
    });

    await subreddit.save();

    // Kullanıcıyı admin olarak ekle
    await SubredditMembership.create({
      user: userId,
      subreddit: subreddit._id,
      status: 'admin',
      joinedAt: Date.now(),
    });

    // Abone sayısını güncelle
    subreddit.subscriberCount = 1;
    await subreddit.save();

    // Varsayılan kuralları ekle
    await SubredditRule.create({
      subreddit: subreddit._id,
      title: 'Nazik ve saygılı olun',
      description: 'Topluluğun tüm üyelerine saygılı davranın. Taciz veya zorbalık tolere edilmez.',
      order: 1,
    });

    await SubredditRule.create({
      subreddit: subreddit._id,
      title: 'Spam yapmayın',
      description: 'İstenmeyen reklamlar veya tekrarlayan içerikler paylaşmayın.',
      order: 2,
    });

    // Varsayılan flairleri ekle
    const defaultFlairs = [
      { text: 'Tartışma', color: '#FF4500', backgroundColor: '#FFE9E3' },
      { text: 'Soru', color: '#0079D3', backgroundColor: '#E2F0FF' },
      { text: 'Haber', color: '#00A651', backgroundColor: '#E6F7EE' },
    ];

    for (const flair of defaultFlairs) {
      await Flair.create({
        subreddit: subreddit._id,
        text: flair.text,
        color: flair.color,
        backgroundColor: flair.backgroundColor,
      });
    }

    res.status(201).json({
      success: true,
      message: 'Subreddit başarıyla oluşturuldu',
      data: subreddit,
    });
  } catch (error) {
    console.error('Create subreddit error:', error);
    res.status(500).json({
      success: false,
      message: 'Subreddit oluşturulurken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * @desc    Tüm subredditleri getir
 * @route   GET /api/subreddits
 * @access  Public
 */
const getAllSubreddits = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const { sort = 'subscribers', type, query } = req.query;

    // Filtreleme seçenekleri
    const filter = { status: 'active' };

    // İsim/başlık/açıklama araması
    if (query) {
      filter.$or = [
        { name: { $regex: query, $options: 'i' } },
        { title: { $regex: query, $options: 'i' } },
        { description: { $regex: query, $options: 'i' } },
      ];
    }

    // Tür filtresi
    if (type && ['public', 'restricted', 'private'].includes(type)) {
      filter.type = type;
    }

    // Sıralama seçenekleri
    let sortOptions = {};
    switch (sort) {
      case 'new':
        sortOptions = { createdAt: -1 };
        break;
      case 'old':
        sortOptions = { createdAt: 1 };
        break;
      case 'subscribers':
        sortOptions = { subscriberCount: -1 };
        break;
      case 'name':
        sortOptions = { name: 1 };
        break;
      default:
        sortOptions = { subscriberCount: -1 };
    }

    const subreddits = await Subreddit.find(filter)
      .select('name title description type nsfw icon banner subscriberCount postCount createdAt')
      .skip(skip)
      .limit(limit)
      .sort(sortOptions);

    const totalSubreddits = await Subreddit.countDocuments(filter);

    res.status(200).json({
      success: true,
      count: subreddits.length,
      total: totalSubreddits,
      totalPages: Math.ceil(totalSubreddits / limit),
      currentPage: page,
      data: subreddits,
    });
  } catch (error) {
    console.error('Get all subreddits error:', error);
    res.status(500).json({
      success: false,
      message: 'Subredditler getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * @desc    Subreddit detaylarını getir
 * @route   GET /api/subreddits/:name
 * @access  Public
 */
const getSubredditByName = async (req, res) => {
  try {
    const { name } = req.params;
    const userId = req.user ? req.user._id : null;

    const subreddit = await Subreddit.findOne({ name: name.toLowerCase(), status: 'active' })
      .select('-__v')
      .populate('createdBy', 'username');

    if (!subreddit) {
      return res.status(404).json({
        success: false,
        message: 'Subreddit bulunamadı',
      });
    }

    // Kullanıcı giriş yapmışsa, üyelik bilgilerini ekle
    let userMembership = null;
    if (userId) {
      userMembership = await SubredditMembership.findOne({
        user: userId,
        subreddit: subreddit._id,
      }).select('status joinedAt');
    }

    // Subreddit kurallarını getir
    const rules = await SubredditRule.find({
      subreddit: subreddit._id,
    }).sort({ order: 1 });

    // Subreddit moderatörlerini getir
    const moderators = await SubredditMembership.find({
      subreddit: subreddit._id,
      status: { $in: ['moderator', 'admin'] },
    })
      .populate('user', 'username profilePicture displayName')
      .select('user status joinedAt');

    // Subreddit flairlerini getir
    const flairs = await Flair.find({
      subreddit: subreddit._id,
    }).sort({ text: 1 });

    // Son güncellenmiş post tarihini bul
    const lastPost = await Post.findOne({
      subreddit: subreddit._id,
      isDeleted: false,
      isRemoved: false,
    })
      .sort({ createdAt: -1 })
      .select('createdAt');

    const result = {
      ...subreddit.toObject(),
      rules,
      moderators,
      flairs,
      lastPostAt: lastPost ? lastPost.createdAt : null,
      userMembership,
    };

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('Get subreddit error:', error);
    res.status(500).json({
      success: false,
      message: 'Subreddit bilgileri getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * @desc    Subreddit güncelle
 * @route   PUT /api/subreddits/:name
 * @access  Private (Admin/Moderator)
 */
const updateSubreddit = async (req, res) => {
  try {
    const { name } = req.params;
    const userId = req.user._id;
    const {
      title,
      description,
      type,
      nsfw,
      icon,
      banner,
      primaryColor,
      backgroundColor,
      allowPolls,
      allowImages,
      allowVideos,
      allowLinks,
    } = req.body;

    const subreddit = await Subreddit.findOne({ name: name.toLowerCase() });

    if (!subreddit) {
      return res.status(404).json({
        success: false,
        message: 'Subreddit bulunamadı',
      });
    }

    // Kullanıcının yetkisini kontrol et
    const membership = await SubredditMembership.findOne({
      user: userId,
      subreddit: subreddit._id,
      status: { $in: ['admin', 'moderator'] },
    });

    if (!membership) {
      return res.status(403).json({
        success: false,
        message: 'Bu subredditi düzenlemek için yetkiniz yok',
      });
    }

    // NSFW ve tür ayarlarını yalnızca admin değiştirebilir
    if ((nsfw !== undefined || type !== undefined) && membership.status !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'NSFW ve tür ayarlarını yalnızca topluluk kurucusu değiştirebilir',
      });
    }

    // Güncellenebilir alanlar
    if (title !== undefined) subreddit.title = title;
    if (description !== undefined) subreddit.description = description;
    if (type !== undefined && ['public', 'restricted', 'private'].includes(type))
      subreddit.type = type;
    if (nsfw !== undefined) subreddit.nsfw = nsfw;
    if (icon !== undefined) subreddit.icon = icon;
    if (banner !== undefined) subreddit.banner = banner;
    if (primaryColor !== undefined) subreddit.primaryColor = primaryColor;
    if (backgroundColor !== undefined) subreddit.backgroundColor = backgroundColor;
    if (allowPolls !== undefined) subreddit.postTypes.polls = allowPolls;
    if (allowImages !== undefined) subreddit.postTypes.images = allowImages;
    if (allowVideos !== undefined) subreddit.postTypes.videos = allowVideos;
    if (allowLinks !== undefined) subreddit.postTypes.links = allowLinks;

    await subreddit.save();

    // Moderatör log'u tut
    await ModLog.create({
      subreddit: subreddit._id,
      moderator: userId,
      action: 'update_settings',
      details: 'Subreddit ayarları güncellendi',
    });

    res.status(200).json({
      success: true,
      message: 'Subreddit başarıyla güncellendi',
      data: subreddit,
    });
  } catch (error) {
    console.error('Update subreddit error:', error);
    res.status(500).json({
      success: false,
      message: 'Subreddit güncellenirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * @desc    Subreddit'e üye ol/üyelikten ayrıl
 * @route   POST /api/subreddits/:name/join
 * @access  Private
 */
const toggleJoinSubreddit = async (req, res) => {
  try {
    const { name } = req.params;
    const userId = req.user._id;
    const { join } = req.body; // true: katıl, false: ayrıl

    const subreddit = await Subreddit.findOne({ name: name.toLowerCase() });

    if (!subreddit) {
      return res.status(404).json({
        success: false,
        message: 'Subreddit bulunamadı',
      });
    }

    // Private subreddit'e katılma kontrolü
    if (join && subreddit.type === 'private') {
      return res.status(403).json({
        success: false,
        message:
          'Bu özel bir topluluktur. Katılmak için moderatörlerle iletişime geçmeniz gerekiyor',
      });
    }

    // Kullanıcının mevcut üyeliğini kontrol et
    const existingMembership = await SubredditMembership.findOne({
      user: userId,
      subreddit: subreddit._id,
    });

    // Kullanıcı banlanmışsa katılamaz
    if (existingMembership && existingMembership.status === 'banned') {
      return res.status(403).json({
        success: false,
        message: 'Bu topluluktan banlandınız, katılamazsınız',
      });
    }

    // Join true ise katıl, false ise ayrıl
    if (join) {
      // Zaten üye mi?
      if (
        existingMembership &&
        ['member', 'moderator', 'admin'].includes(existingMembership.status)
      ) {
        return res.status(400).json({
          success: false,
          message: 'Zaten bu topluluğa üyesiniz',
        });
      }

      // Yeni üye oluştur veya mevcut durumu güncelle
      if (existingMembership) {
        existingMembership.status = 'member';
        existingMembership.joinedAt = Date.now();
        await existingMembership.save();
      } else {
        await SubredditMembership.create({
          user: userId,
          subreddit: subreddit._id,
          status: 'member',
          joinedAt: Date.now(),
        });
      }

      // Abone sayısını güncelle
      subreddit.subscriberCount = (subreddit.subscriberCount || 0) + 1;
      await subreddit.save();

      res.status(200).json({
        success: true,
        message: 'Topluluğa başarıyla katıldınız',
        status: 'member',
      });
    } else {
      // Zaten üye değil mi?
      if (!existingMembership || !['member', 'moderator'].includes(existingMembership.status)) {
        return res.status(400).json({
          success: false,
          message: 'Bu topluluğa zaten üye değilsiniz',
        });
      }

      // Admin ayrılamaz
      if (existingMembership.status === 'admin') {
        return res.status(403).json({
          success: false,
          message: 'Topluluk yöneticisi olarak ayrılamazsınız',
        });
      }

      // Üyeliği güncelle
      await SubredditMembership.deleteOne({
        user: userId,
        subreddit: subreddit._id,
      });

      // Abone sayısını güncelle
      subreddit.subscriberCount = Math.max(0, (subreddit.subscriberCount || 1) - 1);
      await subreddit.save();

      res.status(200).json({
        success: true,
        message: 'Topluluktan başarıyla ayrıldınız',
        status: 'none',
      });
    }
  } catch (error) {
    console.error('Toggle join subreddit error:', error);
    res.status(500).json({
      success: false,
      message: 'Topluluk üyeliği işlemi sırasında bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * @desc    Kullanıcıyı moderatör olarak ekle
 * @route   POST /api/subreddits/:name/moderators
 * @access  Private (Admin)
 */
const addModerator = async (req, res) => {
  try {
    const { name } = req.params;
    const { username } = req.body;
    const adminId = req.user._id;

    if (!username) {
      return res.status(400).json({
        success: false,
        message: 'Kullanıcı adı zorunludur',
      });
    }

    const subreddit = await Subreddit.findOne({ name: name.toLowerCase() });
    if (!subreddit) {
      return res.status(404).json({
        success: false,
        message: 'Subreddit bulunamadı',
      });
    }

    // Admin yetkisini kontrol et
    const adminMembership = await SubredditMembership.findOne({
      user: adminId,
      subreddit: subreddit._id,
      status: 'admin',
    });

    if (!adminMembership) {
      return res.status(403).json({
        success: false,
        message: 'Bu işlem için yönetici yetkiniz yok',
      });
    }

    // Eklenecek kullanıcıyı bul
    const userToAdd = await User.findOne({ username });
    if (!userToAdd) {
      return res.status(404).json({
        success: false,
        message: 'Kullanıcı bulunamadı',
      });
    }

    // Kullanıcının mevcut üyeliğini kontrol et
    const existingMembership = await SubredditMembership.findOne({
      user: userToAdd._id,
      subreddit: subreddit._id,
    });

    if (existingMembership && existingMembership.status === 'banned') {
      return res.status(400).json({
        success: false,
        message: 'Bu kullanıcı topluluktan banlanmış, moderatör olarak eklenemez',
      });
    }

    if (existingMembership && existingMembership.status === 'admin') {
      return res.status(400).json({
        success: false,
        message: 'Bu kullanıcı zaten topluluk yöneticisi',
      });
    }

    if (existingMembership && existingMembership.status === 'moderator') {
      return res.status(400).json({
        success: false,
        message: 'Bu kullanıcı zaten bir moderatör',
      });
    }

    // Moderatör ekle veya mevcut durumu güncelle
    if (existingMembership) {
      existingMembership.status = 'moderator';
      await existingMembership.save();
    } else {
      await SubredditMembership.create({
        user: userToAdd._id,
        subreddit: subreddit._id,
        status: 'moderator',
        joinedAt: Date.now(),
      });

      // Üye değilse, abone sayısını artır
      subreddit.subscriberCount = (subreddit.subscriberCount || 0) + 1;
      await subreddit.save();
    }

    // Moderatör log'u tut
    await ModLog.create({
      subreddit: subreddit._id,
      moderator: adminId,
      targetType: 'user',
      targetId: userToAdd._id,
      action: 'add_moderator',
      details: `${username} kullanıcısı moderatör olarak eklendi`,
    });

    // Kullanıcıya bildirim gönder
    await Notification.create({
      recipient: userToAdd._id,
      type: 'mod_add',
      message: `r/${subreddit.name} topluluğuna moderatör olarak eklendiniz`,
      subreddit: subreddit._id,
    });

    res.status(200).json({
      success: true,
      message: `${username} başarıyla moderatör olarak eklendi`,
    });
  } catch (error) {
    console.error('Add moderator error:', error);
    res.status(500).json({
      success: false,
      message: 'Moderatör eklenirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * @desc    Kullanıcıyı moderatörlükten çıkar
 * @route   DELETE /api/subreddits/:name/moderators/:userId
 * @access  Private (Admin)
 */
const removeModerator = async (req, res) => {
  try {
    const { name, userId } = req.params;
    const adminId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: 'Geçersiz kullanıcı ID formatı',
      });
    }

    const subreddit = await Subreddit.findOne({ name: name.toLowerCase() });
    if (!subreddit) {
      return res.status(404).json({
        success: false,
        message: 'Subreddit bulunamadı',
      });
    }

    // Admin yetkisini kontrol et
    const adminMembership = await SubredditMembership.findOne({
      user: adminId,
      subreddit: subreddit._id,
      status: 'admin',
    });

    if (!adminMembership) {
      return res.status(403).json({
        success: false,
        message: 'Bu işlem için yönetici yetkiniz yok',
      });
    }

    // Moderatör üyeliğini kontrol et
    const modMembership = await SubredditMembership.findOne({
      user: userId,
      subreddit: subreddit._id,
      status: 'moderator',
    });

    if (!modMembership) {
      return res.status(404).json({
        success: false,
        message: 'Bu kullanıcı bir moderatör değil',
      });
    }

    // Kullanıcı bilgilerini al
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Kullanıcı bulunamadı',
      });
    }

    // Moderatörlükten çıkar, normal üye yap
    modMembership.status = 'member';
    await modMembership.save();

    // Moderatör log'u tut
    await ModLog.create({
      subreddit: subreddit._id,
      moderator: adminId,
      targetType: 'user',
      targetId: userId,
      action: 'remove_moderator',
      details: `${user.username} kullanıcısı moderatörlükten çıkarıldı`,
    });

    // Kullanıcıya bildirim gönder
    await Notification.create({
      recipient: userId,
      type: 'mod_remove',
      message: `r/${subreddit.name} topluluğundaki moderatör yetkiniz kaldırıldı`,
      subreddit: subreddit._id,
    });

    res.status(200).json({
      success: true,
      message: `${user.username} başarıyla moderatörlükten çıkarıldı`,
    });
  } catch (error) {
    console.error('Remove moderator error:', error);
    res.status(500).json({
      success: false,
      message: 'Moderatör çıkarılırken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * @desc    Kullanıcıyı banla/ban kaldır
 * @route   POST /api/subreddits/:name/ban
 * @access  Private (Moderator/Admin)
 */
const toggleBanUser = async (req, res) => {
  try {
    const { name } = req.params;
    const { username, reason, duration, unban = false } = req.body;
    const modId = req.user._id;

    if (!username) {
      return res.status(400).json({
        success: false,
        message: 'Kullanıcı adı zorunludur',
      });
    }

    const subreddit = await Subreddit.findOne({ name: name.toLowerCase() });
    if (!subreddit) {
      return res.status(404).json({
        success: false,
        message: 'Subreddit bulunamadı',
      });
    }

    // Moderatör yetkisini kontrol et
    const modMembership = await SubredditMembership.findOne({
      user: modId,
      subreddit: subreddit._id,
      status: { $in: ['moderator', 'admin'] },
    });

    if (!modMembership) {
      return res.status(403).json({
        success: false,
        message: 'Bu işlem için moderatör yetkiniz yok',
      });
    }

    // Banlanacak kullanıcıyı bul
    const userToBan = await User.findOne({ username });
    if (!userToBan) {
      return res.status(404).json({
        success: false,
        message: 'Kullanıcı bulunamadı',
      });
    }

    // Moderatör kendi kendini banlayamaz
    if (userToBan._id.toString() === modId.toString()) {
      return res.status(400).json({
        success: false,
        message: 'Kendinizi banlayamazsınız',
      });
    }

    // Banlanacak kullanıcının moderatör/admin olup olmadığını kontrol et
    const targetMembership = await SubredditMembership.findOne({
      user: userToBan._id,
      subreddit: subreddit._id,
    });

    // Moderatör, başka bir moderatörü veya admini banlayamaz
    if (
      targetMembership &&
      ['moderator', 'admin'].includes(targetMembership.status) &&
      modMembership.status !== 'admin'
    ) {
      return res.status(403).json({
        success: false,
        message: 'Moderatör veya admin kullanıcıları sadece topluluk yöneticisi banlayabilir',
      });
    }

    // Ban kaldırma işlemi
    if (unban) {
      if (!targetMembership || targetMembership.status !== 'banned') {
        return res.status(400).json({
          success: false,
          message: 'Bu kullanıcı zaten banlanmamış',
        });
      }

      // Ban kaldır, üye yap
      targetMembership.status = 'member';
      targetMembership.banReason = null;
      targetMembership.banExpireAt = null;
      await targetMembership.save();

      // Moderatör log'u tut
      await ModLog.create({
        subreddit: subreddit._id,
        moderator: modId,
        targetType: 'user',
        targetId: userToBan._id,
        action: 'unban_user',
        details: `${username} kullanıcısının banı kaldırıldı`,
      });

      // Kullanıcıya bildirim gönder
      await Notification.create({
        recipient: userToBan._id,
        type: 'unban',
        message: `r/${subreddit.name} topluluğundaki banınız kaldırıldı`,
        subreddit: subreddit._id,
      });

      return res.status(200).json({
        success: true,
        message: `${username} kullanıcısının banı başarıyla kaldırıldı`,
      });
    }

    // Yeni ban işlemi
    if (!reason) {
      return res.status(400).json({
        success: false,
        message: 'Ban nedeni belirtilmelidir',
      });
    }

    // Ban süresi hesapla
    let banExpireAt = null;
    if (duration && duration !== 'permanent') {
      banExpireAt = new Date();

      if (duration === '1d') {
        banExpireAt.setDate(banExpireAt.getDate() + 1);
      } else if (duration === '3d') {
        banExpireAt.setDate(banExpireAt.getDate() + 3);
      } else if (duration === '7d') {
        banExpireAt.setDate(banExpireAt.getDate() + 7);
      } else if (duration === '30d') {
        banExpireAt.setDate(banExpireAt.getDate() + 30);
      }
    }

    // Ban işlemini uygula
    if (targetMembership) {
      targetMembership.status = 'banned';
      targetMembership.banReason = reason;
      targetMembership.banExpireAt = banExpireAt;
      targetMembership.bannedBy = modId;
      targetMembership.bannedAt = Date.now();
      await targetMembership.save();
    } else {
      await SubredditMembership.create({
        user: userToBan._id,
        subreddit: subreddit._id,
        status: 'banned',
        banReason: reason,
        banExpireAt: banExpireAt,
        bannedBy: modId,
        bannedAt: Date.now(),
      });
    }

    // Moderatör log'u tut
    await ModLog.create({
      subreddit: subreddit._id,
      moderator: modId,
      targetType: 'user',
      targetId: userToBan._id,
      action: 'ban_user',
      details: `${username} kullanıcısı banlandı. Neden: ${reason}`,
    });

    // Kullanıcıya bildirim gönder
    await Notification.create({
      recipient: userToBan._id,
      type: 'ban',
      message: `r/${subreddit.name} topluluğundan banlandınız. Neden: ${reason}`,
      subreddit: subreddit._id,
    });

    res.status(200).json({
      success: true,
      message: `${username} kullanıcısı başarıyla banlandı`,
    });
  } catch (error) {
    console.error('Toggle ban user error:', error);
    res.status(500).json({
      success: false,
      message: 'Kullanıcı ban işlemi sırasında bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * @desc    Subreddit kuralı ekle
 * @route   POST /api/subreddits/:name/rules
 * @access  Private (Moderator/Admin)
 */
const addSubredditRule = async (req, res) => {
  try {
    const { name } = req.params;
    const { title, description } = req.body;
    const modId = req.user._id;

    if (!title || !title.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Kural başlığı zorunludur',
      });
    }

    const subreddit = await Subreddit.findOne({ name: name.toLowerCase() });
    if (!subreddit) {
      return res.status(404).json({
        success: false,
        message: 'Subreddit bulunamadı',
      });
    }

    // Moderatör yetkisini kontrol et
    const modMembership = await SubredditMembership.findOne({
      user: modId,
      subreddit: subreddit._id,
      status: { $in: ['moderator', 'admin'] },
    });

    if (!modMembership) {
      return res.status(403).json({
        success: false,
        message: 'Bu işlem için moderatör yetkiniz yok',
      });
    }

    // Mevcut kuralların sayısını kontrol et (max 15 kural)
    const rulesCount = await SubredditRule.countDocuments({ subreddit: subreddit._id });
    if (rulesCount >= 15) {
      return res.status(400).json({
        success: false,
        message: 'Bir topluluk en fazla 15 kurala sahip olabilir',
      });
    }

    // En son kural sırasını bul
    const lastRule = await SubredditRule.findOne({ subreddit: subreddit._id })
      .sort({ order: -1 })
      .select('order');

    const nextOrder = lastRule ? lastRule.order + 1 : 1;

    // Yeni kuralı oluştur
    const newRule = await SubredditRule.create({
      subreddit: subreddit._id,
      title: title,
      description: description || '',
      order: nextOrder,
    });

    // Moderatör log'u tut
    await ModLog.create({
      subreddit: subreddit._id,
      moderator: modId,
      action: 'add_rule',
      details: `"${title}" kuralı eklendi`,
    });

    res.status(201).json({
      success: true,
      message: 'Kural başarıyla eklendi',
      data: newRule,
    });
  } catch (error) {
    console.error('Add subreddit rule error:', error);
    res.status(500).json({
      success: false,
      message: 'Kural eklenirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * @desc    Subreddit kuralı güncelle
 * @route   PUT /api/subreddits/:name/rules/:ruleId
 * @access  Private (Moderator/Admin)
 */
const updateSubredditRule = async (req, res) => {
  try {
    const { name, ruleId } = req.params;
    const { title, description, order } = req.body;
    const modId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(ruleId)) {
      return res.status(400).json({
        success: false,
        message: 'Geçersiz kural ID formatı',
      });
    }

    const subreddit = await Subreddit.findOne({ name: name.toLowerCase() });
    if (!subreddit) {
      return res.status(404).json({
        success: false,
        message: 'Subreddit bulunamadı',
      });
    }

    // Moderatör yetkisini kontrol et
    const modMembership = await SubredditMembership.findOne({
      user: modId,
      subreddit: subreddit._id,
      status: { $in: ['moderator', 'admin'] },
    });

    if (!modMembership) {
      return res.status(403).json({
        success: false,
        message: 'Bu işlem için moderatör yetkiniz yok',
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

    // Kuralı güncelle
    if (title !== undefined && title.trim()) rule.title = title;
    if (description !== undefined) rule.description = description;
    if (order !== undefined && Number.isInteger(order) && order > 0) rule.order = order;

    await rule.save();

    // Moderatör log'u tut
    await ModLog.create({
      subreddit: subreddit._id,
      moderator: modId,
      action: 'update_rule',
      details: `"${rule.title}" kuralı güncellendi`,
    });

    res.status(200).json({
      success: true,
      message: 'Kural başarıyla güncellendi',
      data: rule,
    });
  } catch (error) {
    console.error('Update subreddit rule error:', error);
    res.status(500).json({
      success: false,
      message: 'Kural güncellenirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * @desc    Subreddit kuralı sil
 * @route   DELETE /api/subreddits/:name/rules/:ruleId
 * @access  Private (Moderator/Admin)
 */
const deleteSubredditRule = async (req, res) => {
  try {
    const { name, ruleId } = req.params;
    const modId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(ruleId)) {
      return res.status(400).json({
        success: false,
        message: 'Geçersiz kural ID formatı',
      });
    }

    const subreddit = await Subreddit.findOne({ name: name.toLowerCase() });
    if (!subreddit) {
      return res.status(404).json({
        success: false,
        message: 'Subreddit bulunamadı',
      });
    }

    // Moderatör yetkisini kontrol et
    const modMembership = await SubredditMembership.findOne({
      user: modId,
      subreddit: subreddit._id,
      status: { $in: ['moderator', 'admin'] },
    });

    if (!modMembership) {
      return res.status(403).json({
        success: false,
        message: 'Bu işlem için moderatör yetkiniz yok',
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

    const ruleTitle = rule.title;

    // Kuralı sil
    await rule.remove();

    // Moderatör log'u tut
    await ModLog.create({
      subreddit: subreddit._id,
      moderator: modId,
      action: 'delete_rule',
      details: `"${ruleTitle}" kuralı silindi`,
    });

    res.status(200).json({
      success: true,
      message: 'Kural başarıyla silindi',
    });
  } catch (error) {
    console.error('Delete subreddit rule error:', error);
    res.status(500).json({
      success: false,
      message: 'Kural silinirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * @desc    Flair ekle
 * @route   POST /api/subreddits/:name/flairs
 * @access  Private (Moderator/Admin)
 */
const addFlair = async (req, res) => {
  try {
    const { name } = req.params;
    const { text, color, backgroundColor, isUserAssignable = true } = req.body;
    const modId = req.user._id;

    if (!text || !text.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Flair metni zorunludur',
      });
    }

    const subreddit = await Subreddit.findOne({ name: name.toLowerCase() });
    if (!subreddit) {
      return res.status(404).json({
        success: false,
        message: 'Subreddit bulunamadı',
      });
    }

    // Moderatör yetkisini kontrol et
    const modMembership = await SubredditMembership.findOne({
      user: modId,
      subreddit: subreddit._id,
      status: { $in: ['moderator', 'admin'] },
    });

    if (!modMembership) {
      return res.status(403).json({
        success: false,
        message: 'Bu işlem için moderatör yetkiniz yok',
      });
    }

    // Mevcut flairlerin sayısını kontrol et (max 50 flair)
    const flairsCount = await Flair.countDocuments({
      subreddit: subreddit._id,
      type: 'post',
    });

    if (flairsCount >= 50) {
      return res.status(400).json({
        success: false,
        message: "Bir topluluk en fazla 50 flair'e sahip olabilir",
      });
    }

    // Aynı metinde flair var mı kontrol et
    const existingFlair = await Flair.findOne({
      subreddit: subreddit._id,
      text: text,
      type: 'post',
    });

    if (existingFlair) {
      return res.status(400).json({
        success: false,
        message: 'Bu metinde bir flair zaten mevcut',
      });
    }

    // Yeni flair oluştur
    const newFlair = await Flair.create({
      subreddit: subreddit._id,
      type: 'post',
      text: text,
      color: color || '#FFFFFF',
      backgroundColor: backgroundColor || '#FF4500',
      isUserAssignable,
    });

    // Moderatör log'u tut
    await ModLog.create({
      subreddit: subreddit._id,
      moderator: modId,
      action: 'add_flair',
      details: `"${text}" flair'i eklendi`,
    });

    res.status(201).json({
      success: true,
      message: 'Flair başarıyla eklendi',
      data: newFlair,
    });
  } catch (error) {
    console.error('Add flair error:', error);
    res.status(500).json({
      success: false,
      message: 'Flair eklenirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * @desc    Moderatör loglarını getir
 * @route   GET /api/subreddits/:name/modlogs
 * @access  Private (Moderator/Admin)
 */
const getModLogs = async (req, res) => {
  try {
    const { name } = req.params;
    const { action, moderator } = req.query;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const userId = req.user._id;

    const subreddit = await Subreddit.findOne({ name: name.toLowerCase() });
    if (!subreddit) {
      return res.status(404).json({
        success: false,
        message: 'Subreddit bulunamadı',
      });
    }

    // Moderatör yetkisini kontrol et
    const modMembership = await SubredditMembership.findOne({
      user: userId,
      subreddit: subreddit._id,
      status: { $in: ['moderator', 'admin'] },
    });

    if (!modMembership) {
      return res.status(403).json({
        success: false,
        message: 'Bu işlem için moderatör yetkiniz yok',
      });
    }

    // Filtreleme seçenekleri
    const filter = { subreddit: subreddit._id };

    if (action) {
      filter.action = action;
    }

    if (moderator) {
      // Moderatör kullanıcı adına göre filtrele
      const modUser = await User.findOne({ username: moderator });
      if (modUser) {
        filter.moderator = modUser._id;
      } else {
        // Kullanıcı bulunamadıysa boş sonuç döndür
        return res.status(200).json({
          success: true,
          count: 0,
          total: 0,
          totalPages: 0,
          currentPage: page,
          data: [],
        });
      }
    }

    // Logları getir
    const logs = await ModLog.find(filter)
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 })
      .populate('moderator', 'username')
      .populate('targetId', 'username title content'); // Username (users), title (posts), content (comments)

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
    console.error('Get mod logs error:', error);
    res.status(500).json({
      success: false,
      message: 'Moderatör logları getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

module.exports = {
  createSubreddit,
  getAllSubreddits,
  getSubredditByName,
  updateSubreddit,
  toggleJoinSubreddit,
  addModerator,
  removeModerator,
  toggleBanUser,
  addSubredditRule,
  updateSubredditRule,
  deleteSubredditRule,
  addFlair,
  getModLogs,
};
