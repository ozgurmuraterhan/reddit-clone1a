const {
  Comment,
  Post,
  Vote,
  User,
  SavedItem,
  SubredditMembership,
  ModLog,
  Report,
  Notification,
} = require('../models');
const mongoose = require('mongoose');

/**
 * @desc    Yeni yorum oluştur
 * @route   POST /api/comments
 * @access  Private
 */
const createComment = async (req, res) => {
  try {
    const { content, postId, parentId } = req.body;
    const userId = req.user._id;

    // Gerekli alan kontrolü
    if (!content || !content.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Yorum içeriği zorunludur',
      });
    }

    if (!postId) {
      return res.status(400).json({
        success: false,
        message: 'Post ID zorunludur',
      });
    }

    // Post'un var olup olmadığını kontrol et
    const post = await Post.findById(postId);
    if (!post || post.isDeleted || post.isRemoved) {
      return res.status(404).json({
        success: false,
        message: 'Gönderi bulunamadı',
      });
    }

    // Post kilitlenmişse yorum yapılamaz
    if (post.isLocked) {
      return res.status(403).json({
        success: false,
        message: 'Bu gönderi kilitlenmiş, yorum yapılamaz',
      });
    }

    // Eğer ebeveyn yorum varsa kontrol et
    if (parentId) {
      const parentComment = await Comment.findById(parentId);
      if (!parentComment || parentComment.isDeleted || parentComment.isRemoved) {
        return res.status(404).json({
          success: false,
          message: 'Ebeveyn yorum bulunamadı',
        });
      }

      // Ebeveyn yorumun aynı post'a ait olduğundan emin ol
      if (parentComment.post.toString() !== postId) {
        return res.status(400).json({
          success: false,
          message: 'Ebeveyn yorum belirtilen gönderiye ait değil',
        });
      }
    }

    // Kullanıcının subreddit'ten banlanıp banlanmadığını kontrol et
    const subredditId = post.subreddit;
    const membership = await SubredditMembership.findOne({
      user: userId,
      subreddit: subredditId,
    });

    if (membership && membership.status === 'banned') {
      return res.status(403).json({
        success: false,
        message: 'Bu topluluktan banlandınız, yorum yapamazsınız',
      });
    }

    // Yeni yorumu oluştur
    const newComment = new Comment({
      content,
      author: userId,
      post: postId,
      parentId: parentId || null,
      depth: parentId ? 1 : 0, // Derinlik hesabı daha sonra düzeltilecek
    });

    // Yorum derinliğini hesapla
    if (parentId) {
      const parentComment = await Comment.findById(parentId);
      newComment.depth = (parentComment.depth || 0) + 1;
    }

    await newComment.save();

    // Post'un yorum sayısını güncelle
    post.commentCount = (post.commentCount || 0) + 1;
    await post.save();

    // Yeni oluşturulan yorumu popüle edilmiş şekilde getir
    const populatedComment = await Comment.findById(newComment._id)
      .populate('author', 'username profilePicture displayName')
      .populate({
        path: 'post',
        select: 'title',
        populate: {
          path: 'subreddit',
          select: 'name',
        },
      });

    // Bildirim oluştur (kendi yorumuna yanıt vermiyorsa)
    if (parentId) {
      const parentComment = await Comment.findById(parentId);
      if (parentComment.author.toString() !== userId.toString()) {
        await Notification.create({
          recipient: parentComment.author,
          sender: userId,
          type: 'comment_reply',
          relatedPost: postId,
          relatedComment: newComment._id,
          message: `${req.user.username} yorumunuza yanıt verdi`,
        });
      }
    } else if (post.author.toString() !== userId.toString()) {
      // Ana gönderi sahibine bildirim gönder (kendisi değilse)
      await Notification.create({
        recipient: post.author,
        sender: userId,
        type: 'post_comment',
        relatedPost: postId,
        relatedComment: newComment._id,
        message: `${req.user.username} gönderinize yorum yaptı`,
      });
    }

    // Başarılı yanıt
    res.status(201).json({
      success: true,
      message: 'Yorum başarıyla oluşturuldu',
      data: populatedComment,
    });
  } catch (error) {
    console.error('Create comment error:', error);
    res.status(500).json({
      success: false,
      message: 'Yorum oluşturulurken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * @desc    Yorumu güncelle
 * @route   PUT /api/comments/:commentId
 * @access  Private (Sadece yorum sahibi veya moderatör)
 */
const updateComment = async (req, res) => {
  try {
    const { commentId } = req.params;
    const { content, moderatorNote } = req.body;
    const userId = req.user._id;

    // Geçerli ID kontrolü
    if (!mongoose.Types.ObjectId.isValid(commentId)) {
      return res.status(400).json({
        success: false,
        message: 'Geçersiz yorum ID formatı',
      });
    }

    // Yorumu bul
    const comment = await Comment.findById(commentId).populate({
      path: 'post',
      select: 'subreddit isLocked',
      populate: {
        path: 'subreddit',
        select: 'name',
      },
    });

    if (!comment || comment.isDeleted) {
      return res.status(404).json({
        success: false,
        message: 'Yorum bulunamadı',
      });
    }

    // Yorumun kilitli bir gönderiye ait olup olmadığını kontrol et
    if (comment.post.isLocked) {
      return res.status(403).json({
        success: false,
        message: 'Bu gönderi kilitlenmiş, yorumlar düzenlenemez',
      });
    }

    // Kullanıcının yetkisini kontrol et
    const isAuthor = comment.author.toString() === userId.toString();
    const isModerator = await SubredditMembership.exists({
      user: userId,
      subreddit: comment.post.subreddit._id,
      status: { $in: ['moderator', 'admin'] },
    });

    if (!isAuthor && !isModerator) {
      return res.status(403).json({
        success: false,
        message: 'Bu yorumu düzenleme yetkiniz yok',
      });
    }

    // Yazarlar sadece belirli süre içinde düzenleyebilir
    if (isAuthor && !isModerator) {
      // 5 dakikalık düzenleme süresi (Reddit kuralı)
      const editTimeLimit = 5 * 60 * 1000; // 5 dakika
      const isEditable = Date.now() - comment.createdAt < editTimeLimit;

      if (!isEditable) {
        return res.status(403).json({
          success: false,
          message: 'Yorum düzenleme süresi dolmuştur (5 dakika)',
        });
      }

      // İçeriği güncelle
      if (!content || !content.trim()) {
        return res.status(400).json({
          success: false,
          message: 'Yorum içeriği boş olamaz',
        });
      }

      comment.content = content;
      comment.isEdited = true;
      comment.lastEditedAt = Date.now();
    }
    // Moderatör güncellemesi
    else if (isModerator) {
      if (content !== undefined) {
        comment.content = content;
        comment.isEdited = true;
        comment.lastEditedAt = Date.now();
      }

      // Moderatör işlemi olarak kaydet
      if (moderatorNote) {
        await ModLog.create({
          subreddit: comment.post.subreddit._id,
          moderator: userId,
          targetType: 'comment',
          targetId: commentId,
          action: 'edit',
          reason: moderatorNote,
        });
      }
    }

    await comment.save();

    // Güncellenmiş yorumu getir
    const updatedComment = await Comment.findById(commentId)
      .populate('author', 'username profilePicture displayName')
      .populate({
        path: 'post',
        select: 'title',
        populate: {
          path: 'subreddit',
          select: 'name',
        },
      });

    res.status(200).json({
      success: true,
      message: 'Yorum başarıyla güncellendi',
      data: updatedComment,
    });
  } catch (error) {
    console.error('Update comment error:', error);
    res.status(500).json({
      success: false,
      message: 'Yorum güncellenirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * @desc    Yorumu sil (soft delete)
 * @route   DELETE /api/comments/:commentId
 * @access  Private (Sadece yorum sahibi veya moderatör)
 */
const deleteComment = async (req, res) => {
  try {
    const { commentId } = req.params;
    const { reason } = req.body;
    const userId = req.user._id;

    // Geçerli ID kontrolü
    if (!mongoose.Types.ObjectId.isValid(commentId)) {
      return res.status(400).json({
        success: false,
        message: 'Geçersiz yorum ID formatı',
      });
    }

    // Yorumu bul
    const comment = await Comment.findById(commentId).populate({
      path: 'post',
      select: 'subreddit isLocked',
      populate: {
        path: 'subreddit',
        select: 'name',
      },
    });

    if (!comment || comment.isDeleted) {
      return res.status(404).json({
        success: false,
        message: 'Yorum bulunamadı',
      });
    }

    // Yorumun kilitli bir gönderiye ait olup olmadığını kontrol et
    if (comment.post.isLocked) {
      return res.status(403).json({
        success: false,
        message: 'Bu gönderi kilitlenmiş, yorumlar silinemez',
      });
    }

    // Kullanıcının yetkisini kontrol et
    const isAuthor = comment.author.toString() === userId.toString();
    const isModerator = await SubredditMembership.exists({
      user: userId,
      subreddit: comment.post.subreddit._id,
      status: { $in: ['moderator', 'admin'] },
    });

    if (!isAuthor && !isModerator) {
      return res.status(403).json({
        success: false,
        message: 'Bu yorumu silme yetkiniz yok',
      });
    }

    // Moderatör veya admin siliyorsa, "removed" olarak işaretle
    if (isModerator && !isAuthor) {
      comment.isRemoved = true;
      comment.removedAt = Date.now();
      comment.removedBy = userId;
      comment.removalReason = reason || 'Moderatör tarafından kaldırıldı';

      // Moderatör log'u tut
      await ModLog.create({
        subreddit: comment.post.subreddit._id,
        moderator: userId,
        targetType: 'comment',
        targetId: commentId,
        action: 'remove',
        reason: reason || 'Moderatör tarafından kaldırıldı',
      });
    }
    // Kullanıcı kendi yorumunu siliyorsa, "deleted" olarak işaretle
    else if (isAuthor) {
      comment.isDeleted = true;
      comment.deletedAt = Date.now();
      comment.deletedBy = userId;
    }

    await comment.save();

    res.status(200).json({
      success: true,
      message: isAuthor ? 'Yorum başarıyla silindi' : 'Yorum başarıyla kaldırıldı',
    });
  } catch (error) {
    console.error('Delete comment error:', error);
    res.status(500).json({
      success: false,
      message: 'Yorum silinirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * @desc    Yorum yanıtlarını getir
 * @route   GET /api/comments/:commentId/replies
 * @access  Public
 */
const getCommentReplies = async (req, res) => {
  try {
    const { commentId } = req.params;
    const { sort = 'top' } = req.query;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const userId = req.user ? req.user._id : null;

    // Geçerli ID kontrolü
    if (!mongoose.Types.ObjectId.isValid(commentId)) {
      return res.status(400).json({
        success: false,
        message: 'Geçersiz yorum ID formatı',
      });
    }

    // Ebeveyn yorumu kontrol et
    const parentComment = await Comment.exists({ _id: commentId, isDeleted: false });
    if (!parentComment) {
      return res.status(404).json({
        success: false,
        message: 'Ebeveyn yorum bulunamadı',
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

    // Yanıtları getir
    const replies = await Comment.find({
      parentId: commentId,
      isDeleted: false,
      isRemoved: false,
    })
      .skip(skip)
      .limit(limit)
      .sort(sortOptions)
      .populate('author', 'username profilePicture displayName')
      .lean();

    const totalReplies = await Comment.countDocuments({
      parentId: commentId,
      isDeleted: false,
      isRemoved: false,
    });

    // Kullanıcı giriş yapmışsa, oy bilgilerini ekle
    if (userId) {
      const commentIds = replies.map((reply) => reply._id);

      const userVotes = await Vote.find({
        user: userId,
        comment: { $in: commentIds },
      }).select('comment voteType');

      const voteMap = new Map();
      userVotes.forEach((vote) => {
        voteMap.set(vote.comment.toString(), vote.voteType);
      });

      // Her yanıt için kullanıcının oyunu ekle
      replies.forEach((reply) => {
        reply.userVote = voteMap.get(reply._id.toString()) || null;
      });
    }

    res.status(200).json({
      success: true,
      count: replies.length,
      total: totalReplies,
      totalPages: Math.ceil(totalReplies / limit),
      currentPage: page,
      data: replies,
    });
  } catch (error) {
    console.error('Get comment replies error:', error);
    res.status(500).json({
      success: false,
      message: 'Yanıtlar getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * @desc    Bir yorumu raporla
 * @route   POST /api/comments/:commentId/report
 * @access  Private
 */
const reportComment = async (req, res) => {
  try {
    const { commentId } = req.params;
    const { reason, details } = req.body;
    const userId = req.user._id;

    // Geçerli ID kontrolü
    if (!mongoose.Types.ObjectId.isValid(commentId)) {
      return res.status(400).json({
        success: false,
        message: 'Geçersiz yorum ID formatı',
      });
    }

    // Neden kontrolü
    if (!reason) {
      return res.status(400).json({
        success: false,
        message: 'Raporlama nedeni belirtilmelidir',
      });
    }

    // Yorumu kontrol et
    const comment = await Comment.findById(commentId).populate({
      path: 'post',
      select: 'subreddit',
      populate: {
        path: 'subreddit',
        select: 'name',
      },
    });

    if (!comment || comment.isDeleted) {
      return res.status(404).json({
        success: false,
        message: 'Yorum bulunamadı',
      });
    }

    // Kullanıcının daha önce bu yorumu raporlayıp raporlamadığını kontrol et
    const existingReport = await Report.findOne({
      reporter: userId,
      comment: commentId,
    });

    if (existingReport) {
      return res.status(400).json({
        success: false,
        message: 'Bu yorumu zaten raporladınız',
      });
    }

    // Yeni rapor oluştur
    const report = await Report.create({
      type: 'comment',
      comment: commentId,
      reporter: userId,
      subreddit: comment.post.subreddit._id,
      reason,
      details: details || '',
    });

    // Yorum rapor sayısını güncelle
    comment.reportCount = (comment.reportCount || 0) + 1;
    await comment.save();

    res.status(201).json({
      success: true,
      message: 'Yorum başarıyla raporlandı',
      data: {
        reportId: report._id,
      },
    });
  } catch (error) {
    console.error('Report comment error:', error);
    res.status(500).json({
      success: false,
      message: 'Yorum raporlanırken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * @desc    Yoruma ödül ver
 * @route   POST /api/comments/:commentId/award
 * @access  Private
 */
const awardComment = async (req, res) => {
  try {
    const { commentId } = req.params;
    const { awardType, message, anonymous = false } = req.body;
    const userId = req.user._id;

    // Geçerli ID kontrolü
    if (!mongoose.Types.ObjectId.isValid(commentId)) {
      return res.status(400).json({
        success: false,
        message: 'Geçersiz yorum ID formatı',
      });
    }

    // Yorumu bul
    const comment = await Comment.findById(commentId)
      .populate('author', 'username')
      .populate({
        path: 'post',
        select: 'title subreddit',
        populate: {
          path: 'subreddit',
          select: 'name',
        },
      });

    if (!comment || comment.isDeleted) {
      return res.status(404).json({
        success: false,
        message: 'Yorum bulunamadı',
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
      receiver: comment.author._id,
      comment: commentId,
      message: message || null,
      anonymous: anonymous,
    });

    // Yorumun ödül sayısını güncelle
    comment.awardCount = (comment.awardCount || 0) + 1;
    await comment.save();

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

    const receiver = await User.findById(comment.author._id);
    receiver.karma.awardee += awardValues[awardType].karma;
    receiver.coins += awardValues[awardType].coins;
    await receiver.save();

    // Bildirim oluştur (anonim değilse)
    if (!anonymous) {
      await Notification.create({
        recipient: comment.author._id,
        sender: userId,
        type: 'award',
        relatedPost: comment.post._id,
        relatedComment: commentId,
        message: `Yorumunuz "${comment.content.substring(0, 30)}${comment.content.length > 30 ? '...' : ''}" bir ${awardType} ödülü aldı!`,
      });
    } else {
      await Notification.create({
        recipient: comment.author._id,
        type: 'award',
        relatedPost: comment.post._id,
        relatedComment: commentId,
        message: `Yorumunuz "${comment.content.substring(0, 30)}${comment.content.length > 30 ? '...' : ''}" anonim bir kullanıcıdan ${awardType} ödülü aldı!`,
      });
    }

    res.status(200).json({
      success: true,
      message: 'Ödül başarıyla verildi',
      data: newAward,
      userCoins: user.coins,
    });
  } catch (error) {
    console.error('Award comment error:', error);
    res.status(500).json({
      success: false,
      message: 'Ödül verilirken bir hata oluştu',
      error: error.message,
    });
  }
};

module.exports = {
  createComment,
  updateComment,
  deleteComment,
  getCommentReplies,
  reportComment,
  awardComment,
};
