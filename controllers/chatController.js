const mongoose = require('mongoose');
const ChatRoom = require('../models/ChatRoom');
const ChatMessage = require('../models/ChatMessage');
const User = require('../models/User');
const ErrorResponse = require('../utils/errorResponse');
const asyncHandler = require('../middleware/async');

/**
 * @desc    Kullanıcının sohbet odalarını getir
 * @route   GET /api/chats
 * @access  Private
 */
const getUserChatRooms = asyncHandler(async (req, res, next) => {
  const userId = req.user._id;
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;
  const startIndex = (page - 1) * limit;
  const endIndex = page * limit;

  // Kullanıcının dahil olduğu sohbet odalarını bul
  const chatRoomsQuery = {
    'participants.user': userId,
  };

  // Filtreler (direct, group, vs)
  if (req.query.type && ['direct', 'group'].includes(req.query.type)) {
    chatRoomsQuery.type = req.query.type;
  }

  // Toplam sayfa sayısı için
  const total = await ChatRoom.countDocuments(chatRoomsQuery);

  // Sohbet odalarını getir ve son mesajı, katılımcıları popula et
  const chatRooms = await ChatRoom.find(chatRoomsQuery)
    .sort({ lastActivity: -1 })
    .skip(startIndex)
    .limit(limit)
    .populate({
      path: 'lastMessage',
      select: 'content sender createdAt attachments',
      populate: {
        path: 'sender',
        select: 'username profilePicture',
      },
    })
    .populate({
      path: 'participants.user',
      select: 'username profilePicture',
    })
    .populate('creator', 'username profilePicture');

  // Her sohbet için okunmamış mesaj sayısını hesapla
  const chatRoomsWithUnreadCounts = await Promise.all(
    chatRooms.map(async (chatRoom) => {
      const unreadCount = await ChatMessage.countDocuments({
        room: chatRoom._id,
        sender: { $ne: userId },
        'readBy.user': { $ne: userId },
        isDeleted: false,
      });

      // Diğer katılımcıları bul (current user dışında)
      const otherParticipants = chatRoom.participants.filter(
        (participant) => participant.user._id.toString() !== userId.toString(),
      );

      return {
        ...chatRoom.toObject(),
        unreadCount,
        otherParticipants,
      };
    }),
  );

  // Sayfalama
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
    count: chatRooms.length,
    pagination,
    total,
    data: chatRoomsWithUnreadCounts,
  });
});

/**
 * @desc    Yeni direkt sohbet oluştur veya var olanı getir
 * @route   POST /api/chats/direct
 * @access  Private
 */
const createDirectChat = asyncHandler(async (req, res, next) => {
  const { recipientId } = req.body;
  const userId = req.user._id;

  // Gerekli alanları kontrol et
  if (!recipientId) {
    return next(new ErrorResponse("Alıcı kullanıcı ID'si gereklidir", 400));
  }

  // ObjectId kontrolü
  if (!mongoose.Types.ObjectId.isValid(recipientId)) {
    return next(new ErrorResponse('Geçersiz kullanıcı ID formatı', 400));
  }

  // Kendisiyle sohbet edemez
  if (recipientId.toString() === userId.toString()) {
    return next(new ErrorResponse('Kendinizle sohbet oluşturamazsınız', 400));
  }

  // Alıcı kullanıcıyı kontrol et
  const recipient = await User.findById(recipientId);
  if (!recipient) {
    return next(new ErrorResponse('Kullanıcı bulunamadı', 404));
  }

  if (recipient.isDeleted || recipient.accountStatus !== 'active') {
    return next(new ErrorResponse('Bu kullanıcı ile sohbet başlatamazsınız', 400));
  }

  // İki kullanıcı arasında var olan bir sohbet var mı kontrol et
  let chatRoom = await ChatRoom.findOne({
    type: 'direct',
    'participants.user': { $all: [userId, recipientId] },
  });

  // Yoksa yeni sohbet oluştur
  if (!chatRoom) {
    chatRoom = await ChatRoom.create({
      type: 'direct',
      participants: [
        {
          user: userId,
          joinedAt: new Date(),
          isAdmin: false,
          lastSeen: new Date(),
        },
        {
          user: recipientId,
          joinedAt: new Date(),
          isAdmin: false,
        },
      ],
      creator: userId,
      lastActivity: new Date(),
    });
  }

  // Sohbet odasını doldur ve döndür
  const populatedChatRoom = await ChatRoom.findById(chatRoom._id)
    .populate('participants.user', 'username profilePicture')
    .populate('creator', 'username profilePicture')
    .populate({
      path: 'lastMessage',
      select: 'content sender createdAt attachments',
      populate: {
        path: 'sender',
        select: 'username profilePicture',
      },
    });

  res.status(201).json({
    success: true,
    data: populatedChatRoom,
  });
});

/**
 * @desc    Grup sohbeti oluştur
 * @route   POST /api/chats/group
 * @access  Private
 */
