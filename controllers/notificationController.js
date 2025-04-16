const Notification = require('../models/Notification');
const User = require('../models/User');
const Post = require('../models/Post');
const Comment = require('../models/Comment');
const Subreddit = require('../models/Subreddit');
const ChatMessage = require('../models/ChatMessage');
const asyncHandler = require('../middleware/async');
const ErrorResponse = require('../utils/errorResponse');
const mongoose = require('mongoose');

/**
 * @desc    Kullanıcı bildirimlerini getir
 * @route   GET /api/notifications
 * @access  Private
 */
const getUserNotifications = asyncHandler(async (req, res, next) => {
  const userId = req.user._id;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const skip = (page - 1) * limit;
  const { read, type } = req.query;

  // Sorgu oluştur
  const query = { recipient: userId };

  // Okunma durumu filtresi
  if (read !== undefined) {
    query.read = read === 'true';
  }

  // Bildirim tipi filtresi
  if (
    type &&
    [
      'post_reply',
      'comment_reply',
      'mention',
      'post_upvote',
      'comment_upvote',
      'award',
      'mod_action',
      'subreddit_ban',
      'subreddit_invite',
      'message',
      'system',
    ].includes(type)
  ) {
    query.type = type;
  }

  // Toplam bildirim sayısı
  const total = await Notification.countDocuments(query);

  // Bildirimleri getir
  const notifications = await Notification.find(query)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .populate('sender', 'username profilePicture')
    .populate('relatedPost', 'title slug')
    .populate('relatedComment', 'content')
    .populate('relatedSubreddit', 'name icon')
    .populate('relatedMessage', 'content');

  // Okunmamış bildirim sayısı
  const unreadCount = await Notification.countDocuments({
    recipient: userId,
    read: false,
  });

  res.status(200).json({
    success: true,
    count: notifications.length,
    total,
    unreadCount,
    pagination: {
      page,
      limit,
      pages: Math.ceil(total / limit),
    },
    data: notifications,
  });
});

/**
 * @desc    Tek bir bildirimi getir
 * @route   GET /api/notifications/:id
 * @access  Private
 */
const getNotification = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user._id;

  // ID formatı kontrolü
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorResponse('Geçersiz bildirim ID formatı', 400));
  }

  // Bildirimi bul
  const notification = await Notification.findById(id)
    .populate('sender', 'username profilePicture')
    .populate('relatedPost', 'title slug')
    .populate('relatedComment', 'content')
    .populate('relatedSubreddit', 'name icon')
    .populate('relatedMessage', 'content');

  if (!notification) {
    return next(new ErrorResponse('Bildirim bulunamadı', 404));
  }

  // Yetki kontrolü
  if (notification.recipient.toString() !== userId.toString()) {
    return next(new ErrorResponse('Bu bildirimi görüntüleme yetkiniz yok', 403));
  }

  // Bildirimi otomatik olarak okundu olarak işaretle
  if (!notification.read) {
    notification.read = true;
    notification.readAt = Date.now();
    await notification.save();
  }

  res.status(200).json({
    success: true,
    data: notification,
  });
});

/**
 * @desc    Yeni bildirim oluştur (sistem için)
 * @route   POST /api/notifications
 * @access  Private (Admin)
 */
