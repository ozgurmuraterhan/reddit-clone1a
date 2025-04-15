const { Chat, Message, User, BlockedUser } = require('../models');

/**
 * Kullanıcının sohbetlerini getir
 * @route GET /api/chats
 * @access Private
 */
const getUserChats = async (req, res) => {
  try {
    const userId = req.user._id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    // Kullanıcının dahil olduğu tüm sohbetleri bul
    const chats = await Chat.find({
      participants: userId,
      isDeleted: false,
    })
      .skip(skip)
      .limit(limit)
      .sort({ updatedAt: -1 })
      .populate({
        path: 'participants',
        match: { _id: { $ne: userId } }, // Diğer katılımcıları getir
        select: 'username displayName profilePicture isOnline lastSeen',
      })
      .populate({
        path: 'lastMessage',
        select: 'content sender createdAt isRead',
      });

    const totalChats = await Chat.countDocuments({
      participants: userId,
      isDeleted: false,
    });

    // Her sohbet için okunmamış mesaj sayısını hesapla
    const chatWithUnreadCounts = await Promise.all(
      chats.map(async (chat) => {
        const unreadCount = await Message.countDocuments({
          chat: chat._id,
          sender: { $ne: userId },
          isRead: false,
        });

        return {
          ...chat.toObject(),
          unreadCount,
        };
      }),
    );

    res.status(200).json({
      success: true,
      count: chats.length,
      total: totalChats,
      totalPages: Math.ceil(totalChats / limit),
      currentPage: page,
      data: chatWithUnreadCounts,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Sohbetler getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * Belirli bir sohbetin mesajlarını getir
 * @route GET /api/chats/:chatId/messages
 * @access Private
 */
const getChatMessages = async (req, res) => {
  try {
    const { chatId } = req.params;
    const userId = req.user._id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip = (page - 1) * limit;

    // Sohbeti kontrol et
    const chat = await Chat.findById(chatId);
    if (!chat) {
      return res.status(404).json({
        success: false,
        message: 'Sohbet bulunamadı',
      });
    }

    // Kullanıcının bu sohbette olup olmadığını kontrol et
    if (!chat.participants.includes(userId)) {
      return res.status(403).json({
        success: false,
        message: 'Bu sohbete erişim izniniz yok',
      });
    }

    // Mesajları getir
    const messages = await Message.find({
      chat: chatId,
      isDeleted: false,
    })
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 }) // En yeni mesajlar önce
      .populate('sender', 'username profilePicture');

    const totalMessages = await Message.countDocuments({
      chat: chatId,
      isDeleted: false,
    });

    // Diğer kullanıcının gönderdiği okunmamış mesajları okundu olarak işaretle
    await Message.updateMany(
      {
        chat: chatId,
        sender: { $ne: userId },
        isRead: false,
      },
      { isRead: true },
    );

    res.status(200).json({
      success: true,
      count: messages.length,
      total: totalMessages,
      totalPages: Math.ceil(totalMessages / limit),
      currentPage: page,
      data: messages.reverse(), // En eski mesajlar önce
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Mesajlar getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * Yeni bir sohbet başlat veya var olan sohbeti bul
 * @route POST /api/chats
 * @access Private
 */
const createOrGetChat = async (req, res) => {
  try {
    const userId = req.user._id;
    const { recipientUsername } = req.body;

    if (!recipientUsername) {
      return res.status(400).json({
        success: false,
        message: 'Alıcı kullanıcı adı gereklidir',
      });
    }

    // Alıcı kullanıcıyı bul
    const recipient = await User.findOne({ username: recipientUsername });
    if (!recipient) {
      return res.status(404).json({
        success: false,
        message: 'Alıcı kullanıcı bulunamadı',
      });
    }

    // Kendinize mesaj gönderemezsiniz
    if (recipient._id.toString() === userId.toString()) {
      return res.status(400).json({
        success: false,
        message: 'Kendinize mesaj gönderemezsiniz',
      });
    }

    // Alıcı tarafından engellenmiş mi kontrol et
    const isBlocked = await BlockedUser.findOne({
      blocker: recipient._id,
      blocked: userId,
    });

    if (isBlocked) {
      return res.status(403).json({
        success: false,
        message: 'Bu kullanıcıya mesaj gönderemezsiniz',
      });
    }

    // Siz alıcıyı engellemiş misiniz
    const hasBlocked = await BlockedUser.findOne({
      blocker: userId,
      blocked: recipient._id,
    });

    if (hasBlocked) {
      return res.status(400).json({
        success: false,
        message: 'Engellediğiniz bir kullanıcıya mesaj gönderemezsiniz',
      });
    }

    // İki kullanıcı arasında var olan bir sohbet var mı kontrol et
    let chat = await Chat.findOne({
      participants: { $all: [userId, recipient._id] },
      isDeleted: false,
    });

    // Yoksa yeni sohbet oluştur
    if (!chat) {
      chat = await Chat.create({
        participants: [userId, recipient._id],
        createdBy: userId,
      });
    }

    // Sohbet bilgilerini döndür
    res.status(chat ? 200 : 201).json({
      success: true,
      message: chat ? 'Mevcut sohbet bulundu' : 'Yeni sohbet oluşturuldu',
      data: chat,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Sohbet oluşturulurken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * Mesaj gönder
 * @route POST /api/chats/:chatId/messages
 * @access Private
 */
const sendMessage = async (req, res) => {
  try {
    const { chatId } = req.params;
    const userId = req.user._id;
    const { content } = req.body;

    if (!content || content.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Mesaj içeriği boş olamaz',
      });
    }

    // Sohbeti kontrol et
    const chat = await Chat.findById(chatId);
    if (!chat) {
      return res.status(404).json({
        success: false,
        message: 'Sohbet bulunamadı',
      });
    }

    // Kullanıcının bu sohbette olup olmadığını kontrol et
    if (!chat.participants.includes(userId)) {
      return res.status(403).json({
        success: false,
        message: 'Bu sohbete mesaj gönderme izniniz yok',
      });
    }

    // Alıcıyı bul
    const recipientId = chat.participants.find(
      (participant) => participant.toString() !== userId.toString(),
    );

    // Alıcı tarafından engellenmiş mi kontrol et
    const isBlocked = await BlockedUser.findOne({
      blocker: recipientId,
      blocked: userId,
    });

    if (isBlocked) {
      return res.status(403).json({
        success: false,
        message: 'Bu kullanıcıya mesaj gönderemezsiniz',
      });
    }

    // Mesajı oluştur
    const message = await Message.create({
      chat: chatId,
      sender: userId,
      content,
      isRead: false,
    });

    // Sohbetin son mesajını güncelle
    chat.lastMessage = message._id;
    chat.updatedAt = Date.now();
    await chat.save();

    // Gönderilen mesajı döndür (sender detayları ile)
    const populatedMessage = await Message.findById(message._id).populate(
      'sender',
      'username profilePicture',
    );

    // Socket.io ile gerçek zamanlı mesaj gönderimi (gerçek uygulamada eklenecek)
    // io.to(recipientId.toString()).emit('new_message', populatedMessage);

    res.status(201).json({
      success: true,
      message: 'Mesaj başarıyla gönderildi',
      data: populatedMessage,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Mesaj gönderilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * Mesajı sil (soft delete)
 * @route DELETE /api/chats/:chatId/messages/:messageId
 * @access Private
 */
const deleteMessage = async (req, res) => {
  try {
    const { chatId, messageId } = req.params;
    const userId = req.user._id;

    // Mesajı bul
    const message = await Message.findOne({
      _id: messageId,
      chat: chatId,
    });

    if (!message) {
      return res.status(404).json({
        success: false,
        message: 'Mesaj bulunamadı',
      });
    }

    // Sadece mesaj gönderen silebilir
    if (message.sender.toString() !== userId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Bu mesajı silme yetkiniz yok',
      });
    }

    // Mesajı soft delete ile sil
    message.isDeleted = true;
    message.content = 'Bu mesaj silindi';
    await message.save();

    res.status(200).json({
      success: true,
      message: 'Mesaj başarıyla silindi',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Mesaj silinirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * Sohbeti sil (soft delete)
 * @route DELETE /api/chats/:chatId
 * @access Private
 */
const deleteChat = async (req, res) => {
  try {
    const { chatId } = req.params;
    const userId = req.user._id;

    // Sohbeti bul
    const chat = await Chat.findById(chatId);
    if (!chat) {
      return res.status(404).json({
        success: false,
        message: 'Sohbet bulunamadı',
      });
    }

    // Kullanıcının bu sohbette olup olmadığını kontrol et
    if (!chat.participants.includes(userId)) {
      return res.status(403).json({
        success: false,
        message: 'Bu sohbeti silme izniniz yok',
      });
    }

    // Sohbeti soft delete ile sil
    chat.isDeleted = true;
    await chat.save();

    res.status(200).json({
      success: true,
      message: 'Sohbet başarıyla silindi',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Sohbet silinirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * Okunmayan mesaj sayısını getir
 * @route GET /api/chats/unread-count
 * @access Private
 */
const getUnreadMessageCount = async (req, res) => {
  try {
    const userId = req.user._id;

    // Kullanıcının dahil olduğu tüm sohbetleri bul
    const chats = await Chat.find({
      participants: userId,
      isDeleted: false,
    });

    // Okunmayan toplam mesaj sayısını hesapla
    let totalUnreadCount = 0;
    await Promise.all(
      chats.map(async (chat) => {
        const unreadCount = await Message.countDocuments({
          chat: chat._id,
          sender: { $ne: userId },
          isRead: false,
          isDeleted: false,
        });
        totalUnreadCount += unreadCount;
      }),
    );

    res.status(200).json({
      success: true,
      unreadCount: totalUnreadCount,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Okunmayan mesaj sayısı getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * Sohbette yazıyor bilgisini gönder (Socket.io için)
 * @route POST /api/chats/:chatId/typing
 * @access Private
 */
const sendTypingStatus = async (req, res) => {
  try {
    const { chatId } = req.params;
    const userId = req.user._id;
    const { isTyping } = req.body;

    if (isTyping === undefined) {
      return res.status(400).json({
        success: false,
        message: 'isTyping parametresi gereklidir',
      });
    }

    // Sohbeti kontrol et
    const chat = await Chat.findById(chatId);
    if (!chat) {
      return res.status(404).json({
        success: false,
        message: 'Sohbet bulunamadı',
      });
    }

    // Kullanıcının bu sohbette olup olmadığını kontrol et
    if (!chat.participants.includes(userId)) {
      return res.status(403).json({
        success: false,
        message: 'Bu sohbette yazma izniniz yok',
      });
    }

    // Diğer katılımcıları bul
    const otherParticipants = chat.participants.filter(
      (participant) => participant.toString() !== userId.toString(),
    );

    // Socket.io ile diğer katılımcılara yazıyor bilgisini gönder (gerçek uygulamada eklenecek)
    // otherParticipants.forEach(participantId => {
    //   io.to(participantId.toString()).emit('typing_status', {
    //     chatId,
    //     userId,
    //     isTyping
    //   });
    // });

    res.status(200).json({
      success: true,
      message: `Yazıyor durumu ${isTyping ? 'başladı' : 'bitti'}`,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Yazıyor durumu gönderilirken bir hata oluştu',
      error: error.message,
    });
  }
};

module.exports = {
  getUserChats,
  getChatMessages,
  createOrGetChat,
  sendMessage,
  deleteMessage,
  deleteChat,
  getUnreadMessageCount,
  sendTypingStatus,
};