const createGroupChat = asyncHandler(async (req, res, next) => {
  const { name, participants, icon } = req.body;
  const userId = req.user._id;

  // Grup adı kontrolü
  if (!name || name.trim() === '') {
    return next(new ErrorResponse('Grup adı zorunludur', 400));
  }

  // Katılımcı kontrolü
  if (!participants || !Array.isArray(participants) || participants.length < 1) {
    return next(new ErrorResponse('En az bir katılımcı eklemelisiniz', 400));
  }

  // Katılımcı ID'lerinin geçerliliğini kontrol et
  const invalidIds = participants.filter((id) => !mongoose.Types.ObjectId.isValid(id));
  if (invalidIds.length > 0) {
    return next(new ErrorResponse('Geçersiz kullanıcı ID formatı', 400));
  }

  // Kullanıcıyı otomatik olarak katılımcılara ekle
  const allParticipantIds = [...new Set([...participants, userId.toString()])];

  // Katılımcı kullanıcıları kontrol et
  const users = await User.find({
    _id: { $in: allParticipantIds },
    isDeleted: false,
    accountStatus: 'active',
  });

  // Bulunamayan kullanıcıları tespit et
  if (users.length !== allParticipantIds.length) {
    return next(new ErrorResponse('Bazı kullanıcılar bulunamadı veya aktif değil', 400));
  }

  // Grup sohbeti oluştur
  const groupChat = await ChatRoom.create({
    type: 'group',
    name: name.trim(),
    participants: allParticipantIds.map((id) => ({
      user: id,
      joinedAt: new Date(),
      isAdmin: id.toString() === userId.toString(), // Oluşturan kişi admin olur
      lastSeen: id.toString() === userId.toString() ? new Date() : undefined,
    })),
    creator: userId,
    icon: icon || undefined,
    lastActivity: new Date(),
  });

  // Oluşturulan sohbet odasını populate et
  const populatedGroupChat = await ChatRoom.findById(groupChat._id)
    .populate('participants.user', 'username profilePicture')
    .populate('creator', 'username profilePicture');

  res.status(201).json({
    success: true,
    data: populatedGroupChat,
  });
});

/**
 * @desc    Belirli bir sohbet odasını getir
 * @route   GET /api/chats/:chatId
 * @access  Private
 */
const getChatRoom = asyncHandler(async (req, res, next) => {
  const { chatId } = req.params;
  const userId = req.user._id;

  // Geçerli ID kontrolü
  if (!mongoose.Types.ObjectId.isValid(chatId)) {
    return next(new ErrorResponse('Geçersiz sohbet odası ID formatı', 400));
  }

  // Sohbet odasını getir
  const chatRoom = await ChatRoom.findById(chatId)
    .populate('participants.user', 'username profilePicture')
    .populate('creator', 'username profilePicture')
    .populate({
      path: 'lastMessage',
      select: 'content sender createdAt attachments',
      populate: {
        path: 'sender',
        select: 'username profilePicture',
      },
    });

  if (!chatRoom) {
    return next(new ErrorResponse('Sohbet odası bulunamadı', 404));
  }

  // Kullanıcının bu sohbette olup olmadığını kontrol et
  const isParticipant = chatRoom.participants.some(
    (participant) => participant.user._id.toString() === userId.toString(),
  );

  if (!isParticipant) {
    return next(new ErrorResponse('Bu sohbet odasına erişim izniniz yok', 403));
  }

  // Son görülme zamanını güncelle
  await ChatRoom.findOneAndUpdate(
    {
      _id: chatId,
      'participants.user': userId,
    },
    {
      $set: { 'participants.$.lastSeen': new Date() },
    },
  );

  // Okunmamış mesaj sayısını hesapla
  const unreadCount = await ChatMessage.countDocuments({
    room: chatId,
    sender: { $ne: userId },
    'readBy.user': { $ne: userId },
    isDeleted: false,
  });

  const chatRoomWithUnreadCount = {
    ...chatRoom.toObject(),
    unreadCount,
  };

  res.status(200).json({
    success: true,
    data: chatRoomWithUnreadCount,
  });
});

/**
 * @desc    Sohbet odasındaki mesajları getir
 * @route   GET /api/chats/:chatId/messages
 * @access  Private
 */
const getChatMessages = asyncHandler(async (req, res, next) => {
  const { chatId } = req.params;
  const userId = req.user._id;
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 50;
  const startIndex = (page - 1) * limit;
  const endIndex = page * limit;

  // Geçerli ID kontrolü
  if (!mongoose.Types.ObjectId.isValid(chatId)) {
    return next(new ErrorResponse('Geçersiz sohbet odası ID formatı', 400));
  }

  // Sohbet odasını kontrol et
  const chatRoom = await ChatRoom.findById(chatId);
  if (!chatRoom) {
    return next(new ErrorResponse('Sohbet odası bulunamadı', 404));
  }

  // Kullanıcının bu sohbette olup olmadığını kontrol et
  const isParticipant = chatRoom.participants.some(
    (participant) => participant.user.toString() === userId.toString(),
  );

  if (!isParticipant) {
    return next(new ErrorResponse('Bu sohbet odasına erişim izniniz yok', 403));
  }

  // Toplam mesaj sayısı
  const total = await ChatMessage.countDocuments({
    room: chatId,
  });

  // Mesajları getir
  const messages = await ChatMessage.find({
    room: chatId,
  })
    .sort({ createdAt: -1 }) // En yeni mesajlar önce
    .skip(startIndex)
    .limit(limit)
    .populate('sender', 'username profilePicture')
    .populate({
      path: 'replyTo',
      select: 'content sender',
      populate: {
        path: 'sender',
        select: 'username',
      },
    });

  // Okunmamış mesajları okundu olarak işaretle
  const unreadMessages = await ChatMessage.find({
    room: chatId,
    sender: { $ne: userId },
    'readBy.user': { $ne: userId },
    isDeleted: false,
  });

  if (unreadMessages.length > 0) {
    const updatePromises = unreadMessages.map((message) => {
      return ChatMessage.findByIdAndUpdate(message._id, {
        $push: {
          readBy: {
            user: userId,
            readAt: new Date(),
          },
        },
      });
    });

    await Promise.all(updatePromises);
  }

  // Son görülme zamanını güncelle
  await ChatRoom.findOneAndUpdate(
    {
      _id: chatId,
      'participants.user': userId,
    },
    {
      $set: { 'participants.$.lastSeen': new Date() },
    },
  );

  // Sayfalama
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
    count: messages.length,
    pagination,
    total,
    data: messages,
  });
});