const createNotification = asyncHandler(async (req, res, next) => {
  const {
    recipientId,
    title,
    content,
    type,
    relatedPostId,
    relatedCommentId,
    relatedSubredditId,
    relatedMessageId,
  } = req.body;
  const senderId = req.user._id;

  // Yetki kontrolü
  if (req.user.role !== 'admin') {
    return next(new ErrorResponse('Bu işlem için admin yetkiniz yok', 403));
  }

  // Zorunlu alanları kontrol et
  if (!recipientId || !title || !type) {
    return next(new ErrorResponse('Alıcı ID, başlık ve bildirim tipi gereklidir', 400));
  }

  // Alıcı ID formatı kontrolü
  if (!mongoose.Types.ObjectId.isValid(recipientId)) {
    return next(new ErrorResponse('Geçersiz alıcı ID formatı', 400));
  }

  // Alıcının varlığını kontrol et
  const recipient = await User.findById(recipientId);
  if (!recipient) {
    return next(new ErrorResponse('Alıcı kullanıcı bulunamadı', 404));
  }

  // İlgili içeriklerin ID formatlarını kontrol et
  if (relatedPostId && !mongoose.Types.ObjectId.isValid(relatedPostId)) {
    return next(new ErrorResponse('Geçersiz gönderi ID formatı', 400));
  }

  if (relatedCommentId && !mongoose.Types.ObjectId.isValid(relatedCommentId)) {
    return next(new ErrorResponse('Geçersiz yorum ID formatı', 400));
  }

  if (relatedSubredditId && !mongoose.Types.ObjectId.isValid(relatedSubredditId)) {
    return next(new ErrorResponse('Geçersiz subreddit ID formatı', 400));
  }

  if (relatedMessageId && !mongoose.Types.ObjectId.isValid(relatedMessageId)) {
    return next(new ErrorResponse('Geçersiz mesaj ID formatı', 400));
  }

  // Bildirim oluştur
  const notification = await Notification.create({
    recipient: recipientId,
    sender: senderId,
    type,
    title,
    content,
    read: false,
    relatedPost: relatedPostId,
    relatedComment: relatedCommentId,
    relatedSubreddit: relatedSubredditId,
    relatedMessage: relatedMessageId,
  });

  res.status(201).json({
    success: true,
    data: notification,
  });
});

/**
 * @desc    Bildirimi okundu olarak işaretle
 * @route   PUT /api/notifications/:id/read
 * @access  Private
 */
const markAsRead = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user._id;

  // ID formatı kontrolü
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorResponse('Geçersiz bildirim ID formatı', 400));
  }

  // Bildirimi bul
  let notification = await Notification.findById(id);

  if (!notification) {
    return next(new ErrorResponse('Bildirim bulunamadı', 404));
  }

  // Yetki kontrolü
  if (notification.recipient.toString() !== userId.toString()) {
    return next(new ErrorResponse('Bu bildirimi işaretleme yetkiniz yok', 403));
  }

  // Zaten okunmuşsa hata dönme
  if (notification.read) {
    return res.status(200).json({
      success: true,
      message: 'Bildirim zaten okundu olarak işaretlenmiş',
      data: notification,
    });
  }

  // Bildirimi okundu olarak işaretle
  notification.read = true;
  notification.readAt = Date.now();
  await notification.save();

  res.status(200).json({
    success: true,
    message: 'Bildirim okundu olarak işaretlendi',
    data: notification,
  });
});

/**
 * @desc    Tüm bildirimleri okundu olarak işaretle
 * @route   PUT /api/notifications/read-all
 * @access  Private
 */
const markAllAsRead = asyncHandler(async (req, res, next) => {
  const userId = req.user._id;
  const { type } = req.query;

  // Sorgu oluştur
  const query = {
    recipient: userId,
    read: false,
  };

  // Bildirim tipi filtresi
  if (
    type &&
    [
      'post_reply',
      'comment_reply',
      'mention',
      'post_upvote',
      'comment_upvote',
      'award',
      'mod_action',
      'subreddit_ban',
      'subreddit_invite',
      'message',
      'system',
    ].includes(type)
  ) {
    query.type = type;
  }

  // Tüm bildirimleri okundu olarak işaretle
  const result = await Notification.updateMany(query, {
    $set: {
      read: true,
      readAt: Date.now(),
    },
  });

  res.status(200).json({
    success: true,
    message: `${result.nModified} bildirim okundu olarak işaretlendi`,
    count: result.nModified,
  });
});

