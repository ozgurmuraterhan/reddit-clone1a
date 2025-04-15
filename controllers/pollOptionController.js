const mongoose = require('mongoose');
const { Poll, Vote, PollOption, User, Subreddit, ModLog, Notification } = require('../models');
const { checkUserPermissions } = require('../utils/validators');
const asyncHandler = require('../middleware/async');

/**
 * @desc    Ankete yeni seçenek ekle
 * @route   POST /api/polls/:pollId/options
 * @access  Private
 */
const addOption = asyncHandler(async (req, res) => {
  const { pollId } = req.params;
  const { text } = req.body;
  const userId = req.user._id;

  // Geçerlilik kontrolleri
  if (!mongoose.Types.ObjectId.isValid(pollId)) {
    return res.status(400).json({
      success: false,
      message: 'Geçersiz anket ID formatı',
    });
  }

  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return res.status(400).json({
      success: false,
      message: 'Seçenek metni gereklidir',
    });
  }

  if (text.trim().length > 100) {
    return res.status(400).json({
      success: false,
      message: 'Seçenek metni 100 karakterden uzun olamaz',
    });
  }

  // Anketi bul
  const poll = await Poll.findById(pollId);
  if (!poll) {
    return res.status(404).json({
      success: false,
      message: 'Anket bulunamadı',
    });
  }

  // Anket durumunu kontrol et
  if (poll.status !== 'active') {
    return res.status(400).json({
      success: false,
      message: 'Kapalı veya süresi dolmuş ankete seçenek eklenemez',
    });
  }

  // Seçenek ekleme iznini kontrol et
  if (!poll.allowAddingOptions) {
    return res.status(403).json({
      success: false,
      message: 'Bu ankete seçenek ekleme özelliği kapalı',
    });
  }

  // Yetki kontrolü
  const isCreator = poll.creator.equals(userId);
  const isAdmin = req.user.role === 'admin';

  let isModerator = false;
  if (poll.subreddit) {
    isModerator = await checkUserPermissions(req.user._id, poll.subreddit, 'poll', 'manage_any');
  }

  // Normal kullanıcıların seçenek ekleyebilmesi için özel bir ayar kontrolü
  const canUserAddOption = poll.allowAddingOptions && poll.userAdditionEnabled;

  if (!isCreator && !isAdmin && !isModerator && !canUserAddOption) {
    return res.status(403).json({
      success: false,
      message: 'Bu ankete seçenek ekleme yetkiniz yok',
    });
  }

  // Maksimum seçenek sayısı kontrolü
  if (poll.options.length >= 20) {
    return res.status(400).json({
      success: false,
      message: 'Bir ankete en fazla 20 seçenek eklenebilir',
    });
  }

  // Seçeneğin benzersiz olduğunu kontrol et
  const normalizedText = text.trim();
  const exists = poll.options.some(
    (option) => option.text.toLowerCase() === normalizedText.toLowerCase(),
  );

  if (exists) {
    return res.status(400).json({
      success: false,
      message: 'Bu seçenek zaten mevcut',
    });
  }

  // Yeni seçenek oluştur
  const newOption = {
    text: normalizedText,
    votes: 0,
    addedBy: userId,
    addedAt: Date.now(),
  };

  // Seçeneği ankete ekle
  poll.options.push(newOption);
  await poll.save();

  // Eklenen seçeneği al
  const addedOption = poll.options[poll.options.length - 1];

  // ModLog kaydı oluştur
  if (poll.subreddit) {
    await ModLog.create({
      subreddit: poll.subreddit,
      user: userId,
      action: 'poll_option_added',
      details: `"${normalizedText}" seçeneği "${poll.question.substring(0, 40)}${poll.question.length > 40 ? '...' : ''}" anketine eklendi`,
      targetType: 'poll',
      targetId: poll._id,
    });
  }

  // Anket sahibine bildirim gönder (kendisi değilse)
  if (!poll.creator.equals(userId)) {
    await Notification.create({
      recipient: poll.creator,
      sender: userId,
      type: 'poll_option_added',
      reference: {
        type: 'Poll',
        id: poll._id,
      },
      message: `${req.user.username} anketinize yeni bir seçenek ekledi: "${normalizedText}"`,
      isRead: false,
    });
  }

  res.status(201).json({
    success: true,
    message: 'Seçenek başarıyla eklendi',
    data: {
      option: addedOption,
      poll: {
        _id: poll._id,
        question: poll.question,
      },
    },
  });
});