/**
 * @desc    Mesaj gönder
 * @route   POST /api/chats/:chatId/messages
 * @access  Private
 */
const sendMessage = asyncHandler(async (req, res, next) => {
  const { chatId } = req.params;
  const { content, attachments, replyTo } = req.body;
  const userId = req.user._id;

  // Geçerli ID kontrolü
  if (!mongoose.Types.ObjectId.isValid(chatId)) {
    return next(new ErrorResponse('Geçersiz sohbet odası ID formatı', 400));
  }

  // İçerik kontrolü
  if ((!content || content.trim() === '') && (!attachments || attachments.length === 0)) {
    return next(new ErrorResponse('Mesaj içeriği veya ek dosya zorunludur', 400));
  }

  // Sohbet odasını kontrol et
  const chatRoom = await ChatRoom.findById(chatId);
  if (!chatRoom) {
    return next(new ErrorResponse('Sohbet odası bulunamadı', 404));
  }

  // Kullanıcının bu sohbette olup olmadığını kontrol et
  const isParticipant = chatRoom.participants.some(
    (participant) => participant.user.toString() === userId.toString(),
  );

  if (!isParticipant) {
    return next(new ErrorResponse('Bu sohbet odasına mesaj gönderme izniniz yok', 403));
  }

  // Eğer bir yanıt mesajı varsa, geçerli olup olmadığını kontrol et
  if (replyTo) {
    if (!mongoose.Types.ObjectId.isValid(replyTo)) {
      return next(new ErrorResponse('Geçersiz yanıt mesajı ID formatı', 400));
    }

    const replyMessage = await ChatMessage.findOne({
      _id: replyTo,
      room: chatId,
    });

    if (!replyMessage) {
      return next(new ErrorResponse('Yanıt vermek istediğiniz mesaj bulunamadı', 404));
    }
  }

  // Mesajı oluştur
  const message = await ChatMessage.create({
    room: chatId,
    sender: userId,
    content: content ? content.trim() : undefined,
    attachments: attachments || [],
    replyTo: replyTo || undefined,
    readBy: [
      {
        user: userId,
        readAt: new Date(),
      },
    ],
  });

  // Sohbet odasının son aktivite ve son mesaj bilgisini güncelle
  await ChatRoom.findByIdAndUpdate(chatId, {
    lastMessage: message._id,
    lastActivity: new Date(),
  });

  // Mesajı popüle et
  const populatedMessage = await ChatMessage.findById(message._id)
    .populate('sender', 'username profilePicture')
    .populate({
      path: 'replyTo',
      select: 'content sender',
      populate: {
        path: 'sender',
        select: 'username',
      },
    });

  res.status(201).json({
    success: true,
    data: populatedMessage,
  });

  // Burada socket.io ile gerçek zamanlı mesaj bildirimi yapılabilir
  // Örnek: io.to(chatId).emit('newMessage', { message: populatedMessage });
});

/**
 * @desc    Mesajı düzenle
 * @route   PUT /api/chats/:chatId/messages/:messageId
 * @access  Private
 */
const editMessage = asyncHandler(async (req, res, next) => {
  const { chatId, messageId } = req.params;
  const { content } = req.body;
  const userId = req.user._id;

  // Geçerli ID kontrolü
  if (!mongoose.Types.ObjectId.isValid(chatId) || !mongoose.Types.ObjectId.isValid(messageId)) {
    return next(new ErrorResponse('Geçersiz ID formatı', 400));
  }

  // İçerik kontrolü
  if (!content || content.trim() === '') {
    return next(new ErrorResponse('Mesaj içeriği zorunludur', 400));
  }

  // Mesajı bul
  const message = await ChatMessage.findById(messageId);

  if (!message) {
    return next(new ErrorResponse('Mesaj bulunamadı', 404));
  }

  // Mesajın bu sohbet odasına ait olup olmadığını kontrol et
  if (message.room.toString() !== chatId) {
    return next(new ErrorResponse('Mesaj bu sohbet odasında bulunamadı', 404));
  }

  // Kullanıcının kendi mesajını düzenlediğinden emin ol
  if (message.sender.toString() !== userId.toString()) {
    return next(new ErrorResponse('Sadece kendi mesajlarınızı düzenleyebilirsiniz', 403));
  }

  // Mesaj silinmiş mi kontrol et
  if (message.isDeleted) {
    return next(new ErrorResponse('Silinmiş mesaj düzenlenemez', 400));
  }

  // Mesajı güncelle
  message.content = content.trim();
  message.isEdited = true;
  message.updatedAt = new Date();
  await message.save();

  // Güncellenen mesajı getir
  const updatedMessage = await ChatMessage.findById(messageId)
    .populate('sender', 'username profilePicture')
    .populate({
      path: 'replyTo',
      select: 'content sender',
      populate: {
        path: 'sender',
        select: 'username',
      },
    });

  res.status(200).json({
    success: true,
    data: updatedMessage,
  });

  // Burada socket.io ile gerçek zamanlı güncelleme bildirimi yapılabilir
  // Örnek: io.to(chatId).emit('messageUpdated', { message: updatedMessage });
});