/**
 * @desc    Bildirimi sil
 * @route   DELETE /api/notifications/:id
 * @access  Private
 */
const deleteNotification = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user._id;

  // ID formatı kontrolü
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorResponse('Geçersiz bildirim ID formatı', 400));
  }

  // Bildirimi bul
  const notification = await Notification.findById(id);

  if (!notification) {
    return next(new ErrorResponse('Bildirim bulunamadı', 404));
  }

  // Yetki kontrolü
  if (notification.recipient.toString() !== userId.toString() && req.user.role !== 'admin') {
    return next(new ErrorResponse('Bu bildirimi silme yetkiniz yok', 403));
  }

  // Bildirimi sil
  await notification.remove();

  res.status(200).json({
    success: true,
    data: {},
    message: 'Bildirim başarıyla silindi',
  });
});

/**
 * @desc    Tüm bildirimleri sil
 * @route   DELETE /api/notifications
 * @access  Private
 */
const deleteAllNotifications = asyncHandler(async (req, res, next) => {
  const userId = req.user._id;
  const { type, read } = req.query;

  // Sorgu oluştur
  const query = { recipient: userId };

  // Bildirim tipi filtresi
  if (
    type &&
    [
      'post_reply',
      'comment_reply',
      'mention',
      'post_upvote',
      'comment_upvote',
      'award',
      'mod_action',
      'subreddit_ban',
      'subreddit_invite',
      'message',
      'system',
    ].includes(type)
  ) {
    query.type = type;
  }

  // Okunma durumu filtresi
  if (read !== undefined) {
    query.read = read === 'true';
  }

  // Tüm bildirimleri sil
  const result = await Notification.deleteMany(query);

  res.status(200).json({
    success: true,
    message: `${result.deletedCount} bildirim başarıyla silindi`,
    count: result.deletedCount,
  });
});

/**
 * @desc    Bildirim sayılarını getir
 * @route   GET /api/notifications/counts
 * @access  Private
 */
const getNotificationCounts = asyncHandler(async (req, res, next) => {
  const userId = req.user._id;

  // Okunmamış bildirim sayısı
  const unreadCount = await Notification.countDocuments({
    recipient: userId,
    read: false,
  });

  // Tip bazında okunmamış bildirim sayıları
  const typeCounts = await Notification.aggregate([
    {
      $match: { recipient: mongoose.Types.ObjectId(userId), read: false },
    },
    {
      $group: {
        _id: '$type',
        count: { $sum: 1 },
      },
    },
  ]);

  // Sonuçları formatlı şekilde hazırla
  const formattedTypeCounts = {};
  typeCounts.forEach((item) => {
    formattedTypeCounts[item._id] = item.count;
  });

  res.status(200).json({
    success: true,
    data: {
      total: unreadCount,
      byType: formattedTypeCounts,
    },
  });
});

/**
 * @desc    Sistem bildirimleri oluştur (yardımcı fonksiyon)
 * @param   {Object} options Bildirim oluşturma seçenekleri
 * @private
 */
const createSystemNotification = async (options) => {
  const {
    recipient,
    title,
    content,
    type,
    sender,
    relatedPost,
    relatedComment,
    relatedSubreddit,
    relatedMessage,
  } = options;

  // Bildirim oluştur
  return await Notification.create({
    recipient,
    sender,
    type: type || 'system',
    title,
    content,
    read: false,
    relatedPost,
    relatedComment,
    relatedSubreddit,
    relatedMessage,
  });
};

/**
 * @desc    Mention bildirimleri oluştur (yardımcı fonksiyon)
 * @param   {String} text İçerik
 * @param   {Object} options Bildirim oluşturma seçenekleri
 * @private
 */
