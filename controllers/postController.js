const {
  Post,
  Comment,
  Subreddit,
  Vote,
  SavedItem,
  User,
  SubredditMembership,
  Report,
  Award,
} = require('../models');
const mongoose = require('mongoose');

/**
 * @desc    Yeni gönderi oluştur
 * @route   POST /api/posts
 * @access  Private
 */
const createPost = async (req, res) => {
  try {
    const {
      title,
      content,
      subredditName,
      type = 'text', // text, link, image, video
      url,
      nsfw = false,
      spoiler = false,
      flair,
      tags,
    } = req.body;

    // Gerekli alanları kontrol et
    if (!title) {
      return res.status(400).json({
        success: false,
        message: 'Başlık alanı zorunludur',
      });
    }

    if (!subredditName) {
      return res.status(400).json({
        success: false,
        message: 'Subreddit alanı zorunludur',
      });
    }

    // Subreddit'i bul
    const subreddit = await Subreddit.findOne({ name: subredditName.toLowerCase() });
    if (!subreddit) {
      return res.status(404).json({
        success: false,
        message: 'Subreddit bulunamadı',
      });
    }

    // Kullanıcının ban durumunu kontrol et
    const membership = await SubredditMembership.findOne({
      user: req.user._id,
      subreddit: subreddit._id,
    });

    if (membership && membership.status === 'banned') {
      return res.status(403).json({
        success: false,
        message: "Bu subreddit'ten banlandınız, gönderi oluşturamazsınız",
      });
    }

    // İçerik türüne göre validasyon
    if (type === 'text' && !content) {
      return res.status(400).json({
        success: false,
        message: 'Text türündeki gönderiler için içerik zorunludur',
      });
    }

    if (type === 'link' && !url) {
      return res.status(400).json({
        success: false,
        message: 'Link türündeki gönderiler için URL zorunludur',
      });
    }

    // Flairı kontrol et (eğer belirtilmişse)
    let flairId = null;
    if (flair) {
      const flairExists = await Flair.findOne({
        _id: flair,
        subreddit: subreddit._id,
      });

      if (!flairExists) {
        return res.status(404).json({
          success: false,
          message: 'Belirtilen flair bulunamadı',
        });
      }
      flairId = flair;
    }

    // Yeni gönderi oluştur
    const post = new Post({
      title,
      content,
      type,
      url,
      author: req.user._id,
      subreddit: subreddit._id,
      nsfw,
      spoiler,
      flair: flairId,
      tags: tags || [],
    });

    await post.save();

    // Subreddit'in post sayısını güncelle
    subreddit.postCount = (subreddit.postCount || 0) + 1;
    await subreddit.save();

    // Diğer gerekli alanlarla birlikte doldur
    await post.populate('author', 'username profilePicture displayName');
    await post.populate('subreddit', 'name title icon color');
    if (flairId) {
      await post.populate('flair', 'text color backgroundColor');
    }
    if (tags && tags.length > 0) {
      await post.populate('tags', 'name color');
    }

    res.status(201).json({
      success: true,
      message: 'Gönderi başarıyla oluşturuldu',
      data: post,
    });
  } catch (error) {
    console.error('Post creation error:', error);
    res.status(500).json({
      success: false,
      message: 'Gönderi oluşturulurken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * @desc    Tüm gönderileri getir (Admin için)
 * @route   GET /api/posts
 * @access  Private/Admin
 */
const getAllPosts = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const { sort = 'new', filter } = req.query;

    // Admin kontrolü
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Bu işlem için admin yetkisi gereklidir',
      });
    }

    // Filtreleme seçenekleri
    let filterOptions = { isDeleted: false };

    if (filter === 'removed') {
      filterOptions.isRemoved = true;
    } else if (filter === 'reported') {
      // Rapor edilmiş gönderileri bul
      const reportedPostIds = await Report.distinct('post', { resolved: false });
      filterOptions._id = { $in: reportedPostIds };
    } else if (filter === 'nsfw') {
      filterOptions.nsfw = true;
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
      case 'top':
        sortOptions = { voteScore: -1 };
        break;
      case 'reported':
        sortOptions = { reportCount: -1 };
        break;
      default:
        sortOptions = { createdAt: -1 };
    }

    const posts = await Post.find(filterOptions)
      .skip(skip)
      .limit(limit)
      .sort(sortOptions)
      .populate('author', 'username profilePicture displayName')
      .populate('subreddit', 'name title')
      .populate('flair', 'text color backgroundColor');

    const totalPosts = await Post.countDocuments(filterOptions);

    res.status(200).json({
      success: true,
      count: posts.length,
      total: totalPosts,
      totalPages: Math.ceil(totalPosts / limit),
      currentPage: page,
      data: posts,
    });
  } catch (error) {
    console.error('Get all posts error:', error);
    res.status(500).json({
      success: false,
      message: 'Gönderiler getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * @desc    Gönderi detaylarını getir
 * @route   GET /api/posts/:postId
 * @access  Public
 */
const getPostById = async (req, res) => {
  try {
    const { postId } = req.params;
    const userId = req.user ? req.user._id : null;

    if (!mongoose.Types.ObjectId.isValid(postId)) {
      return res.status(400).json({
        success: false,
        message: 'Geçersiz gönderi ID formatı',
      });
    }

    const post = await Post.findById(postId)
      .populate('author', 'username profilePicture displayName bio createdAt')
      .populate('subreddit', 'name title description icon banner color subscriberCount createdAt')
      .populate('flair', 'text color backgroundColor')
      .populate('tags', 'name color');

    if (!post || post.isDeleted) {
      return res.status(404).json({
        success: false,
        message: 'Gönderi bulunamadı',
      });
    }

    // Kullanıcı giriş yapmışsa ek bilgiler ekle
    if (userId) {
      // Kullanıcının oy bilgisi
      const userVote = await Vote.findOne({
        post: postId,
        user: userId,
      }).select('voteType');

      // Kullanıcının kaydetme durumu
      const isSaved = await SavedItem.exists({
        itemId: postId,
        itemType: 'post',
        user: userId,
      });

      // Kullanıcının subreddit üyelik durumu
      const membership = await SubredditMembership.findOne({
        user: userId,
        subreddit: post.subreddit._id,
      }).select('status');

      // Yanıta ek bilgileri ekle
      post._doc.userVote = userVote ? userVote.voteType : null;
      post._doc.isSaved = !!isSaved;
      post._doc.userMembership = membership ? membership.status : null;
    }

    // Görüntülenme sayısını arttır
    post.viewCount = (post.viewCount || 0) + 1;
    await post.save();

    res.status(200).json({
      success: true,
      data: post,
    });
  } catch (error) {
    console.error('Get post error:', error);
    res.status(500).json({
      success: false,
      message: 'Gönderi getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * @desc    Gönderiyi güncelle
 * @route   PUT /api/posts/:postId
 * @access  Private (Sadece gönderi sahibi veya moderatör)
 */
const updatePost = async (req, res) => {
  try {
    const { postId } = req.params;
    const userId = req.user._id;
    const { title, content, nsfw, spoiler, flair, tags, moderatorNote } = req.body;

    if (!mongoose.Types.ObjectId.isValid(postId)) {
      return res.status(400).json({
        success: false,
        message: 'Geçersiz gönderi ID formatı',
      });
    }

    // Gönderiyi bul
    const post = await Post.findById(postId).populate('subreddit', 'name');

    if (!post || post.isDeleted) {
      return res.status(404).json({
        success: false,
        message: 'Gönderi bulunamadı',
      });
    }

    // Kullanıcının yetkisini kontrol et
    const isAuthor = post.author.toString() === userId.toString();
    const isModerator = await SubredditMembership.exists({
      user: userId,
      subreddit: post.subreddit._id,
      status: { $in: ['moderator', 'admin'] },
    });

    // Sadece yazar veya moderatör düzenleyebilir
    if (!isAuthor && !isModerator) {
      return res.status(403).json({
        success: false,
        message: 'Bu gönderiyi düzenleme yetkiniz yok',
      });
    }

    // Yazarlar sadece belirli alanları değiştirebilir
    if (isAuthor && !isModerator) {
      // Gönderi 5 dakikadan eski ise içerik düzenlenemez (Reddit stili)
      const editTimeLimit = 5 * 60 * 1000; // 5 dakika
      const isEditable = Date.now() - post.createdAt < editTimeLimit;

      if (!isEditable) {
        return res.status(403).json({
          success: false,
          message: 'Gönderi düzenleme süresi dolmuştur (5 dakika)',
        });
      }

      // Yazarların düzenleyebileceği alanlar
      if (content !== undefined) post.content = content;
      if (nsfw !== undefined) post.nsfw = nsfw;
      if (spoiler !== undefined) post.spoiler = spoiler;

      post.isEdited = true;
      post.lastEditedAt = Date.now();
    }
    // Moderatörler diğer alanları da düzenleyebilir
    else if (isModerator) {
      if (title !== undefined) post.title = title;
      if (content !== undefined) post.content = content;
      if (nsfw !== undefined) post.nsfw = nsfw;
      if (spoiler !== undefined) post.spoiler = spoiler;
      if (flair !== undefined) post.flair = flair;
      if (tags !== undefined) post.tags = tags;

      // Moderatör işlemi ise log tut
      if (moderatorNote) {
        await ModLog.create({
          subreddit: post.subreddit._id,
          moderator: userId,
          targetType: 'post',
          targetId: postId,
          action: 'edit',
          reason: moderatorNote,
        });
      }

      post.isEdited = true;
      post.lastEditedAt = Date.now();
    }

    await post.save();

    // Güncellenmiş gönderiyi döndür
    await post.populate('author', 'username profilePicture displayName');
    await post.populate('subreddit', 'name title icon color');
    if (post.flair) {
      await post.populate('flair', 'text color backgroundColor');
    }
    if (post.tags && post.tags.length > 0) {
      await post.populate('tags', 'name color');
    }

    res.status(200).json({
      success: true,
      message: 'Gönderi başarıyla güncellendi',
      data: post,
    });
  } catch (error) {
    console.error('Update post error:', error);
    res.status(500).json({
      success: false,
      message: 'Gönderi güncellenirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * @desc    Gönderiyi sil (soft delete)
 * @route   DELETE /api/posts/:postId
 * @access  Private (Sadece gönderi sahibi veya moderatör)
 */
const deletePost = async (req, res) => {
  try {
    const { postId } = req.params;
    const userId = req.user._id;
    const { reason } = req.body;

    if (!mongoose.Types.ObjectId.isValid(postId)) {
      return res.status(400).json({
        success: false,
        message: 'Geçersiz gönderi ID formatı',
      });
    }

    // Gönderiyi bul
    const post = await Post.findById(postId).populate('subreddit', 'name');

    if (!post || post.isDeleted) {
      return res.status(404).json({
        success: false,
        message: 'Gönderi bulunamadı',
      });
    }

    // Kullanıcının yetkisini kontrol et
    const isAuthor = post.author.toString() === userId.toString();
    const isModerator = await SubredditMembership.exists({
      user: userId,
      subreddit: post.subreddit._id,
      status: { $in: ['moderator', 'admin'] },
    });

    // Sadece yazar veya moderatör silebilir
    if (!isAuthor && !isModerator) {
      return res.status(403).json({
        success: false,
        message: 'Bu gönderiyi silme yetkiniz yok',
      });
    }

    // Moderatör veya admin siliyorsa, "removed" olarak işaretle
    if (isModerator && !isAuthor) {
      post.isRemoved = true;
      post.removedAt = Date.now();
      post.removedBy = userId;
      post.removalReason = reason || 'Moderatör tarafından kaldırıldı';

      // Moderatör log'u tut
      await ModLog.create({
        subreddit: post.subreddit._id,
        moderator: userId,
        targetType: 'post',
        targetId: postId,
        action: 'remove',
        reason: reason || 'Moderatör tarafından kaldırıldı',
      });
    }
    // Kullanıcı kendi gönderisini siliyorsa, "deleted" olarak işaretle
    else if (isAuthor) {
      post.isDeleted = true;
      post.deletedAt = Date.now();
      post.deletedBy = userId;
    }

    await post.save();

    res.status(200).json({
      success: true,
      message: isAuthor ? 'Gönderi başarıyla silindi' : 'Gönderi başarıyla kaldırıldı',
    });
  } catch (error) {
    console.error('Delete post error:', error);
    res.status(500).json({
      success: false,
      message: 'Gönderi silinirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * @desc    Gönderiyi sabit/sabit değil yap (subreddit üstünde)
 * @route   PATCH /api/posts/:postId/pin
 * @access  Private/Moderator
 */
const togglePinPost = async (req, res) => {
  try {
    const { postId } = req.params;
    const userId = req.user._id;
    const { isPinned } = req.body;

    if (!mongoose.Types.ObjectId.isValid(postId)) {
      return res.status(400).json({
        success: false,
        message: 'Geçersiz gönderi ID formatı',
      });
    }

    // Gönderiyi bul
    const post = await Post.findById(postId).populate('subreddit', 'name');

    if (!post || post.isDeleted || post.isRemoved) {
      return res.status(404).json({
        success: false,
        message: 'Gönderi bulunamadı',
      });
    }

    // Kullanıcının moderatör olup olmadığını kontrol et
    const isModerator = await SubredditMembership.exists({
      user: userId,
      subreddit: post.subreddit._id,
      status: { $in: ['moderator', 'admin'] },
    });

    if (!isModerator) {
      return res.status(403).json({
        success: false,
        message: 'Bu işlem için moderatör yetkiniz yok',
      });
    }

    // Gönderiyi sabitle/sabitlemeyi kaldır
    post.isPinned = isPinned === undefined ? !post.isPinned : isPinned;
    await post.save();

    // Moderatör log'u tut
    await ModLog.create({
      subreddit: post.subreddit._id,
      moderator: userId,
      targetType: 'post',
      targetId: postId,
      action: post.isPinned ? 'pin' : 'unpin',
      reason: post.isPinned ? 'Gönderi sabitlendi' : 'Gönderi sabitleme kaldırıldı',
    });

    res.status(200).json({
      success: true,
      message: post.isPinned
        ? 'Gönderi başarıyla sabitlendi'
        : 'Gönderi sabitleme başarıyla kaldırıldı',
      data: { isPinned: post.isPinned },
    });
  } catch (error) {
    console.error('Toggle pin post error:', error);
    res.status(500).json({
      success: false,
      message: 'Gönderi sabitlenirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * @desc    Gönderiyi kilitle/kilidini aç (yorumlara kapatma)
 * @route   PATCH /api/posts/:postId/lock
 * @access  Private/Moderator
 */
const toggleLockPost = async (req, res) => {
  try {
    const { postId } = req.params;
    const userId = req.user._id;
    const { isLocked, reason } = req.body;

    if (!mongoose.Types.ObjectId.isValid(postId)) {
      return res.status(400).json({
        success: false,
        message: 'Geçersiz gönderi ID formatı',
      });
    }

    // Gönderiyi bul
    const post = await Post.findById(postId).populate('subreddit', 'name');

    if (!post || post.isDeleted || post.isRemoved) {
      return res.status(404).json({
        success: false,
        message: 'Gönderi bulunamadı',
      });
    }

    // Kullanıcının moderatör olup olmadığını kontrol et
    const isModerator = await SubredditMembership.exists({
      user: userId,
      subreddit: post.subreddit._id,
      status: { $in: ['moderator', 'admin'] },
    });

    if (!isModerator) {
      return res.status(403).json({
        success: false,
        message: 'Bu işlem için moderatör yetkiniz yok',
      });
    }

    // Gönderiyi kilitle/kilidini aç
    post.isLocked = isLocked === undefined ? !post.isLocked : isLocked;
    post.lockReason = post.isLocked ? reason || 'Moderatör tarafından kilitlendi' : null;
    await post.save();

    // Moderatör log'u tut
    await ModLog.create({
      subreddit: post.subreddit._id,
      moderator: userId,
      targetType: 'post',
      targetId: postId,
      action: post.isLocked ? 'lock' : 'unlock',
      reason: reason || (post.isLocked ? 'Gönderi kilitlendi' : 'Gönderi kilidi açıldı'),
    });

    res.status(200).json({
      success: true,
      message: post.isLocked ? 'Gönderi başarıyla kilitlendi' : 'Gönderi kilidi başarıyla açıldı',
      data: {
        isLocked: post.isLocked,
        lockReason: post.lockReason,
      },
    });
  } catch (error) {
    console.error('Toggle lock post error:', error);
    res.status(500).json({
      success: false,
      message: 'Gönderi kilitlenirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * @desc    Gönderi yorumlarını getir
 * @route   GET /api/posts/:postId/comments
 * @access  Public
 */
const getPostComments = async (req, res) => {
  try {
    const { postId } = req.params;
    const { sort = 'top' } = req.query;
    const userId = req.user ? req.user._id : null;

    if (!mongoose.Types.ObjectId.isValid(postId)) {
      return res.status(400).json({
        success: false,
        message: 'Geçersiz gönderi ID formatı',
      });
    }

    // Gönderiyi kontrol et
    const postExists = await Post.exists({
      _id: postId,
      isDeleted: false,
    });

    if (!postExists) {
      return res.status(404).json({
        success: false,
        message: 'Gönderi bulunamadı',
      });
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
      case 'top':
        sortOptions = { voteScore: -1 };
        break;
      case 'controversial':
        sortOptions = { controversyScore: -1 };
        break;
      default:
        sortOptions = { voteScore: -1 };
    }

    // Yalnızca üst düzey yorumları getir (parentId olmayan)
    const comments = await Comment.find({
      post: postId,
      parentId: null,
      isDeleted: false,
      isRemoved: false,
    })
      .sort(sortOptions)
      .populate('author', 'username profilePicture displayName')
      .lean();

    // Her bir yorum için alt yorumları ve kullanıcı oylarını ekle
    const commentsWithReplies = await Promise.all(
      comments.map(async (comment) => {
        // Alt yorum sayısını ekle
        const replyCount = await Comment.countDocuments({
          parentId: comment._id,
          isDeleted: false,
          isRemoved: false,
        });

        comment.replyCount = replyCount;

        // Kullanıcı giriş yapmışsa, oy bilgisini ekle
        if (userId) {
          const userVote = await Vote.findOne({
            comment: comment._id,
            user: userId,
          }).select('voteType');

          comment.userVote = userVote ? userVote.voteType : null;
        }

        return comment;
      }),
    );

    res.status(200).json({
      success: true,
      count: commentsWithReplies.length,
      data: commentsWithReplies,
    });
  } catch (error) {
    console.error('Get post comments error:', error);
    res.status(500).json({
      success: false,
      message: 'Yorumlar getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * @desc    Gönderiye ödül ver
 * @route   POST /api/posts/:postId/award
 * @access  Private
 */
const awardPost = async (req, res) => {
  try {
    const { postId } = req.params;
    const { awardType, message, anonymous = false } = req.body;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(postId)) {
      return res.status(400).json({
        success: false,
        message: 'Geçersiz gönderi ID formatı',
      });
    }

    // Gönderiyi bul
    const post = await Post.findById(postId)
      .populate('author', 'username')
      .populate('subreddit', 'name');

    if (!post || post.isDeleted) {
      return res.status(404).json({
        success: false,
        message: 'Gönderi bulunamadı',
      });
    }

    // Ödül türünü kontrol et
    const validAwards = [
      'silver',
      'gold',
      'platinum',
      'helpful',
      'wholesome',
      'rocket',
      'heartwarming',
    ];
    if (!validAwards.includes(awardType)) {
      return res.status(400).json({
        success: false,
        message: 'Geçersiz ödül türü',
      });
    }

    // Kullanıcının yeterli coin'i var mı kontrol et
    const user = await User.findById(userId);
    const awardCosts = {
      silver: 100,
      gold: 500,
      platinum: 1800,
      helpful: 150,
      wholesome: 125,
      rocket: 300,
      heartwarming: 200,
    };

    const cost = awardCosts[awardType];
    if (user.coins < cost) {
      return res.status(400).json({
        success: false,
        message: 'Yetersiz coin bakiyesi',
        required: cost,
        available: user.coins,
      });
    }

    // Kullanıcının coin'lerini düş
    user.coins -= cost;
    user.karma.awarder += Math.floor(cost / 10); // 10 coin = 1 karma
    await user.save();

    // Ödülü kaydet
    const newAward = await Award.create({
      type: awardType,
      sender: anonymous ? null : userId,
      receiver: post.author._id,
      post: postId,
      message: message || null,
      anonymous: anonymous,
    });

    // Post'un ödül sayısını güncelle
    post.awardCount = (post.awardCount || 0) + 1;
    await post.save();

    // Alıcıya ödül karması ve coin ver
    const awardValues = {
      silver: { karma: 10, coins: 0 },
      gold: { karma: 100, coins: 100 },
      platinum: { karma: 700, coins: 700 },
      helpful: { karma: 20, coins: 0 },
      wholesome: { karma: 20, coins: 0 },
      rocket: { karma: 50, coins: 0 },
      heartwarming: { karma: 30, coins: 0 },
    };

    const receiver = await User.findById(post.author._id);
    receiver.karma.awardee += awardValues[awardType].karma;
    receiver.coins += awardValues[awardType].coins;
    await receiver.save();

    // Bildirim oluştur (anonim değilse)
    if (!anonymous) {
      await Notification.create({
        recipient: post.author._id,
        sender: userId,
        type: 'award',
        relatedPost: postId,
        message: `Gönderiniz "${post.title.substring(0, 30)}${post.title.length > 30 ? '...' : ''}" bir ${awardType} ödülü aldı!`,
      });
    } else {
      await Notification.create({
        recipient: post.author._id,
        type: 'award',
        relatedPost: postId,
        message: `Gönderiniz "${post.title.substring(0, 30)}${post.title.length > 30 ? '...' : ''}" anonim bir kullanıcıdan ${awardType} ödülü aldı!`,
      });
    }

    res.status(200).json({
      success: true,
      message: 'Ödül başarıyla verildi',
      data: newAward,
      userCoins: user.coins,
    });
  } catch (error) {
    console.error('Award post error:', error);
    res.status(500).json({
      success: false,
      message: 'Ödül verilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * @desc    Kullanıcının gönderilerini getir
 * @route   GET /api/posts/user/:username
 * @access  Public
 */
const getPostsByUser = async (req, res) => {
  try {
    const { username } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const { sort = 'new' } = req.query;

    // Kullanıcıyı bul
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Kullanıcı bulunamadı',
      });
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
      case 'top':
        sortOptions = { voteScore: -1 };
        break;
      case 'comments':
        sortOptions = { commentCount: -1 };
        break;
      default:
        sortOptions = { createdAt: -1 };
    }

    // Kullanıcının gönderilerini bul
    const posts = await Post.find({
      author: user._id,
      isDeleted: false,
    })
      .skip(skip)
      .limit(limit)
      .sort(sortOptions)
      .populate('author', 'username profilePicture displayName')
      .populate('subreddit', 'name icon color')
      .populate('flair', 'text color backgroundColor');

    const totalPosts = await Post.countDocuments({
      author: user._id,
      isDeleted: false,
    });

    res.status(200).json({
      success: true,
      count: posts.length,
      total: totalPosts,
      totalPages: Math.ceil(totalPosts / limit),
      currentPage: page,
      data: posts,
    });
  } catch (error) {
    console.error('Get user posts error:', error);
    res.status(500).json({
      success: false,
      message: 'Kullanıcı gönderileri getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * @desc    Bir subreddit'teki gönderileri getir
 * @route   GET /api/posts/subreddit/:subredditName
 * @access  Public
 */
const getPostsBySubreddit = async (req, res) => {
  try {
    const { subredditName } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 25;
    const skip = (page - 1) * limit;
    const { sort = 'hot', timeRange } = req.query;
    const userId = req.user ? req.user._id : null;

    // Subreddit'i bul
    const subreddit = await Subreddit.findOne({ name: subredditName.toLowerCase() });
    if (!subreddit) {
      return res.status(404).json({
        success: false,
        message: 'Subreddit bulunamadı',
      });
    }

    // Zaman aralığı filtresini belirle
    let dateFilter = {};
    if (timeRange) {
      const now = new Date();
      let startDate;

      switch (timeRange) {
        case 'hour':
          startDate = new Date(now.getTime() - 60 * 60 * 1000);
          break;
        case 'day':
          startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
          break;
        case 'week':
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case 'month':
          startDate = new Date(now.setMonth(now.getMonth() - 1));
          break;
        case 'year':
          startDate = new Date(now.setFullYear(now.getFullYear() - 1));
          break;
        default:
          startDate = null;
      }

      if (startDate) {
        dateFilter = { createdAt: { $gte: startDate } };
      }
    }

    // Sıralama seçenekleri
    let sortOptions = {};
    switch (sort) {
      case 'new':
        sortOptions = { createdAt: -1 };
        break;
      case 'rising':
        sortOptions = { upvoteRatio: -1, createdAt: -1 };
        break;
      case 'top':
        sortOptions = { voteScore: -1, createdAt: -1 };
        break;
      case 'comments':
        sortOptions = { commentCount: -1, createdAt: -1 };
        break;
      case 'hot':
      default:
        sortOptions = { hotScore: -1, createdAt: -1 };
        break;
    }

    // Subreddit'teki gönderileri bul
    const filterOptions = {
      subreddit: subreddit._id,
      isDeleted: false,
      isRemoved: false,
      ...dateFilter,
    };

    // Önce sabitlenmiş gönderileri al (eğer hot veya new sıralama ise)
    let pinnedPosts = [];
    if (sort === 'hot' || sort === 'new') {
      pinnedPosts = await Post.find({
        ...filterOptions,
        isPinned: true,
      })
        .populate('author', 'username profilePicture displayName')
        .populate('subreddit', 'name icon color')
        .populate('flair', 'text color backgroundColor')
        .sort({ createdAt: -1 })
        .lean();
    }

    // Normal gönderileri al
    const posts = await Post.find({
      ...filterOptions,
      isPinned: { $ne: true },
    })
      .skip(skip)
      .limit(limit)
      .sort(sortOptions)
      .populate('author', 'username profilePicture displayName')
      .populate('subreddit', 'name icon color')
      .populate('flair', 'text color backgroundColor')
      .lean();

    // Kullanıcı giriş yapmışsa, oy bilgilerini ekle
    if (userId) {
      const combinedPosts = [...pinnedPosts, ...posts];
      const postIds = combinedPosts.map((post) => post._id);

      const userVotes = await Vote.find({
        user: userId,
        post: { $in: postIds },
      }).select('post voteType');

      const voteMap = new Map();
      userVotes.forEach((vote) => {
        voteMap.set(vote.post.toString(), vote.voteType);
      });

      // Her gönderi için kullanıcının oyunu ekle
      combinedPosts.forEach((post) => {
        post.userVote = voteMap.get(post._id.toString()) || null;
      });
    }

    const totalPosts = await Post.countDocuments(filterOptions);

    // Sonuçları birleştir (önce sabitlenmiş, sonra normal gönderiler)
    const allPosts = [...pinnedPosts, ...posts];

    res.status(200).json({
      success: true,
      count: allPosts.length,
      total: totalPosts,
      totalPages: Math.ceil(totalPosts / limit),
      currentPage: page,
      data: allPosts,
    });
  } catch (error) {
    console.error('Get subreddit posts error:', error);
    res.status(500).json({
      success: false,
      message: 'Subreddit gönderileri getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * @desc    Bir gönderiyi raporla
 * @route   POST /api/posts/:postId/report
 * @access  Private
 */
const reportPost = async (req, res) => {
  try {
    const { postId } = req.params;
    const { reason, details } = req.body;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(postId)) {
      return res.status(400).json({
        success: false,
        message: 'Geçersiz gönderi ID formatı',
      });
    }

    if (!reason) {
      return res.status(400).json({
        success: false,
        message: 'Raporlama nedeni belirtilmelidir',
      });
    }

    // Gönderiyi kontrol et
    const post = await Post.findById(postId).populate('subreddit', 'name');
    if (!post || post.isDeleted) {
      return res.status(404).json({
        success: false,
        message: 'Gönderi bulunamadı',
      });
    }

    // Kullanıcının daha önce bu gönderiyi raporlayıp raporlamadığını kontrol et
    const existingReport = await Report.findOne({
      reporter: userId,
      post: postId,
    });

    if (existingReport) {
      return res.status(400).json({
        success: false,
        message: 'Bu gönderiyi zaten raporladınız',
      });
    }

    // Yeni rapor oluştur
    const report = await Report.create({
      type: 'post',
      post: postId,
      reporter: userId,
      subreddit: post.subreddit._id,
      reason,
      details: details || '',
    });

    // Gönderi rapor sayısını güncelle
    post.reportCount = (post.reportCount || 0) + 1;
    await post.save();

    res.status(201).json({
      success: true,
      message: 'Gönderi başarıyla raporlandı',
      data: {
        reportId: report._id,
      },
    });
  } catch (error) {
    console.error('Report post error:', error);
    res.status(500).json({
      success: false,
      message: 'Gönderi raporlanırken bir hata oluştu',
      error: error.message,
    });
  }
};

module.exports = {
  createPost,
  getAllPosts,
  getPostById,
  updatePost,
  deletePost,
  togglePinPost,
  toggleLockPost,
  getPostComments,
  awardPost,
  getPostsByUser,
  getPostsBySubreddit,
  reportPost,
};