/**
 * @desc    Anket seçeneğini güncelle
 * @route   PUT /api/polls/:pollId/options/:optionId
 * @access  Private
 */
const updateOption = asyncHandler(async (req, res) => {
  const { pollId, optionId } = req.params;
  const { text } = req.body;
  const userId = req.user._id;

  // Geçerlilik kontrolleri
  if (!mongoose.Types.ObjectId.isValid(pollId) || !mongoose.Types.ObjectId.isValid(optionId)) {
    return res.status(400).json({
      success: false,
      message: 'Geçersiz ID formatı',
    });
  }

  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return res.status(400).json({
      success: false,
      message: 'Seçenek metni gereklidir',
    });
  }

  if (text.trim().length > 100) {
    return res.status(400).json({
      success: false,
      message: 'Seçenek metni 100 karakterden uzun olamaz',
    });
  }

  // Anketi bul
  const poll = await Poll.findById(pollId);
  if (!poll) {
    return res.status(404).json({
      success: false,
      message: 'Anket bulunamadı',
    });
  }

  // Seçeneği bul
  const option = poll.options.id(optionId);
  if (!option) {
    return res.status(404).json({
      success: false,
      message: 'Seçenek bulunamadı',
    });
  }

  // Anket durumunu kontrol et
  if (poll.status !== 'active') {
    return res.status(400).json({
      success: false,
      message: 'Kapalı veya süresi dolmuş anket seçenekleri güncellenemez',
    });
  }

  // Yetki kontrolü
  const isCreator = poll.creator.equals(userId);
  const isOptionCreator = option.addedBy && option.addedBy.equals(userId);
  const isAdmin = req.user.role === 'admin';

  let isModerator = false;
  if (poll.subreddit) {
    isModerator = await checkUserPermissions(req.user._id, poll.subreddit, 'poll', 'manage_any');
  }

  if (!isCreator && !isAdmin && !isModerator && !(isOptionCreator && poll.allowEditingOwnOptions)) {
    return res.status(403).json({
      success: false,
      message: 'Bu seçeneği düzenleme yetkiniz yok',
    });
  }

  // Oy verilmiş seçeneklerin düzenlenmesini engelleyebiliriz
  if (option.votes > 0 && !poll.allowEditingVotedOptions) {
    return res.status(400).json({
      success: false,
      message: 'Oy verilmiş seçenekler düzenlenemez',
    });
  }

  // Seçeneğin benzersiz olduğunu kontrol et
  const normalizedText = text.trim();
  const exists = poll.options.some(
    (opt) =>
      opt._id.toString() !== optionId && opt.text.toLowerCase() === normalizedText.toLowerCase(),
  );

  if (exists) {
    return res.status(400).json({
      success: false,
      message: 'Bu metinle başka bir seçenek zaten mevcut',
    });
  }

  // Seçeneği güncelle
  const originalText = option.text;
  option.text = normalizedText;
  option.updatedBy = userId;
  option.updatedAt = Date.now();

  await poll.save();

  // ModLog kaydı oluştur
  if (poll.subreddit) {
    await ModLog.create({
      subreddit: poll.subreddit,
      user: userId,
      action: 'poll_option_updated',
      details: `"${originalText}" seçeneği "${normalizedText}" olarak güncellendi (Anket: "${poll.question.substring(0, 40)}${poll.question.length > 40 ? '...' : ''}")`,
      targetType: 'poll',
      targetId: poll._id,
    });
  }

  // Anket sahibine bildirim gönder (kendisi değilse)
  if (!poll.creator.equals(userId)) {
    await Notification.create({
      recipient: poll.creator,
      sender: userId,
      type: 'poll_option_updated',
      reference: {
        type: 'Poll',
        id: poll._id,
      },
      message: `${req.user.username} anketinizdeki bir seçeneği güncelledi: "${originalText}" → "${normalizedText}"`,
      isRead: false,
    });
  }

  res.status(200).json({
    success: true,
    message: 'Seçenek başarıyla güncellendi',
    data: {
      option: option,
      poll: {
        _id: poll._id,
        question: poll.question,
      },
    },
  });
});