/**
 * @desc    Mesajı sil
 * @route   DELETE /api/chats/:chatId/messages/:messageId
 * @access  Private
 */
const deleteMessage = asyncHandler(async (req, res, next) => {
  const { chatId, messageId } = req.params;
  const userId = req.user._id;

  // Geçerli ID kontrolü
  if (!mongoose.Types.ObjectId.isValid(chatId) || !mongoose.Types.ObjectId.isValid(messageId)) {
    return next(new ErrorResponse('Geçersiz ID formatı', 400));
  }

  // Mesajı bul
  const message = await ChatMessage.findById(messageId);

  if (!message) {
    return next(new ErrorResponse('Mesaj bulunamadı', 404));
  }

  // Mesajın bu sohbet odasına ait olup olmadığını kontrol et
  if (message.room.toString() !== chatId) {
    return next(new ErrorResponse('Mesaj bu sohbet odasında bulunamadı', 404));
  }

  // Kullanıcının bu sohbette olup olmadığını kontrol et
  const chatRoom = await ChatRoom.findById(chatId);
  if (!chatRoom) {
    return next(new ErrorResponse('Sohbet odası bulunamadı', 404));
  }

  const isParticipant = chatRoom.participants.some(
    (participant) => participant.user.toString() === userId.toString(),
  );

  if (!isParticipant) {
    return next(new ErrorResponse('Bu sohbet odasına erişim izniniz yok', 403));
  }

  // Kullanıcının kendi mesajını sildiğinden veya admin olduğundan emin ol
  const isAdmin = chatRoom.participants.some(
    (participant) => participant.user.toString() === userId.toString() && participant.isAdmin,
  );

  if (message.sender.toString() !== userId.toString() && !isAdmin) {
    return next(
      new ErrorResponse(
        'Sadece kendi mesajlarınızı veya moderatör iseniz tüm mesajları silebilirsiniz',
        403,
      ),
    );
  }

  // Mesajı soft-delete yap
  message.isDeleted = true;
  message.deletedAt = new Date();
  message.content = 'Bu mesaj silindi';
  message.attachments = [];
  await message.save();

  res.status(200).json({
    success: true,
    message: 'Mesaj başarıyla silindi',
    data: {},
  });

  // Burada socket.io ile gerçek zamanlı silme bildirimi yapılabilir
  // Örnek: io.to(chatId).emit('messageDeleted', { messageId });
});

/**
 * @desc    Sohbet odasından çık
 * @route   DELETE /api/chats/:chatId/leave
 * @access  Private
 */
const leaveChat = asyncHandler(async (req, res, next) => {
  const { chatId } = req.params;
  const userId = req.user._id;

  // Geçerli ID kontrolü
  if (!mongoose.Types.ObjectId.isValid(chatId)) {
    return next(new ErrorResponse('Geçersiz sohbet odası ID formatı', 400));
  }

  // Sohbet odasını bul
  const chatRoom = await ChatRoom.findById(chatId);

  if (!chatRoom) {
    return next(new ErrorResponse('Sohbet odası bulunamadı', 404));
  }

  // Kullanıcının bu sohbette olup olmadığını kontrol et
  const participantIndex = chatRoom.participants.findIndex(
    (participant) => participant.user.toString() === userId.toString(),
  );

  if (participantIndex === -1) {
    return next(new ErrorResponse('Bu sohbet odasında zaten bulunmuyorsunuz', 400));
  }

  // Direct chat ise özel işlem
  if (chatRoom.type === 'direct') {
    return next(new ErrorResponse('Direkt sohbetlerden çıkamazsınız, sohbeti silebilirsiniz', 400));
  }

  // Grup sohbeti işlemi
  // Kullanıcı admin mi kontrol et
  const isAdmin = chatRoom.participants[participantIndex].isAdmin;

  // Eğer bu son admin ise ve başka katılımcılar varsa, başka bir admin ata
  if (isAdmin) {
    const otherAdmins = chatRoom.participants.filter(
      (p) => p.isAdmin && p.user.toString() !== userId.toString(),
    );

    if (otherAdmins.length === 0) {
      // Başka admin yoksa ve başka katılımcılar varsa
      const otherParticipants = chatRoom.participants.filter(
        (p) => p.user.toString() !== userId.toString(),
      );

      if (otherParticipants.length > 0) {
        // En eski katılımcıyı admin yap
        const oldestParticipant = otherParticipants.sort(
          (a, b) => new Date(a.joinedAt) - new Date(b.joinedAt),
        )[0];

        await ChatRoom.updateOne(
          { _id: chatId, 'participants.user': oldestParticipant.user },
          { $set: { 'participants.$.isAdmin': true } },
        );
      }
    }
  }

  // Kullanıcıyı sohbet odasından çıkar
  await ChatRoom.findByIdAndUpdate(chatId, { $pull: { participants: { user: userId } } });

  // Eğer sohbette hiç katılımcı kalmadıysa, sohbeti sil
  const updatedChatRoom = await ChatRoom.findById(chatId);
  if (updatedChatRoom.participants.length === 0) {
    await ChatRoom.findByIdAndDelete(chatId);

    // İlgili tüm mesajları sil
    await ChatMessage.deleteMany({ room: chatId });
  }

  res.status(200).json({
    success: true,
    message: 'Sohbet odasından başarıyla ayrıldınız',
    data: {},
  });
});