const createMentionNotifications = async (text, options) => {
  // @username formatında mention'ları bul
  const mentionRegex = /@(\w+)/g;
  const mentions = text.match(mentionRegex);

  if (!mentions) return [];

  const uniqueMentions = [...new Set(mentions)];
  const notifications = [];

  // Her mention için bildirim oluştur
  for (const mention of uniqueMentions) {
    const username = mention.substring(1); // @ işaretini kaldır

    // Kullanıcıyı bul
    const user = await User.findOne({ username });

    // Kullanıcı yoksa veya gönderen kendisi ise atla
    if (!user || (options.sender && options.sender.toString() === user._id.toString())) {
      continue;
    }

    // Bildirim oluştur
    const notification = await Notification.create({
      recipient: user._id,
      sender: options.sender,
      type: 'mention',
      title:
        options.title || `@${options.senderUsername || 'Birisi'} sizi bir gönderide etiketledi`,
      content: options.content || text.substring(0, 100) + (text.length > 100 ? '...' : ''),
      relatedPost: options.relatedPost,
      relatedComment: options.relatedComment,
      relatedSubreddit: options.relatedSubreddit,
    });

    notifications.push(notification);
  }

  return notifications;
};

/**
 * @desc    Yorum bildirimleri oluştur (yardımcı fonksiyon)
 * @param   {Object} comment Yorum objesi
 * @private
 */
const createCommentNotifications = async (comment) => {
  try {
    const notifications = [];

    // 1. Gönderi sahibine bildirim (kendi yorumu değilse)
    const post = await Post.findById(comment.post).populate('author', 'username');

    if (post && post.author && post.author._id.toString() !== comment.author.toString()) {
      const notification = await Notification.create({
        recipient: post.author._id,
        sender: comment.author,
        type: 'post_reply',
        title: `Gönderinize yeni bir yorum yapıldı`,
        content: comment.content.substring(0, 100) + (comment.content.length > 100 ? '...' : ''),
        relatedPost: post._id,
        relatedComment: comment._id,
      });

      notifications.push(notification);
    }

    // 2. Eğer bu bir yanıt ise, üst yorumun sahibine bildirim
    if (comment.parent) {
      const parentComment = await Comment.findById(comment.parent).populate('author', 'username');

      if (
        parentComment &&
        parentComment.author &&
        parentComment.author._id.toString() !== comment.author.toString()
      ) {
        const notification = await Notification.create({
          recipient: parentComment.author._id,
          sender: comment.author,
          type: 'comment_reply',
          title: `Yorumunuza yanıt geldi`,
          content: comment.content.substring(0, 100) + (comment.content.length > 100 ? '...' : ''),
          relatedPost: post._id,
          relatedComment: comment._id,
        });

        notifications.push(notification);
      }
    }

    // 3. Yorum içindeki mention'lar için bildirimler
    const mentionNotifications = await createMentionNotifications(comment.content, {
      sender: comment.author,
      senderUsername: (await User.findById(comment.author))?.username,
      title: `Bir yorumda etiketlendiniz`,
      relatedPost: post._id,
      relatedComment: comment._id,
      relatedSubreddit: post?.subreddit,
    });

    notifications.push(...mentionNotifications);

    return notifications;
  } catch (error) {
    console.error('Yorum bildirimi oluşturma hatası:', error);
    return [];
  }
};

/**
 * @desc    Upvote bildirimleri oluştur (yardımcı fonksiyon)
 * @param   {String} type Upvote tipi ('post' veya 'comment')
 * @param   {Object} data Upvote verileri
 * @private
 */