/**
 * @desc    Seçeneği sil
 * @route   DELETE /api/polls/:pollId/options/:optionId
 * @access  Private
 */
const deleteOption = asyncHandler(async (req, res) => {
  const { pollId, optionId } = req.params;
  const userId = req.user._id;

  // Geçerlilik kontrolleri
  if (!mongoose.Types.ObjectId.isValid(pollId) || !mongoose.Types.ObjectId.isValid(optionId)) {
    return res.status(400).json({
      success: false,
      message: 'Geçersiz ID formatı',
    });
  }

  // Anketi bul
  const poll = await Poll.findById(pollId);
  if (!poll) {
    return res.status(404).json({
      success: false,
      message: 'Anket bulunamadı',
    });
  }

  // Seçeneği bul
  const option = poll.options.id(optionId);
  if (!option) {
    return res.status(404).json({
      success: false,
      message: 'Seçenek bulunamadı',
    });
  }

  // Anket durumunu kontrol et
  if (poll.status !== 'active') {
    return res.status(400).json({
      success: false,
      message: 'Kapalı veya süresi dolmuş anket seçenekleri silinemez',
    });
  }

  // Seçenek sayısını kontrol et - en az 2 seçenek olmalı
  if (poll.options.length <= 2) {
    return res.status(400).json({
      success: false,
      message: 'Bir ankette en az 2 seçenek bulunmalıdır',
    });
  }

  // Yetki kontrolü
  const isCreator = poll.creator.equals(userId);
  const isOptionCreator = option.addedBy && option.addedBy.equals(userId);
  const isAdmin = req.user.role === 'admin';

  let isModerator = false;
  if (poll.subreddit) {
    isModerator = await checkUserPermissions(req.user._id, poll.subreddit, 'poll', 'manage_any');
  }

  if (
    !isCreator &&
    !isAdmin &&
    !isModerator &&
    !(isOptionCreator && poll.allowDeletingOwnOptions)
  ) {
    return res.status(403).json({
      success: false,
      message: 'Bu seçeneği silme yetkiniz yok',
    });
  }

  // Oy verilmiş seçeneklerin silinmesini engelleyebiliriz
  if (option.votes > 0) {
    return res.status(400).json({
      success: false,
      message: 'Oy verilmiş seçenekler silinemez',
    });
  }

  // Seçeneği kaydet (silinecek)
  const deletedOption = {
    text: option.text,
    _id: option._id,
  };

  // Seçeneği kaldır
  poll.options.pull(optionId);
  await poll.save();

  // ModLog kaydı oluştur
  if (poll.subreddit) {
    await ModLog.create({
      subreddit: poll.subreddit,
      user: userId,
      action: 'poll_option_deleted',
      details: `"${deletedOption.text}" seçeneği anketten silindi (Anket: "${poll.question.substring(0, 40)}${poll.question.length > 40 ? '...' : ''}")`,
      targetType: 'poll',
      targetId: poll._id,
    });
  }

  // Anket sahibine bildirim gönder (kendisi değilse)
  if (!poll.creator.equals(userId)) {
    await Notification.create({
      recipient: poll.creator,
      sender: userId,
      type: 'poll_option_deleted',
      reference: {
        type: 'Poll',
        id: poll._id,
      },
      message: `${req.user.username} anketinizdeki "${deletedOption.text}" seçeneğini sildi`,
      isRead: false,
    });
  }

  res.status(200).json({
    success: true,
    message: 'Seçenek başarıyla silindi',
    data: {
      deletedOption,
      poll: {
        _id: poll._id,
        question: poll.question,
        optionsCount: poll.options.length,
      },
    },
  });
});