/**
 * @desc    Sohbet odasına katılımcı ekle (Grup sohbetleri için)
 * @route   POST /api/chats/:chatId/participants
 * @access  Private
 */
const addChatParticipants = asyncHandler(async (req, res, next) => {
  const { chatId } = req.params;
  const { participants } = req.body;
  const userId = req.user._id;

  // Geçerli ID kontrolü
  if (!mongoose.Types.ObjectId.isValid(chatId)) {
    return next(new ErrorResponse('Geçersiz sohbet odası ID formatı', 400));
  }

  // Katılımcı kontrolü
  if (!participants || !Array.isArray(participants) || participants.length === 0) {
    return next(new ErrorResponse('Eklenecek katılımcıları belirtmelisiniz', 400));
  }

  // Katılımcı kontrolü
  if (!participants || !Array.isArray(participants) || participants.length === 0) {
    return next(new ErrorResponse('Eklenecek katılımcıları belirtmelisiniz', 400));
  }

  // Katılımcı ID'lerinin geçerliliğini kontrol et
  const invalidIds = participants.filter((id) => !mongoose.Types.ObjectId.isValid(id));
  if (invalidIds.length > 0) {
    return next(new ErrorResponse('Geçersiz kullanıcı ID formatı', 400));
  }

  // Sohbet odasını bul
  const chatRoom = await ChatRoom.findById(chatId);

  if (!chatRoom) {
    return next(new ErrorResponse('Sohbet odası bulunamadı', 404));
  }

  // Direkt sohbet kontrolü
  if (chatRoom.type === 'direct') {
    return next(new ErrorResponse('Direkt sohbetlere katılımcı eklenemez', 400));
  }

  // Kullanıcının bu sohbette admin olup olmadığını kontrol et
  const isAdmin = chatRoom.participants.some(
    (participant) => participant.user.toString() === userId.toString() && participant.isAdmin,
  );

  if (!isAdmin) {
    return next(new ErrorResponse('Sohbete katılımcı eklemek için admin olmalısınız', 403));
  }

  // Katılımcıları kontrol et
  const users = await User.find({
    _id: { $in: participants },
    isDeleted: false,
    accountStatus: 'active',
  });

  if (users.length !== participants.length) {
    return next(new ErrorResponse('Bazı kullanıcılar bulunamadı veya aktif değil', 400));
  }

  // Zaten sohbette olan kullanıcıları filtrele
  const existingParticipantIds = chatRoom.participants.map((p) => p.user.toString());
  const newParticipants = participants.filter((id) => !existingParticipantIds.includes(id));

  if (newParticipants.length === 0) {
    return next(new ErrorResponse('Tüm belirtilen kullanıcılar zaten sohbette bulunuyor', 400));
  }

  // Yeni katılımcıları ekle
  const participantsToAdd = newParticipants.map((id) => ({
    user: id,
    joinedAt: new Date(),
    isAdmin: false,
  }));

  await ChatRoom.findByIdAndUpdate(chatId, {
    $push: { participants: { $each: participantsToAdd } },
  });

  // Güncellenmiş sohbet odasını getir
  const updatedChatRoom = await ChatRoom.findById(chatId)
    .populate('participants.user', 'username profilePicture')
    .populate('creator', 'username profilePicture');

  res.status(200).json({
    success: true,
    message: 'Katılımcılar başarıyla eklendi',
    data: updatedChatRoom,
  });

  // Burada socket.io ile gerçek zamanlı katılımcı ekleme bildirimi yapılabilir
  // Örnek: io.to(chatId).emit('participantsAdded', { chatRoom: updatedChatRoom });
});

/**
 * @desc    Sohbet odasından katılımcı çıkar (Grup sohbetleri için)
 * @route   DELETE /api/chats/:chatId/participants/:participantId
 * @access  Private
 */
const removeChatParticipant = asyncHandler(async (req, res, next) => {
  const { chatId, participantId } = req.params;
  const userId = req.user._id;

  // Geçerli ID kontrolü
  if (!mongoose.Types.ObjectId.isValid(chatId) || !mongoose.Types.ObjectId.isValid(participantId)) {
    return next(new ErrorResponse('Geçersiz ID formatı', 400));
  }

  // Sohbet odasını bul
  const chatRoom = await ChatRoom.findById(chatId);

  if (!chatRoom) {
    return next(new ErrorResponse('Sohbet odası bulunamadı', 404));
  }

  // Direkt sohbet kontrolü
  if (chatRoom.type === 'direct') {
    return next(new ErrorResponse('Direkt sohbetlerden katılımcı çıkarılamaz', 400));
  }

  // Kullanıcının kendini çıkarmaya çalışıp çalışmadığını kontrol et
  if (participantId.toString() === userId.toString()) {
    return next(new ErrorResponse("Kendinizi çıkarmak için leave endpoint'ini kullanın", 400));
  }

  // Kullanıcının admin olup olmadığını kontrol et
  const isAdmin = chatRoom.participants.some(
    (participant) => participant.user.toString() === userId.toString() && participant.isAdmin,
  );

  // Çıkarılacak kullanıcının da admin olup olmadığını kontrol et
  const targetIsAdmin = chatRoom.participants.some(
    (participant) => participant.user.toString() === participantId && participant.isAdmin,
  );

  // Admin olmayan kullanıcı, bir admin'i çıkaramaz
  if (!isAdmin || (targetIsAdmin && !chatRoom.creator.equals(userId))) {
    return next(new ErrorResponse('Bu katılımcıyı çıkarma izniniz yok', 403));
  }

  // Katılımcının grupta olup olmadığını kontrol et
  const participantExists = chatRoom.participants.some(
    (participant) => participant.user.toString() === participantId,
  );

  if (!participantExists) {
    return next(new ErrorResponse('Bu kullanıcı zaten sohbette bulunmuyor', 400));
  }

  // Katılımcıyı çıkar
  await ChatRoom.findByIdAndUpdate(chatId, { $pull: { participants: { user: participantId } } });

  // Güncellenmiş sohbet odasını getir
  const updatedChatRoom = await ChatRoom.findById(chatId)
    .populate('participants.user', 'username profilePicture')
    .populate('creator', 'username profilePicture');

  res.status(200).json({
    success: true,
    message: 'Katılımcı başarıyla çıkarıldı',
    data: updatedChatRoom,
  });

  // Burada socket.io ile gerçek zamanlı katılımcı çıkarma bildirimi yapılabilir
  // Örnek: io.to(chatId).emit('participantRemoved', { chatRoom: updatedChatRoom, removedParticipant: participantId });
});