const createUpvoteNotification = async (type, data) => {
  try {
    // Post upvote bildirimi
    if (type === 'post' && data.post) {
      const post = await Post.findById(data.post).populate('author', 'username');

      // Kendi gönderisini upvote'layanları atla
      if (post && post.author && post.author._id.toString() !== data.user.toString()) {
        return await Notification.create({
          recipient: post.author._id,
          sender: data.user,
          type: 'post_upvote',
          title: `Gönderiniz beğenildi`,
          content: `"${post.title.substring(0, 50) + (post.title.length > 50 ? '...' : '')}" başlıklı gönderiniz beğenildi`,
          relatedPost: post._id,
        });
      }
    }

    // Comment upvote bildirimi
    if (type === 'comment' && data.comment) {
      const comment = await Comment.findById(data.comment).populate('author', 'username');

      // Kendi yorumunu upvote'layanları atla
      if (comment && comment.author && comment.author._id.toString() !== data.user.toString()) {
        return await Notification.create({
          recipient: comment.author._id,
          sender: data.user,
          type: 'comment_upvote',
          title: `Yorumunuz beğenildi`,
          content: comment.content.substring(0, 50) + (comment.content.length > 50 ? '...' : ''),
          relatedComment: comment._id,
          relatedPost: comment.post,
        });
      }
    }

    return null;
  } catch (error) {
    console.error('Upvote bildirimi oluşturma hatası:', error);
    return null;
  }
};

/**
 * @desc    Award bildirimleri oluştur (yardımcı fonksiyon)
 * @param   {Object} award Ödül verileri
 * @private
 */
const createAwardNotification = async (award) => {
  try {
    let recipient, contentTitle, relatedPost, relatedComment;

    // Post ödülü
    if (award.post) {
      const post = await Post.findById(award.post).populate('author', 'username');
      recipient = post?.author?._id;
      contentTitle = post?.title;
      relatedPost = post?._id;
    }

    // Yorum ödülü
    if (award.comment) {
      const comment = await Comment.findById(award.comment).populate('author', 'username');
      recipient = comment?.author?._id;
      contentTitle = 'yorumunuz';
      relatedComment = comment?._id;
      relatedPost = comment?.post;
    }

    // Alıcı yoksa veya kendine ödül veriyorsa atla
    if (!recipient || recipient.toString() === award.giver.toString()) {
      return null;
    }

    return await Notification.create({
      recipient,
      sender: award.giver,
      type: 'award',
      title: `${award.awardType || 'Bir ödül'} kazandınız!`,
      content: `"${contentTitle?.substring(0, 50) + (contentTitle?.length > 50 ? '...' : '')}" için ${award.awardType || 'bir ödül'} aldınız`,
      relatedPost,
      relatedComment,
    });
  } catch (error) {
    console.error('Ödül bildirimi oluşturma hatası:', error);
    return null;
  }
};

/**
 * @desc    Moderatör bildirimleri oluştur (yardımcı fonksiyon)
 * @param   {Object} action Moderatör eylem verileri
 * @private
 */