/**
 * @desc    Seçeneğe oy ver
 * @route   POST /api/polls/:pollId/options/:optionId/vote
 * @access  Private
 */
const voteForOption = asyncHandler(async (req, res) => {
  const { pollId, optionId } = req.params;
  const userId = req.user._id;

  // Geçerlilik kontrolleri
  if (!mongoose.Types.ObjectId.isValid(pollId) || !mongoose.Types.ObjectId.isValid(optionId)) {
    return res.status(400).json({
      success: false,
      message: 'Geçersiz ID formatı',
    });
  }

  // Anketi bul
  const poll = await Poll.findById(pollId);
  if (!poll) {
    return res.status(404).json({
      success: false,
      message: 'Anket bulunamadı',
    });
  }

  // Seçeneği bul
  const option = poll.options.id(optionId);
  if (!option) {
    return res.status(404).json({
      success: false,
      message: 'Seçenek bulunamadı',
    });
  }

  // Anket durumunu kontrol et
  if (poll.status !== 'active') {
    return res.status(400).json({
      success: false,
      message: 'Kapalı veya süresi dolmuş ankete oy verilemez',
    });
  }

  // Minimum hesap yaşı kontrolü
  if (poll.minimumAccountAge > 0) {
    const user = await User.findById(userId).select('createdAt');
    const accountAge = (Date.now() - user.createdAt.getTime()) / (1000 * 60 * 60 * 24); // Gün olarak hesap yaşı

    if (accountAge < poll.minimumAccountAge) {
      return res.status(403).json({
        success: false,
        message: `Bu ankete oy vermek için hesabınızın en az ${poll.minimumAccountAge} günlük olması gerekiyor`,
      });
    }
  }

  // Kullanıcının daha önce oy verip vermediğini kontrol et
  const existingVote = await Vote.findOne({
    poll: pollId,
    user: userId,
  });

  // Çoklu oy izni kontrolü
  if (existingVote && !poll.allowMultipleVotes) {
    return res.status(400).json({
      success: false,
      message: 'Bu ankette sadece bir seçeneğe oy verebilirsiniz',
    });
  }

  // Kullanıcı aynı seçeneğe tekrar oy vermeye çalışıyor mu?
  if (existingVote && existingVote.options.includes(optionId)) {
    return res.status(400).json({
      success: false,
      message: 'Bu seçeneğe zaten oy verdiniz',
    });
  }

  let updateOperation;
  let actionMessage;

  if (existingVote) {
    // Var olan oya yeni seçenek ekle
    updateOperation = Vote.updateOne(
      { _id: existingVote._id },
      { $addToSet: { options: optionId }, $set: { timestamp: Date.now() } },
    );

    // Seçeneğin oy sayısını güncelle
    option.votes += 1;
    actionMessage = 'Oyunuz başarıyla güncellendi';
  } else {
    // Yeni oy oluştur
    updateOperation = Vote.create({
      poll: pollId,
      user: userId,
      options: [optionId],
      timestamp: Date.now(),
    });

    // Seçeneğin oy sayısını güncelle
    option.votes += 1;
    poll.totalVotes += 1;
    actionMessage = 'Oyunuz başarıyla kaydedildi';
  }

  // İşlemleri gerçekleştir
  await Promise.all([updateOperation, poll.save()]);

  // Kullanıcıya bildirim (anket sahibine)
  if (!poll.creator.equals(userId) && poll.notifyOnVote) {
    await Notification.create({
      recipient: poll.creator,
      sender: userId,
      type: 'poll_vote',
      reference: {
        type: 'Poll',
        id: poll._id,
      },
      message: `${req.user.username} anketinizde "${option.text}" seçeneğine oy verdi`,
      isRead: false,
    });
  }

  // Başarılı yanıt
  res.status(200).json({
    success: true,
    message: actionMessage,
    data: {
      poll: {
        _id: poll._id,
        question: poll.question,
      },
      option: {
        _id: option._id,
        text: option.text,
        votes: option.votes,
      },
      totalVotes: poll.totalVotes,
    },
  });
});