/**
 * @desc    Sohbet odasını güncelle (isim, ikon vb. için)
 * @route   PUT /api/chats/:chatId
 * @access  Private
 */
const updateChatRoom = asyncHandler(async (req, res, next) => {
  const { chatId } = req.params;
  const { name, icon } = req.body;
  const userId = req.user._id;

  // Geçerli ID kontrolü
  if (!mongoose.Types.ObjectId.isValid(chatId)) {
    return next(new ErrorResponse('Geçersiz sohbet odası ID formatı', 400));
  }

  // Sohbet odasını bul
  const chatRoom = await ChatRoom.findById(chatId);

  if (!chatRoom) {
    return next(new ErrorResponse('Sohbet odası bulunamadı', 404));
  }

  // Direkt sohbet kontrolü
  if (chatRoom.type === 'direct') {
    return next(new ErrorResponse('Direkt sohbetler güncellenemez', 400));
  }

  // Kullanıcının bu sohbette admin olup olmadığını kontrol et
  const isAdmin = chatRoom.participants.some(
    (participant) => participant.user.toString() === userId.toString() && participant.isAdmin,
  );

  if (!isAdmin) {
    return next(new ErrorResponse('Sohbeti güncellemek için admin olmalısınız', 403));
  }

  // Güncellenecek verileri hazırla
  const updateData = {};

  if (name && name.trim() !== '') {
    updateData.name = name.trim();
  }

  if (icon) {
    updateData.icon = icon;
  }

  if (Object.keys(updateData).length === 0) {
    return next(new ErrorResponse('Güncellenecek veri belirtilmedi', 400));
  }

  // Sohbeti güncelle
  const updatedChatRoom = await ChatRoom.findByIdAndUpdate(chatId, updateData, { new: true })
    .populate('participants.user', 'username profilePicture')
    .populate('creator', 'username profilePicture');

  res.status(200).json({
    success: true,
    message: 'Sohbet odası başarıyla güncellendi',
    data: updatedChatRoom,
  });

  // Burada socket.io ile gerçek zamanlı güncelleme bildirimi yapılabilir
  // Örnek: io.to(chatId).emit('chatRoomUpdated', { chatRoom: updatedChatRoom });
});

/**
 * @desc    Katılımcıya admin rolü ver
 * @route   PUT /api/chats/:chatId/admins/:participantId
 * @access  Private
 */
const addAdminRole = asyncHandler(async (req, res, next) => {
  const { chatId, participantId } = req.params;
  const userId = req.user._id;

  // Geçerli ID kontrolü
  if (!mongoose.Types.ObjectId.isValid(chatId) || !mongoose.Types.ObjectId.isValid(participantId)) {
    return next(new ErrorResponse('Geçersiz ID formatı', 400));
  }

  // Sohbet odasını bul
  const chatRoom = await ChatRoom.findById(chatId);

  if (!chatRoom) {
    return next(new ErrorResponse('Sohbet odası bulunamadı', 404));
  }

  // Direkt sohbet kontrolü
  if (chatRoom.type === 'direct') {
    return next(new ErrorResponse('Direkt sohbetlerde admin atanaması yapılamaz', 400));
  }

  // Kullanıcının kendini admin yapmaya çalışıp çalışmadığını kontrol et
  if (participantId.toString() === userId.toString()) {
    return next(new ErrorResponse('Kendinizi admin yapamazsınız', 400));
  }

  // Kullanıcının bu sohbette admin olup olmadığını kontrol et
  const isCreator = chatRoom.creator.toString() === userId.toString();
  const isAdmin = chatRoom.participants.some(
    (participant) => participant.user.toString() === userId.toString() && participant.isAdmin,
  );

  if (!isAdmin && !isCreator) {
    return next(new ErrorResponse('Admin atamak için yetkiniz yok', 403));
  }

  // Hedef kullanıcının grupta olup olmadığını kontrol et
  const participantIndex = chatRoom.participants.findIndex(
    (participant) => participant.user.toString() === participantId,
  );

  if (participantIndex === -1) {
    return next(new ErrorResponse('Bu kullanıcı sohbette bulunmuyor', 400));
  }

  // Hedef kullanıcı zaten admin mi kontrol et
  if (chatRoom.participants[participantIndex].isAdmin) {
    return next(new ErrorResponse('Bu kullanıcı zaten admin', 400));
  }

  // Kullanıcıyı admin yap
  await ChatRoom.updateOne(
    { _id: chatId, 'participants.user': participantId },
    { $set: { 'participants.$.isAdmin': true } },
  );

  // Güncellenmiş sohbet odasını getir
  const updatedChatRoom = await ChatRoom.findById(chatId)
    .populate('participants.user', 'username profilePicture')
    .populate('creator', 'username profilePicture');

  res.status(200).json({
    success: true,
    message: 'Kullanıcı başarıyla admin yapıldı',
    data: updatedChatRoom,
  });

  // Burada socket.io ile gerçek zamanlı admin ekleme bildirimi yapılabilir
  // Örnek: io.to(chatId).emit('adminAdded', { chatRoom: updatedChatRoom, newAdmin: participantId });
});