const createModActionNotification = async (action) => {
  try {
    let recipient, title, content;

    // Kullanıcıya yönelik moderatör eylemi
    if (action.targetUser) {
      recipient = action.targetUser;

      // Eylem tipine göre başlık ve içerik belirle
      switch (action.action) {
        case 'ban_user':
          title = `r/${action.subreddit.name}'den yasaklandınız`;
          content = action.reason || 'Subreddit kurallarını ihlal ettiğiniz için yasaklandınız.';
          break;
        case 'unban_user':
          title = `r/${action.subreddit.name}'deki yasağınız kaldırıldı`;
          content = "Artık bu subreddit'e tekrar katılabilirsiniz.";
          break;
        case 'mute_user':
          title = `r/${action.subreddit.name}'de susturuldunuz`;
          content = action.reason || 'Moderatörlerle iletişim kurmanız geçici olarak kısıtlandı.';
          break;
        case 'add_moderator':
          title = `r/${action.subreddit.name}'de moderatör olarak atandınız`;
          content = "Tebrikler! Artık bu subreddit'in moderatörüsünüz.";
          break;
        default:
          title = `r/${action.subreddit.name}'de bir moderatör eylemi`;
          content = 'Bir moderatör hesabınızla ilgili bir işlem gerçekleştirdi.';
      }

      return await Notification.create({
        recipient,
        sender: action.moderator,
        type: 'mod_action',
        title,
        content,
        relatedSubreddit: action.subreddit._id,
      });
    }

    // Post veya yoruma yönelik moderatör eylemi
    if (
      (action.targetPost || action.targetComment) &&
      (action.action.includes('remove') || action.action.includes('approve'))
    ) {
      if (action.targetPost) {
        const post = await Post.findById(action.targetPost);
        recipient = post?.author;
        title = `r/${action.subreddit.name}'deki gönderiniz ${action.action.includes('remove') ? 'kaldırıldı' : 'onaylandı'}`;
        content =
          action.reason ||
          (action.action.includes('remove')
            ? 'Gönderiniz subreddit kurallarına aykırı olduğu için kaldırıldı.'
            : 'Gönderiniz moderatör tarafından onaylandı.');
      }

      if (action.targetComment) {
        const comment = await Comment.findById(action.targetComment);
        recipient = comment?.author;
        title = `r/${action.subreddit.name}'deki yorumunuz ${action.action.includes('remove') ? 'kaldırıldı' : 'onaylandı'}`;
        content =
          action.reason ||
          (action.action.includes('remove')
            ? 'Yorumunuz subreddit kurallarına aykırı olduğu için kaldırıldı.'
            : 'Yorumunuz moderatör tarafından onaylandı.');
      }

      if (recipient) {
        return await Notification.create({
          recipient,
          sender: action.moderator,
          type: 'mod_action',
          title,
          content,
          relatedPost: action.targetPost,
          relatedComment: action.targetComment,
          relatedSubreddit: action.subreddit._id,
        });
      }
    }

    return null;
  } catch (error) {
    console.error('Moderatör eylem bildirimi oluşturma hatası:', error);
    return null;
  }
};

/**
 * @desc    Subreddit davet bildirimleri oluştur (yardımcı fonksiyon)
 * @param   {Object} invitation Davet verileri
 * @private
 */
const createSubredditInviteNotification = async (invitation) => {
  try {
    const subreddit = await Subreddit.findById(invitation.subreddit);

    if (!subreddit) {
      return null;
    }

    return await Notification.create({
      recipient: invitation.user,
      sender: invitation.inviter,
      type: 'subreddit_invite',
      title: `r/${subreddit.name}'de moderatör olmaya davet edildiniz`,
      content:
        invitation.message ||
        `r/${subreddit.name} topluluğuna moderatör olarak katılmak için davet edildiniz.`,
      relatedSubreddit: subreddit._id,
    });
  } catch (error) {
    console.error('Subreddit davet bildirimi oluşturma hatası:', error);
    return null;
  }
};

/**
 * @desc    Özel mesaj bildirimleri oluştur (yardımcı fonksiyon)
 * @param   {Object} message Mesaj verileri
 * @private
 */
const createMessageNotification = async (message) => {
  try {
    // Kendi kendine mesajları atla
    if (message.sender.toString() === message.recipient.toString()) {
      return null;
    }

    const sender = await User.findById(message.sender);

    return await Notification.create({
      recipient: message.recipient,
      sender: message.sender,
      type: 'message',
      title: `${sender.username}'den yeni bir mesaj`,
      content: message.content.substring(0, 100) + (message.content.length > 100 ? '...' : ''),
      relatedMessage: message._id,
    });
  } catch (error) {
    console.error('Mesaj bildirimi oluşturma hatası:', error);
    return null;
  }
};

module.exports = {
  getUserNotifications,
  getNotification,
  createNotification,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  deleteAllNotifications,
  getNotificationCounts,
  // Yardımcı fonksiyonlar diğer kontrolcüler tarafından kullanılabilir
  createSystemNotification,
  createCommentNotifications,
  createMentionNotifications,
  createUpvoteNotification,
  createAwardNotification,
  createModActionNotification,
  createSubredditInviteNotification,
  createMessageNotification,
};