/**
 * @desc    Seçenekten oyu geri çek
 * @route   DELETE /api/polls/:pollId/options/:optionId/vote
 * @access  Private
 */
const removeVoteFromOption = asyncHandler(async (req, res) => {
  const { pollId, optionId } = req.params;
  const userId = req.user._id;

  // Geçerlilik kontrolleri
  if (!mongoose.Types.ObjectId.isValid(pollId) || !mongoose.Types.ObjectId.isValid(optionId)) {
    return res.status(400).json({
      success: false,
      message: 'Geçersiz ID formatı',
    });
  }

  // Anketi bul
  const poll = await Poll.findById(pollId);
  if (!poll) {
    return res.status(404).json({
      success: false,
      message: 'Anket bulunamadı',
    });
  }

  // Seçeneği bul
  const option = poll.options.id(optionId);
  if (!option) {
    return res.status(404).json({
      success: false,
      message: 'Seçenek bulunamadı',
    });
  }

  // Anket durumunu kontrol et
  if (poll.status !== 'active') {
    return res.status(400).json({
      success: false,
      message: 'Kapalı veya süresi dolmuş anketteki oylar geri çekilemez',
    });
  }

  // Oy geri çekme seçeneği açık mı?
  if (!poll.allowVoteWithdrawal) {
    return res.status(400).json({
      success: false,
      message: 'Bu ankette oylar geri çekilemez',
    });
  }

  // Kullanıcının bu seçeneğe oy verdiğini kontrol et
  const existingVote = await Vote.findOne({
    poll: pollId,
    user: userId,
    options: optionId,
  });

  if (!existingVote) {
    return res.status(400).json({
      success: false,
      message: 'Bu seçeneğe oy vermediğiniz için geri çekme işlemi yapamazsınız',
    });
  }

  // Kullanıcının tek oyunu mu çekiyor?
  const isSingleVote = existingVote.options.length === 1;

  if (isSingleVote) {
    // Oy kaydını tamamen sil
    await Vote.deleteOne({ _id: existingVote._id });

    // Anket ve seçenek istatistiklerini güncelle
    option.votes -= 1;
    poll.totalVotes -= 1;
  } else {
    // Seçeneği oy kaydından çıkar
    await Vote.updateOne(
      { _id: existingVote._id },
      { $pull: { options: optionId }, $set: { timestamp: Date.now() } },
    );

    // Seçenek istatistiklerini güncelle
    option.votes -= 1;
  }

  // Anketi kaydet
  await poll.save();

  // Başarılı yanıt
  res.status(200).json({
    success: true,
    message: 'Oyunuz başarıyla geri çekildi',
    data: {
      poll: {
        _id: poll._id,
        question: poll.question,
      },
      option: {
        _id: option._id,
        text: option.text,
        votes: option.votes,
      },
      totalVotes: poll.totalVotes,
      voteRemoved: true,
      allVotesRemoved: isSingleVote,
    },
  });
});

/**
 * @desc    Seçenek detaylarını ve oy istatistiklerini getir
 * @route   GET /api/polls/:pollId/options/:optionId
 * @access  Public
 */