/**
 * @desc    Katılımcıdan admin rolünü kaldır
 * @route   DELETE /api/chats/:chatId/admins/:participantId
 * @access  Private
 */
const removeAdminRole = asyncHandler(async (req, res, next) => {
  const { chatId, participantId } = req.params;
  const userId = req.user._id;

  // Geçerli ID kontrolü
  if (!mongoose.Types.ObjectId.isValid(chatId) || !mongoose.Types.ObjectId.isValid(participantId)) {
    return next(new ErrorResponse('Geçersiz ID formatı', 400));
  }

  // Sohbet odasını bul
  const chatRoom = await ChatRoom.findById(chatId);

  if (!chatRoom) {
    return next(new ErrorResponse('Sohbet odası bulunamadı', 404));
  }

  // Direkt sohbet kontrolü
  if (chatRoom.type === 'direct') {
    return next(new ErrorResponse('Direkt sohbetlerde admin kaldırılamaz', 400));
  }

  // Oluşturucu rolünü kaldırmaya çalışıyor mu kontrol et
  if (chatRoom.creator.toString() === participantId) {
    return next(new ErrorResponse('Sohbet oluşturucusunun admin rolü kaldırılamaz', 400));
  }

  // Kullanıcının bu sohbette oluşturucu olup olmadığını kontrol et
  const isCreator = chatRoom.creator.toString() === userId.toString();

  // Sadece oluşturucu başka bir adminin rolünü kaldırabilir
  if (!isCreator) {
    return next(new ErrorResponse('Sadece sohbetin oluşturucusu admin rolünü kaldırabilir', 403));
  }

  // Hedef kullanıcının grupta olup olmadığını kontrol et
  const participantIndex = chatRoom.participants.findIndex(
    (participant) => participant.user.toString() === participantId,
  );

  if (participantIndex === -1) {
    return next(new ErrorResponse('Bu kullanıcı sohbette bulunmuyor', 400));
  }

  // Hedef kullanıcı admin mi kontrol et
  if (!chatRoom.participants[participantIndex].isAdmin) {
    return next(new ErrorResponse('Bu kullanıcı zaten admin değil', 400));
  }

  // Kullanıcının admin rolünü kaldır
  await ChatRoom.updateOne(
    { _id: chatId, 'participants.user': participantId },
    { $set: { 'participants.$.isAdmin': false } },
  );

  // Güncellenmiş sohbet odasını getir
  const updatedChatRoom = await ChatRoom.findById(chatId)
    .populate('participants.user', 'username profilePicture')
    .populate('creator', 'username profilePicture');

  res.status(200).json({
    success: true,
    message: 'Kullanıcının admin rolü başarıyla kaldırıldı',
    data: updatedChatRoom,
  });

  // Burada socket.io ile gerçek zamanlı admin kaldırma bildirimi yapılabilir
  // Örnek: io.to(chatId).emit('adminRemoved', { chatRoom: updatedChatRoom, removedAdmin: participantId });
});

/**
 * @desc    Yazıyor bilgisi gönder
 * @route   POST /api/chats/:chatId/typing
 * @access  Private
 */
const markAsTyping = asyncHandler(async (req, res, next) => {
  const { chatId } = req.params;
  const userId = req.user._id;

  // Geçerli ID kontrolü
  if (!mongoose.Types.ObjectId.isValid(chatId)) {
    return next(new ErrorResponse('Geçersiz sohbet odası ID formatı', 400));
  }

  // Sohbet odasını bul
  const chatRoom = await ChatRoom.findById(chatId);

  if (!chatRoom) {
    return next(new ErrorResponse('Sohbet odası bulunamadı', 404));
  }

  // Kullanıcının bu sohbette olup olmadığını kontrol et
  const isParticipant = chatRoom.participants.some(
    (participant) => participant.user.toString() === userId.toString(),
  );

  if (!isParticipant) {
    return next(new ErrorResponse('Bu sohbet odasına erişim izniniz yok', 403));
  }

  // Burada socket.io ile yazıyor bildirimi yapılabilir
  // Örnek: io.to(chatId).emit('userTyping', { chatId, userId, username: req.user.username });

  res.status(200).json({
    success: true,
    message: 'Yazıyor bilgisi gönderildi',
  });
});

/**
 * @desc    Yazıyor bilgisini durdur
 * @route   DELETE /api/chats/:chatId/typing
 * @access  Private
 */