const getOptionDetails = asyncHandler(async (req, res) => {
  const { pollId, optionId } = req.params;

  // Geçerlilik kontrolleri
  if (!mongoose.Types.ObjectId.isValid(pollId) || !mongoose.Types.ObjectId.isValid(optionId)) {
    return res.status(400).json({
      success: false,
      message: 'Geçersiz ID formatı',
    });
  }

  // Anketi bul
  const poll = await Poll.findById(pollId);
  if (!poll) {
    return res.status(404).json({
      success: false,
      message: 'Anket bulunamadı',
    });
  }

  // Seçeneği bul
  const option = poll.options.id(optionId);
  if (!option) {
    return res.status(404).json({
      success: false,
      message: 'Seçenek bulunamadı',
    });
  }

  // Sonuçların gizlenmesi gerekip gerekmediğini kontrol et
  let hideResults = false;

  if (poll.hideResultsUntilClosed && poll.status !== 'closed') {
    if (!req.user || (!req.user._id.equals(poll.creator) && req.user.role !== 'admin')) {
      // Moderatör kontrolü
      if (poll.subreddit) {
        const isModerator =
          req.user &&
          (await checkUserPermissions(req.user._id, poll.subreddit, 'poll', 'manage_any'));
        if (!isModerator) {
          hideResults = true;
        }
      } else {
        hideResults = true;
      }
    }
  }

  // Kullanıcının oyu
  let userVoted = false;
  if (req.user) {
    const vote = await Vote.findOne({
      poll: pollId,
      user: req.user._id,
      options: optionId,
    });
    userVoted = !!vote;
  }

  // Seçenek bilgilerini hazırla
  const optionData = {
    _id: option._id,
    text: option.text,
    votes: hideResults ? (userVoted ? 1 : 0) : option.votes,
    percentage: hideResults
      ? 0
      : poll.totalVotes > 0
        ? Math.round((option.votes / poll.totalVotes) * 100)
        : 0,
    addedBy: option.addedBy,
    addedAt: option.addedAt,
    updatedAt: option.updatedAt,
    userVoted,
  };

  // Seçeneği ekleyen kullanıcı bilgilerini ekle
  if (option.addedBy) {
    const user = await User.findById(option.addedBy).select('username avatar');
    if (user) {
      optionData.addedByUser = {
        _id: user._id,
        username: user.username,
        avatar: user.avatar,
      };
    }
  }

  // Son oy verenler (sonuçlar gizli değilse)
  if (!hideResults) {
    const recentVotes = await Vote.find({ poll: pollId, options: optionId })
      .populate('user', 'username avatar')
      .sort('-timestamp')
      .limit(5);

    optionData.recentVoters = recentVotes.map((vote) => ({
      username: vote.user.username,
      avatar: vote.user.avatar,
      timestamp: vote.timestamp,
    }));
  }

  res.status(200).json({
    success: true,
    data: {
      option: optionData,
      poll: {
        _id: poll._id,
        question: poll.question,
        status: poll.status,
        totalVotes: poll.totalVotes,
        hideResults: hideResults,
      },
    },
  });
});

/**
 * @desc    Seçeneğe oy verenlerin listesi
 * @route   GET /api/polls/:pollId/options/:optionId/voters
 * @access  Private (sadece moderatör veya anket sahibi görebilir)
 */
const getOptionVoters = asyncHandler(async (req, res) => {
  const { pollId, optionId } = req.params;
  const userId = req.user._id;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;

  // Geçerlilik kontrolleri
  if (!mongoose.Types.ObjectId.isValid(pollId) || !mongoose.Types.ObjectId.isValid(optionId)) {
    return res.status(400).json({
      success: false,
      message: 'Geçersiz ID formatı',
    });
  }

  // Anketi bul
  const poll = await Poll.findById(pollId)
    .populate('creator', 'username')
    .populate('subreddit', 'name');

  if (!poll) {
    return res.status(404).json({
      success: false,
      message: 'Anket bulunamadı',
    });
  }

  // Seçeneği bul
  const option = poll.options.id(optionId);
  if (!option) {
    return res.status(404).json({
      success: false,
      message: 'Seçenek bulunamadı',
    });
  }

  // Yetki kontrolü (anket sahibi, admin veya moderatör olmalı)
  const isCreator = poll.creator._id.equals(userId);
  const isAdmin = req.user.role === 'admin';

  let isModerator = false;
  if (poll.subreddit) {
    isModerator = await checkUserPermissions(userId, poll.subreddit._id, 'poll', 'manage_any');
  }

  if (!isCreator && !isAdmin && !isModerator) {
    return res.status(403).json({
      success: false,
      message: 'Bu seçeneğe oy verenlerin listesini görüntüleme yetkiniz yok',
    });
  }

  // Toplam oy sayısını al
  const totalVotes = await Vote.countDocuments({
    poll: pollId,
    options: optionId,
  });

  // Sayfalama
  const startIndex = (page - 1) * limit;
  const endIndex = page * limit;

  // Oyları al
  const votes = await Vote.find({
    poll: pollId,
    options: optionId,
  })
    .populate('user', 'username avatar createdAt')
    .sort('-timestamp')
    .skip(startIndex)
    .limit(limit);

  // Oy veren kullanıcıların listesini hazırla
  const voters = votes.map((vote) => ({
    _id: vote.user._id,
    username: vote.user.username,
    avatar: vote.user.avatar,
    accountAge: Math.floor((Date.now() - new Date(vote.user.createdAt)) / (1000 * 60 * 60 * 24)), // gün cinsinden
    voteTime: vote.timestamp,
  }));

  // Sayfalama meta verileri
  const pagination = {};

  if (endIndex < totalVotes) {
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
    count: voters.length,
    totalVotes,
    pagination,
    data: {
      option: {
        _id: option._id,
        text: option.text,
        votes: option.votes,
      },
      poll: {
        _id: poll._id,
        question: poll.question,
        creator: poll.creator.username,
        subreddit: poll.subreddit ? poll.subreddit.name : null,
      },
      voters,
    },
  });
});

/**
 * @desc    Seçenekleri yeniden sırala
 * @route   PUT /api/polls/:pollId/options/reorder
 * @access  Private (sadece moderatör veya anket sahibi yapabilir)
 */
const reorderOptions = asyncHandler(async (req, res) => {
  const { pollId } = req.params;
  const { orderIds } = req.body;
  const userId = req.user._id;

  // Geçerlilik kontrolleri
  if (!mongoose.Types.ObjectId.isValid(pollId)) {
    return res.status(400).json({
      success: false,
      message: 'Geçersiz anket ID formatı',
    });
  }

  if (!Array.isArray(orderIds)) {
    return res.status(400).json({
      success: false,
      message: 'orderIds bir dizi olmalıdır',
    });
  }

  // Anketi bul
  const poll = await Poll.findById(pollId);
  if (!poll) {
    return res.status(404).json({
      success: false,
      message: 'Anket bulunamadı',
    });
  }

  // Anket durumunu kontrol et
  if (poll.status !== 'active') {
    return res.status(400).json({
      success: false,
      message: 'Kapalı veya süresi dolmuş anket seçenekleri yeniden sıralanamaz',
    });
  }

  // Yetki kontrolü
  const isCreator = poll.creator.equals(userId);
  const isAdmin = req.user.role === 'admin';

  let isModerator = false;
  if (poll.subreddit) {
    isModerator = await checkUserPermissions(userId, poll.subreddit, 'poll', 'manage_any');
  }

  if (!isCreator && !isAdmin && !isModerator) {
    return res.status(403).json({
      success: false,
      message: 'Bu anketin seçeneklerini yeniden sıralama yetkiniz yok',
    });
  }

  // Seçenek sayılarını ve ID'lerin doğruluğunu kontrol et
  if (orderIds.length !== poll.options.length) {
    return res.status(400).json({
      success: false,
      message: 'Sıralama listesi tüm seçenekleri içermelidir',
    });
  }

  // Tüm ID'lerin geçerli olduğunu ve her ID'nin poll.options içinde olduğunu doğrula
  const validOptionIds = new Set(poll.options.map((opt) => opt._id.toString()));
  const allIdsExist = orderIds.every((id) => validOptionIds.has(id));

  if (!allIdsExist) {
    return res.status(400).json({
      success: false,
      message: 'Sıralama listesi geçersiz ID(ler) içeriyor',
    });
  }

  // Yeni seçenek dizisini oluştur
  const reorderedOptions = [];

  orderIds.forEach((optionId) => {
    const option = poll.options.id(optionId);
    if (option) {
      reorderedOptions.push(option);
    }
  });

  // Eski seçenekleri kaldır ve yeni sıralanmış seçenekleri ekle
  poll.options = [];
  reorderedOptions.forEach((option) => {
    poll.options.push(option);
  });

  await poll.save();

  // ModLog kaydı oluştur
  if (poll.subreddit) {
    await ModLog.create({
      subreddit: poll.subreddit,
      user: userId,
      action: 'poll_options_reordered',
      details: `"${poll.question.substring(0, 40)}${poll.question.length > 40 ? '...' : ''}" anketindeki seçenekler yeniden sıralandı`,
      targetType: 'poll',
      targetId: poll._id,
    });
  }

  res.status(200).json({
    success: true,
    message: 'Seçenekler başarıyla yeniden sıralandı',
    data: {
      poll: {
        _id: poll._id,
        question: poll.question,
      },
      options: poll.options,
    },
  });
});