const stopTyping = asyncHandler(async (req, res, next) => {
  const { chatId } = req.params;
  const userId = req.user._id;

  // Geçerli ID kontrolü
  if (!mongoose.Types.ObjectId.isValid(chatId)) {
    return next(new ErrorResponse('Geçersiz sohbet odası ID formatı', 400));
  }

  // Sohbet odasını bul
  const chatRoom = await ChatRoom.findById(chatId);

  if (!chatRoom) {
    return next(new ErrorResponse('Sohbet odası bulunamadı', 404));
  }

  // Kullanıcının bu sohbette olup olmadığını kontrol et
  const isParticipant = chatRoom.participants.some(
    (participant) => participant.user.toString() === userId.toString(),
  );

  if (!isParticipant) {
    return next(new ErrorResponse('Bu sohbet odasına erişim izniniz yok', 403));
  }

  // Burada socket.io ile yazıyor durdu bildirimi yapılabilir
  // Örnek: io.to(chatId).emit('userStoppedTyping', { chatId, userId });

  res.status(200).json({
    success: true,
    message: 'Yazıyor bilgisi durduruldu',
  });
});

/**
 * @desc    Sohbet odasını sil
 * @route   DELETE /api/chats/:chatId
 * @access  Private
 */
const deleteChatRoom = asyncHandler(async (req, res, next) => {
  const { chatId } = req.params;
  const userId = req.user._id;

  // Geçerli ID kontrolü
  if (!mongoose.Types.ObjectId.isValid(chatId)) {
    return next(new ErrorResponse('Geçersiz sohbet odası ID formatı', 400));
  }

  // Sohbet odasını bul
  const chatRoom = await ChatRoom.findById(chatId);

  if (!chatRoom) {
    return next(new ErrorResponse('Sohbet odası bulunamadı', 404));
  }

  // Direct chat ise, her iki kullanıcının da onayı olmalı
  if (chatRoom.type === 'direct') {
    // Kullanıcının bu sohbette olup olmadığını kontrol et
    const isParticipant = chatRoom.participants.some(
      (participant) => participant.user.toString() === userId.toString(),
    );

    if (!isParticipant) {
      return next(new ErrorResponse('Bu sohbet odasına erişim izniniz yok', 403));
    }

    // Direkt sohbetler için katılımcılar kendilerini çıkarabilir (soft delete)
    await ChatRoom.updateOne(
      { _id: chatId, 'participants.user': userId },
      { $set: { 'participants.$.isDeleted': true, 'participants.$.deletedAt': new Date() } },
    );

    // Diğer kullanıcı da sildi mi kontrol et
    const updatedChatRoom = await ChatRoom.findById(chatId);
    const allDeleted = updatedChatRoom.participants.every((p) => p.isDeleted);

    if (allDeleted) {
      // Her iki kullanıcı da sildiyse, sohbeti tamamen kaldır
      await ChatRoom.findByIdAndDelete(chatId);
      await ChatMessage.deleteMany({ room: chatId });
    }

    return res.status(200).json({
      success: true,
      message: 'Sohbet başarıyla silindi',
      data: {},
    });
  }

  // Grup sohbeti ise, sadece oluşturucu silebilir
  const isCreator = chatRoom.creator.toString() === userId.toString();

  if (!isCreator) {
    return next(new ErrorResponse('Sadece sohbetin oluşturucusu grubu silebilir', 403));
  }

  // Sohbeti ve ilgili tüm mesajları sil
  await ChatRoom.findByIdAndDelete(chatId);
  await ChatMessage.deleteMany({ room: chatId });

  res.status(200).json({
    success: true,
    message: 'Sohbet odası başarıyla silindi',
    data: {},
  });

  // Burada socket.io ile gerçek zamanlı sohbet silindi bildirimi yapılabilir
  // Örnek: io.to(chatId).emit('chatRoomDeleted', { chatId });
});

/**
 * @desc    Sohbet odasında mesajları sessize al/aç
 * @route   PUT /api/chats/:chatId/mute
 * @access  Private
 */
const toggleMute = asyncHandler(async (req, res, next) => {
  const { chatId } = req.params;
  const { muted } = req.body;
  const userId = req.user._id;

  // Geçerli ID kontrolü
  if (!mongoose.Types.ObjectId.isValid(chatId)) {
    return next(new ErrorResponse('Geçersiz sohbet odası ID formatı', 400));
  }

  // Mute değeri gerekli
  if (muted === undefined) {
    return next(new ErrorResponse('Mute durumu belirtilmelidir', 400));
  }

  // Sohbet odasını bul
  const chatRoom = await ChatRoom.findById(chatId);

  if (!chatRoom) {
    return next(new ErrorResponse('Sohbet odası bulunamadı', 404));
  }

  // Kullanıcının bu sohbette olup olmadığını kontrol et
  const participantIndex = chatRoom.participants.findIndex(
    (participant) => participant.user.toString() === userId.toString(),
  );

  if (participantIndex === -1) {
    return next(new ErrorResponse('Bu sohbet odasına erişim izniniz yok', 403));
  }

  // Sessize alma durumunu güncelle
  await ChatRoom.updateOne(
    { _id: chatId, 'participants.user': userId },
    { $set: { 'participants.$.muted': muted } },
  );

  res.status(200).json({
    success: true,
    message: muted ? 'Sohbet sessize alındı' : 'Sohbet bildirimleri açıldı',
    data: { muted },
  });
});

module.exports = {
  getUserChatRooms,
  createDirectChat,
  createGroupChat,
  getChatRoom,
  getChatMessages,
  sendMessage,
  editMessage,
  deleteMessage,
  leaveChat,
  addChatParticipants,
  removeChatParticipant,
  updateChatRoom,
  addAdminRole,
  removeAdminRole,
  markAsTyping,
  stopTyping,
  deleteChatRoom,
  toggleMute,
};