/**
 * @desc    Seçenekleri toplu işlem (highlight, disable, restore)
 * @route   PATCH /api/polls/:pollId/options/batch
 * @access  Private (sadece moderatör veya anket sahibi yapabilir)
 */
const batchUpdateOptions = asyncHandler(async (req, res) => {
  const { pollId } = req.params;
  const { optionIds, action } = req.body;
  const userId = req.user._id;

  // Geçerlilik kontrolleri
  if (!mongoose.Types.ObjectId.isValid(pollId)) {
    return res.status(400).json({
      success: false,
      message: 'Geçersiz anket ID formatı',
    });
  }

  if (!Array.isArray(optionIds) || optionIds.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'optionIds geçerli bir dizi olmalıdır',
    });
  }

  if (!action || !['highlight', 'disable', 'restore'].includes(action)) {
    return res.status(400).json({
      success: false,
      message: 'Geçerli bir işlem belirtmelisiniz: highlight, disable veya restore',
    });
  }

  // Anketi bul
  const poll = await Poll.findById(pollId);
  if (!poll) {
    return res.status(404).json({
      success: false,
      message: 'Anket bulunamadı',
    });
  }

  // Yetki kontrolü
  const isCreator = poll.creator.equals(userId);
  const isAdmin = req.user.role === 'admin';

  let isModerator = false;
  if (poll.subreddit) {
    isModerator = await checkUserPermissions(userId, poll.subreddit, 'poll', 'manage_any');
  }

  if (!isCreator && !isAdmin && !isModerator) {
    return res.status(403).json({
      success: false,
      message: 'Bu anketin seçeneklerini yönetme yetkiniz yok',
    });
  }

  // Seçenekleri güncelle
  let updatedCount = 0;

  for (const optionId of optionIds) {
    const option = poll.options.id(optionId);
    if (!option) continue;

    switch (action) {
      case 'highlight':
        option.isHighlighted = true;
        break;
      case 'disable':
        option.isDisabled = true;
        break;
      case 'restore':
        option.isHighlighted = false;
        option.isDisabled = false;
        break;
    }

    updatedCount++;
  }

  if (updatedCount > 0) {
    await poll.save();
  }

  // İşlem adını Türkçe'ye çevir
  const actionNames = {
    highlight: 'vurgulandı',
    disable: 'devre dışı bırakıldı',
    restore: 'geri yüklendi',
  };

  // ModLog kaydı oluştur
  if (poll.subreddit) {
    await ModLog.create({
      subreddit: poll.subreddit,
      user: userId,
      action: `poll_options_${action}ed`,
      details: `"${poll.question.substring(0, 40)}${poll.question.length > 40 ? '...' : ''}" anketinde ${updatedCount} seçenek ${actionNames[action]}`,
      targetType: 'poll',
      targetId: poll._id,
    });
  }

  res.status(200).json({
    success: true,
    message: `${updatedCount} seçenek başarıyla ${actionNames[action]}`,
    data: {
      poll: {
        _id: poll._id,
        question: poll.question,
      },
      updatedOptions: updatedCount,
      action: action,
    },
  });
});

module.exports = {
  addOption,
  updateOption,
  deleteOption,
  voteForOption,
  removeVoteFromOption,
  getOptionDetails,
  getOptionVoters,
  reorderOptions,
  batchUpdateOptions,
};
