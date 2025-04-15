const mongoose = require('mongoose');
const { Poll, Vote, Post, User, Subreddit, ModLog, Notification } = require('../models');
const { validatePollOptions, checkUserPermissions } = require('../utils/validators');
const ErrorResponse = require('../utils/errorResponse');
const asyncHandler = require('../middleware/async');

/**
 * @desc    Anket oluştur
 * @route   POST /api/polls
 * @access  Private
 */
const createPoll = asyncHandler(async (req, res) => {
  const {
    question,
    options,
    subredditId,
    duration,
    allowMultipleVotes,
    allowAddingOptions,
    hideResultsUntilClosed,
    postId,
    minimumAccountAge,
  } = req.body;

  // Zorunlu alanları kontrol et
  if (!question || !options || !Array.isArray(options) || options.length < 2) {
    return res.status(400).json({
      success: false,
      message: 'Lütfen bir soru ve en az iki seçenek giriniz',
    });
  }

  // Seçenek sayısını kontrol et
  if (options.length > 10) {
    return res.status(400).json({
      success: false,
      message: 'En fazla 10 seçenek eklenebilir',
    });
  }

  // Seçeneklerin benzersiz olduğunu kontrol et
  const uniqueOptions = [...new Set(options.map((opt) => opt.trim()))];
  if (uniqueOptions.length !== options.length) {
    return res.status(400).json({
      success: false,
      message: 'Seçenekler benzersiz olmalıdır',
    });
  }

  // Anket süresini kontrol et
  const maxDuration = 7 * 24 * 60 * 60 * 1000; // 7 gün (ms)
  const pollDuration = duration ? parseInt(duration) : maxDuration;

  if (pollDuration <= 0 || pollDuration > maxDuration) {
    return res.status(400).json({
      success: false,
      message: `Anket süresi 1 dakika ile 7 gün arasında olmalıdır`,
    });
  }

  // Subreddit'i kontrol et
  if (subredditId) {
    if (!mongoose.Types.ObjectId.isValid(subredditId)) {
      return res.status(400).json({
        success: false,
        message: 'Geçersiz subreddit ID formatı',
      });
    }

    const subreddit = await Subreddit.findById(subredditId);
    if (!subreddit) {
      return res.status(404).json({
        success: false,
        message: 'Subreddit bulunamadı',
      });
    }

    // Kullanıcının bu subreddit'e anket oluşturma izni var mı?
    const hasPermission = await checkUserPermissions(
      req.user._id,
      subredditId,
      'post',
      'create_poll',
    );
    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: "Bu subreddit'e anket oluşturma izniniz yok",
      });
    }
  }

  // Post ID verilmişse, postun varlığını ve sahipliğini kontrol et
  let post = null;
  if (postId) {
    if (!mongoose.Types.ObjectId.isValid(postId)) {
      return res.status(400).json({
        success: false,
        message: 'Geçersiz post ID formatı',
      });
    }

    post = await Post.findById(postId);
    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'İlişkilendirmek istediğiniz gönderi bulunamadı',
      });
    }

    // Sadece gönderi sahibi veya moderatör ekleyebilir
    if (!post.author.equals(req.user._id) && req.user.role !== 'admin') {
      // Moderatör kontrolü
      const isModerator =
        subredditId &&
        (await checkUserPermissions(req.user._id, subredditId, 'post', 'manage_any'));
      if (!isModerator) {
        return res.status(403).json({
          success: false,
          message: 'Bu gönderiye anket ekleme izniniz yok',
        });
      }
    }

    // Postun zaten bir anketi var mı?
    if (post.poll) {
      return res.status(400).json({
        success: false,
        message: 'Bu gönderiye zaten bir anket eklenmiş',
      });
    }
  }

  // Anket seçeneklerini hazırla
  const pollOptions = options.map((option) => ({
    text: option.trim(),
    votes: 0,
  }));

  // Anket bitiş zamanını hesapla
  const endDate = new Date(Date.now() + pollDuration);

  // Anket oluştur
  const poll = await Poll.create({
    question: question.trim(),
    options: pollOptions,
    creator: req.user._id,
    subreddit: subredditId || null,
    endDate,
    status: 'active',
    allowMultipleVotes: !!allowMultipleVotes,
    allowAddingOptions: !!allowAddingOptions,
    hideResultsUntilClosed: !!hideResultsUntilClosed,
    minimumAccountAge: minimumAccountAge || 0,
    totalVotes: 0,
  });

  // Eğer postId verilmişse, posta anketi ekle
  if (post) {
    post.poll = poll._id;
    await post.save();
  }

  // Subreddit'e moderasyon kaydı ekle
  if (subredditId) {
    await ModLog.create({
      subreddit: subredditId,
      user: req.user._id,
      action: 'poll_created',
      details: `"${question.slice(0, 50)}" anketi oluşturuldu`,
      targetType: 'poll',
      targetId: poll._id,
    });
  }

  res.status(201).json({
    success: true,
    data: poll,
    post: post
      ? {
          _id: post._id,
          title: post.title,
        }
      : null,
  });
});

/**
 * @desc    Anket detayını getir
 * @route   GET /api/polls/:id
 * @access  Public
 */
const getPoll = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({
      success: false,
      message: 'Geçersiz anket ID formatı',
    });
  }

  // Anket sorgusu - oyları sayarak ve kullanıcı bilgileriyle
  const poll = await Poll.findById(id)
    .populate('creator', 'username avatar')
    .populate('subreddit', 'name title icon');

  if (!poll) {
    return res.status(404).json({
      success: false,
      message: 'Anket bulunamadı',
    });
  }

  // İlgili gönderiyi bul
  const relatedPost = await Post.findOne({ poll: id }).select('_id title slug createdAt');

  // Kullanıcının oyu
  let userVote = null;
  if (req.user) {
    userVote = await Vote.findOne({
      poll: id,
      user: req.user._id,
    }).select('options timestamp');
  }

  // Sonuçları gösterme durumunu kontrol et
  let hideResults = false;

  if (poll.hideResultsUntilClosed && poll.status !== 'closed') {
    if (!req.user || (!req.user._id.equals(poll.creator._id) && req.user.role !== 'admin')) {
      hideResults = true;
    }
  }

  // Sonuçların gizlenmesi gerekiyorsa, oy sayılarını gizle
  let response = {
    success: true,
    data: {
      ...poll.toObject(),
      options: hideResults
        ? poll.options.map((opt) => ({
            _id: opt._id,
            text: opt.text,
            votes: userVote && userVote.options.includes(opt._id.toString()) ? 1 : 0,
            percentage: 0,
          }))
        : poll.options,
    },
    userVote: userVote
      ? {
          optionIds: userVote.options,
          timestamp: userVote.timestamp,
        }
      : null,
    post: relatedPost || null,
    hideResults,
  };

  res.status(200).json(response);
});

/**
 * @desc    Bir ankete oy ver
 * @route   POST /api/polls/:id/vote
 * @access  Private
 */
const voteOnPoll = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { optionIds } = req.body;
  const userId = req.user._id;

  // Geçerli bir ID ve seçenek kontrolü
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({
      success: false,
      message: 'Geçersiz anket ID formatı',
    });
  }

  if (!optionIds || !Array.isArray(optionIds) || optionIds.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'En az bir seçenek belirtmelisiniz',
    });
  }

  // Anket bilgilerini getir
  const poll = await Poll.findById(id);

  if (!poll) {
    return res.status(404).json({
      success: false,
      message: 'Anket bulunamadı',
    });
  }

  // Anketin durumunu kontrol et
  if (poll.status !== 'active') {
    return res.status(400).json({
      success: false,
      message: 'Bu anket artık aktif değil, oy veremezsiniz',
    });
  }

  // Anketin süresi dolmuş mu kontrol et
  if (new Date() > poll.endDate) {
    // Anket süresini güncelle
    poll.status = 'closed';
    await poll.save();

    return res.status(400).json({
      success: false,
      message: 'Bu anketin süresi doldu, oy veremezsiniz',
    });
  }

  // Minimum hesap yaşı kontrolü
  if (poll.minimumAccountAge > 0) {
    const user = await User.findById(userId).select('createdAt');
    const accountAge = Date.now() - user.createdAt.getTime();
    const minAgeInMillis = poll.minimumAccountAge * 24 * 60 * 60 * 1000; // gün -> ms

    if (accountAge < minAgeInMillis) {
      return res.status(403).json({
        success: false,
        message: `Bu ankete oy vermek için hesabınızın en az ${poll.minimumAccountAge} günlük olması gerekiyor`,
      });
    }
  }

  // Verilen seçeneklerin geçerliliğini kontrol et
  const validOptionIds = poll.options.map((opt) => opt._id.toString());
  const allOptionsValid = optionIds.every((optId) => validOptionIds.includes(optId));

  if (!allOptionsValid) {
    return res.status(400).json({
      success: false,
      message: "Geçersiz seçenek ID'si belirtildi",
    });
  }

  // Çoklu oy seçeneği kontrolü
  if (!poll.allowMultipleVotes && optionIds.length > 1) {
    return res.status(400).json({
      success: false,
      message: 'Bu ankette sadece bir seçeneğe oy verebilirsiniz',
    });
  }

  // Kullanıcının daha önce oy verip vermediğini kontrol et
  const existingVote = await Vote.findOne({
    poll: id,
    user: userId,
  });

  // Bu bir anket güncellemesi mi?
  if (existingVote) {
    // Önceki oyları kaldır
    for (const optionId of existingVote.options) {
      const option = poll.options.id(optionId);
      if (option && option.votes > 0) {
        option.votes -= 1;
      }
    }

    // Yeni oyları ekle
    for (const optionId of optionIds) {
      const option = poll.options.id(optionId);
      if (option) {
        option.votes += 1;
      }
    }

    // Toplam oy sayısını güncelle (toplam oy sayısı değişmez, sadece dağılım değişir)

    // Oyu güncelle
    existingVote.options = optionIds;
    existingVote.timestamp = Date.now();
    await existingVote.save();

    // Anketi kaydet
    await poll.save();

    return res.status(200).json({
      success: true,
      message: 'Oyunuz başarıyla güncellendi',
      data: {
        pollId: poll._id,
        optionIds,
        updated: true,
      },
    });
  }

  // Yeni oy oluştur
  for (const optionId of optionIds) {
    const option = poll.options.id(optionId);
    if (option) {
      option.votes += 1;
    }
  }

  // Toplam oy sayısını güncelle
  poll.totalVotes += 1;

  // Yeni oy kaydı oluştur
  const vote = await Vote.create({
    poll: id,
    user: userId,
    options: optionIds,
    timestamp: Date.now(),
  });

  // Anketi kaydet
  await poll.save();

  // Anketin sahibine bildirim gönder (kendi oyu değilse)
  if (!poll.creator.equals(userId)) {
    await Notification.create({
      recipient: poll.creator,
      type: 'poll_vote',
      sender: userId,
      reference: {
        type: 'Poll',
        id: poll._id,
      },
      message: `${req.user.username} anketinize oy verdi: "${poll.question.substring(0, 40)}${poll.question.length > 40 ? '...' : ''}"`,
      isRead: false,
    });
  }

  res.status(200).json({
    success: true,
    message: 'Oyunuz başarıyla kaydedildi',
    data: {
      pollId: poll._id,
      optionIds,
      vote: {
        _id: vote._id,
        timestamp: vote.timestamp,
      },
    },
  });
});

/**
 * @desc    Ankete yeni seçenek ekle
 * @route   POST /api/polls/:id/options
 * @access  Private
 */
const addPollOption = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { optionText } = req.body;
  const userId = req.user._id;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({
      success: false,
      message: 'Geçersiz anket ID formatı',
    });
  }

  if (!optionText || typeof optionText !== 'string' || optionText.trim().length === 0) {
    return res.status(400).json({
      success: false,
      message: 'Lütfen geçerli bir seçenek metni girin',
    });
  }

  // Anket bilgilerini getir
  const poll = await Poll.findById(id);

  if (!poll) {
    return res.status(404).json({
      success: false,
      message: 'Anket bulunamadı',
    });
  }

  // Anketin durumunu kontrol et
  if (poll.status !== 'active') {
    return res.status(400).json({
      success: false,
      message: 'Bu anket artık aktif değil, seçenek ekleyemezsiniz',
    });
  }

  // Seçenek ekleme özelliği açık mı?
  if (!poll.allowAddingOptions) {
    return res.status(403).json({
      success: false,
      message: 'Bu ankete yeni seçenek ekleme özelliği kapalı',
    });
  }

  // Kullanıcının izni var mı? (anket sahibi veya admin)
  const isCreator = poll.creator.equals(userId);
  const isAdmin = req.user.role === 'admin';

  // Subreddit moderatörü kontrolü
  let isModerator = false;
  if (poll.subreddit) {
    isModerator = await checkUserPermissions(userId, poll.subreddit, 'poll', 'manage_any');
  }

  if (!isCreator && !isAdmin && !isModerator) {
    return res.status(403).json({
      success: false,
      message: 'Bu ankete seçenek ekleme yetkiniz yok',
    });
  }

  // Maksimum seçenek sayısını kontrol et
  if (poll.options.length >= 20) {
    return res.status(400).json({
      success: false,
      message: 'Bir ankete en fazla 20 seçenek eklenebilir',
    });
  }

  // Aynı seçeneğin zaten var olup olmadığını kontrol et
  const normalizedOption = optionText.trim();
  const optionExists = poll.options.some(
    (option) => option.text.toLowerCase() === normalizedOption.toLowerCase(),
  );

  if (optionExists) {
    return res.status(400).json({
      success: false,
      message: 'Bu seçenek zaten ankette mevcut',
    });
  }

  // Yeni seçeneği ekle
  poll.options.push({
    text: normalizedOption,
    votes: 0,
    addedBy: userId,
    addedAt: Date.now(),
  });

  await poll.save();

  // Moderasyon logu oluştur (subreddit varsa)
  if (poll.subreddit) {
    await ModLog.create({
      subreddit: poll.subreddit,
      user: userId,
      action: 'poll_option_added',
      details: `"${normalizedOption}" seçeneği ankete eklendi: "${poll.question.substring(0, 40)}${poll.question.length > 40 ? '...' : ''}"`,
      targetType: 'poll',
      targetId: poll._id,
    });
  }

  // Anket sahibine bildirim gönder (kendi eklemediyse)
  if (!isCreator) {
    await Notification.create({
      recipient: poll.creator,
      type: 'poll_option_added',
      sender: userId,
      reference: {
        type: 'Poll',
        id: poll._id,
      },
      message: `${req.user.username} anketinize yeni bir seçenek ekledi: "${normalizedOption}"`,
      isRead: false,
    });
  }

  res.status(200).json({
    success: true,
    message: 'Seçenek başarıyla eklendi',
    data: {
      pollId: poll._id,
      newOption: poll.options[poll.options.length - 1],
    },
  });
});

/**
 * @desc    Anketi kapat/sonlandır
 * @route   PATCH /api/polls/:id/close
 * @access  Private
 */
const closePoll = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user._id;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({
      success: false,
      message: 'Geçersiz anket ID formatı',
    });
  }

  // Anket bilgilerini getir
  const poll = await Poll.findById(id);

  if (!poll) {
    return res.status(404).json({
      success: false,
      message: 'Anket bulunamadı',
    });
  }

  // Anket zaten kapalı mı?
  if (poll.status === 'closed') {
    return res.status(400).json({
      success: false,
      message: 'Bu anket zaten kapatılmış',
    });
  }

  // Kullanıcının izni var mı? (anket sahibi veya admin)
  const isCreator = poll.creator.equals(userId);
  const isAdmin = req.user.role === 'admin';

  // Subreddit moderatörü kontrolü
  let isModerator = false;
  if (poll.subreddit) {
    isModerator = await checkUserPermissions(userId, poll.subreddit, 'poll', 'manage_any');
  }

  if (!isCreator && !isAdmin && !isModerator) {
    return res.status(403).json({
      success: false,
      message: 'Bu anketi kapatma yetkiniz yok',
    });
  }

  // Anketi kapat
  poll.status = 'closed';
  poll.closedAt = Date.now();
  poll.closedBy = userId;

  await poll.save();

  // İlgili gönderiyi bul
  const relatedPost = await Post.findOne({ poll: id }).select('_id title slug subreddit');

  // Moderasyon logu oluştur (subreddit varsa)
  if (poll.subreddit) {
    await ModLog.create({
      subreddit: poll.subreddit,
      user: userId,
      action: 'poll_closed',
      details: `"${poll.question.substring(0, 40)}${poll.question.length > 40 ? '...' : ''}" anketi kapatıldı`,
      targetType: 'poll',
      targetId: poll._id,
    });
  }

  // Anket sahibine bildirim gönder (kendi kapatmadıysa)
  if (!isCreator) {
    await Notification.create({
      recipient: poll.creator,
      type: 'poll_closed',
      sender: userId,
      reference: {
        type: 'Poll',
        id: poll._id,
      },
      message: `${req.user.username} anketinizi kapattı: "${poll.question.substring(0, 40)}${poll.question.length > 40 ? '...' : ''}"`,
      isRead: false,
    });
  }

  res.status(200).json({
    success: true,
    message: 'Anket başarıyla kapatıldı',
    data: {
      pollId: poll._id,
      status: poll.status,
      closedAt: poll.closedAt,
      post: relatedPost || null,
    },
  });
});

/**
 * @desc    Anketleri listele (subreddit bazlı veya genel)
 * @route   GET /api/polls
 * @route   GET /api/subreddits/:subredditId/polls
 * @access  Public
 */
const listPolls = asyncHandler(async (req, res) => {
  // URL'den subreddit ID'sini al
  const subredditId = req.params.subredditId;

  // Query parametreleri
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 10;
  const sort = req.query.sort || '-createdAt';
  const status =
    req.query.status && ['active', 'closed'].includes(req.query.status) ? req.query.status : null;

  // Sorgu oluştur
  const query = {};

  // Subreddit filtresi ekle
  if (subredditId) {
    if (!mongoose.Types.ObjectId.isValid(subredditId)) {
      return res.status(400).json({
        success: false,
        message: 'Geçersiz subreddit ID formatı',
      });
    }

    // Subreddit'in varlığını kontrol et
    const subreddit = await Subreddit.findById(subredditId);
    if (!subreddit) {
      return res.status(404).json({
        success: false,
        message: 'Subreddit bulunamadı',
      });
    }

    query.subreddit = subredditId;
  }

  // Durum filtresi ekle
  if (status) {
    query.status = status;
  }

  // Sayfalama
  const startIndex = (page - 1) * limit;
  const endIndex = page * limit;
  const total = await Poll.countDocuments(query);

  // Anketleri getir
  const polls = await Poll.find(query)
    .populate('creator', 'username avatar')
    .populate('subreddit', 'name title icon')
    .sort(sort)
    .skip(startIndex)
    .limit(limit);

  // İlgili gönderileri bul
  const pollIds = polls.map((poll) => poll._id);
  const relatedPosts = await Post.find({ poll: { $in: pollIds } }).select(
    '_id title slug poll createdAt',
  );

  // Kullanıcının oylarını getir (giriş yapmışsa)
  let userVotes = [];
  if (req.user) {
    userVotes = await Vote.find({
      poll: { $in: pollIds },
      user: req.user._id,
    }).select('poll options timestamp');
  }

  // Anketleri formatla ve post bilgilerini ekle
  const formattedPolls = polls.map((poll) => {
    // İlgili gönderiyi bul
    const relatedPost = relatedPosts.find(
      (post) => post.poll && post.poll.toString() === poll._id.toString(),
    );

    // Kullanıcının oyunu bul
    const userVote = userVotes.find((vote) => vote.poll.toString() === poll._id.toString());

    // Sonuçları gizleme durumunu kontrol et
    let hideResults = false;
    if (poll.hideResultsUntilClosed && poll.status !== 'closed') {
      if (!req.user || (!req.user._id.equals(poll.creator._id) && req.user.role !== 'admin')) {
        hideResults = true;
      }
    }

    // Anket nesnesini formatla
    const formattedPoll = {
      ...poll.toObject(),
      options: hideResults
        ? poll.options.map((opt) => ({
            _id: opt._id,
            text: opt.text,
            votes: userVote && userVote.options.includes(opt._id.toString()) ? 1 : 0,
            percentage: 0,
          }))
        : poll.options,
      post: relatedPost
        ? {
            _id: relatedPost._id,
            title: relatedPost.title,
            slug: relatedPost.slug,
            createdAt: relatedPost.createdAt,
          }
        : null,
      userVote: userVote
        ? {
            optionIds: userVote.options,
            timestamp: userVote.timestamp,
          }
        : null,
      hideResults,
    };

    return formattedPoll;
  });

  // Yanıt nesnesi
  const response = {
    success: true,
    count: formattedPolls.length,
    totalPages: Math.ceil(total / limit),
    currentPage: page,
    data: formattedPolls,
  };

  // Sayfalama meta verileri
  if (endIndex < total) {
    response.pagination = {
      next: {
        page: page + 1,
        limit,
      },
    };
  }

  if (startIndex > 0) {
    response.pagination = {
      ...response.pagination,
      prev: {
        page: page - 1,
        limit,
      },
    };
  }

  res.status(200).json(response);
});

/**
 * @desc    Anket güncelle
 * @route   PUT /api/polls/:id
 * @access  Private
 */
const updatePoll = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const {
    question,
    allowMultipleVotes,
    allowAddingOptions,
    hideResultsUntilClosed,
    minimumAccountAge,
    endDate,
  } = req.body;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({
      success: false,
      message: 'Geçersiz anket ID formatı',
    });
  }

  // Anket bilgilerini getir
  const poll = await Poll.findById(id);

  if (!poll) {
    return res.status(404).json({
      success: false,
      message: 'Anket bulunamadı',
    });
  }

  // Kullanıcının izni var mı? (anket sahibi veya admin)
  const isCreator = poll.creator.equals(req.user._id);
  const isAdmin = req.user.role === 'admin';

  // Subreddit moderatörü kontrolü
  let isModerator = false;
  if (poll.subreddit) {
    isModerator = await checkUserPermissions(req.user._id, poll.subreddit, 'poll', 'manage_any');
  }

  if (!isCreator && !isAdmin && !isModerator) {
    return res.status(403).json({
      success: false,
      message: 'Bu anketi düzenleme yetkiniz yok',
    });
  }

  // Anket kapalı mı kontrol et
  if (poll.status === 'closed') {
    return res.status(400).json({
      success: false,
      message: 'Kapatılmış anketler düzenlenemez',
    });
  }

  // Ankette oy var mı kontrol et - varsa bazı ayarlar değiştirilemez
  const hasVotes = poll.totalVotes > 0;

  // Güncellenecek alanları belirle
  const updateData = {};

  if (question && typeof question === 'string' && question.trim() !== '') {
    if (hasVotes && question !== poll.question) {
      return res.status(400).json({
        success: false,
        message: 'Oy verilmiş anketin sorusu değiştirilemez',
      });
    }
    updateData.question = question.trim();
  }

  // Boolean değerleri kontrol et ve güncelle
  if (typeof allowMultipleVotes === 'boolean') {
    if (hasVotes && allowMultipleVotes !== poll.allowMultipleVotes) {
      return res.status(400).json({
        success: false,
        message: 'Oy verilmiş anketin çoklu oy ayarı değiştirilemez',
      });
    }
    updateData.allowMultipleVotes = allowMultipleVotes;
  }

  if (typeof allowAddingOptions === 'boolean') {
    updateData.allowAddingOptions = allowAddingOptions;
  }

  if (typeof hideResultsUntilClosed === 'boolean') {
    updateData.hideResultsUntilClosed = hideResultsUntilClosed;
  }

  if (minimumAccountAge !== undefined && !isNaN(minimumAccountAge)) {
    const maxAge = 365; // 1 yıl
    if (minimumAccountAge < 0 || minimumAccountAge > maxAge) {
      return res.status(400).json({
        success: false,
        message: `Minimum hesap yaşı 0 ile ${maxAge} gün arasında olmalıdır`,
      });
    }
    updateData.minimumAccountAge = minimumAccountAge;
  }

  // Bitiş tarihi kontrolü
  if (endDate) {
    const newEndDate = new Date(endDate);
    const now = new Date();

    if (isNaN(newEndDate.getTime())) {
      return res.status(400).json({
        success: false,
        message: 'Geçersiz tarih formatı',
      });
    }

    // Bitiş tarihi geçmiş olamaz
    if (newEndDate <= now) {
      return res.status(400).json({
        success: false,
        message: 'Bitiş tarihi gelecekte olmalıdır',
      });
    }

    // Maksimum süre kontrolü
    const maxDuration = 7 * 24 * 60 * 60 * 1000; // 7 gün (ms)
    if (newEndDate.getTime() - now.getTime() > maxDuration) {
      return res.status(400).json({
        success: false,
        message: 'Anket süresi en fazla 7 gün olabilir',
      });
    }

    updateData.endDate = newEndDate;
  }

  // Anketi güncelle
  const updatedPoll = await Poll.findByIdAndUpdate(
    id,
    { $set: updateData },
    { new: true, runValidators: true },
  );

  // Moderasyon logu oluştur (subreddit varsa)
  if (poll.subreddit) {
    await ModLog.create({
      subreddit: poll.subreddit,
      user: req.user._id,
      action: 'poll_updated',
      details: `"${poll.question.substring(0, 40)}${poll.question.length > 40 ? '...' : ''}" anketi güncellendi`,
      targetType: 'poll',
      targetId: poll._id,
    });
  }

  res.status(200).json({
    success: true,
    message: 'Anket başarıyla güncellendi',
    data: updatedPoll,
  });
});

/**
 * @desc    Anketi sil
 * @route   DELETE /api/polls/:id
 * @access  Private
 */
const deletePoll = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({
      success: false,
      message: 'Geçersiz anket ID formatı',
    });
  }

  // Anket bilgilerini getir
  const poll = await Poll.findById(id);

  if (!poll) {
    return res.status(404).json({
      success: false,
      message: 'Anket bulunamadı',
    });
  }

  // Kullanıcının izni var mı? (anket sahibi veya admin)
  const isCreator = poll.creator.equals(req.user._id);
  const isAdmin = req.user.role === 'admin';

  // Subreddit moderatörü kontrolü
  let isModerator = false;
  if (poll.subreddit) {
    isModerator = await checkUserPermissions(req.user._id, poll.subreddit, 'poll', 'manage_any');
  }

  if (!isCreator && !isAdmin && !isModerator) {
    return res.status(403).json({
      success: false,
      message: 'Bu anketi silme yetkiniz yok',
    });
  }

  // İlgili gönderiyi bul ve anket referansını kaldır
  if (poll.subreddit) {
    await Post.updateOne({ poll: id }, { $unset: { poll: 1 } });
  }

  // İlgili oyları sil
  await Vote.deleteMany({ poll: id });

  // Anketi sil
  await poll.remove();

  // Moderasyon logu oluştur (subreddit varsa)
  if (poll.subreddit) {
    await ModLog.create({
      subreddit: poll.subreddit,
      user: req.user._id,
      action: 'poll_deleted',
      details: `"${poll.question.substring(0, 40)}${poll.question.length > 40 ? '...' : ''}" anketi silindi`,
      targetType: 'poll',
      targetId: poll._id,
    });
  }

  res.status(200).json({
    success: true,
    message: 'Anket başarıyla silindi',
    data: {
      id: poll._id,
      question: poll.question,
    },
  });
});

/**
 * @desc    Anket istatistiklerini getir
 * @route   GET /api/polls/:id/stats
 * @access  Public
 */
const getPollStats = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({
      success: false,
      message: 'Geçersiz anket ID formatı',
    });
  }

  // Anket bilgilerini getir
  const poll = await Poll.findById(id)
    .populate('creator', 'username avatar')
    .populate('subreddit', 'name title icon');

  if (!poll) {
    return res.status(404).json({
      success: false,
      message: 'Anket bulunamadı',
    });
  }

  // Sonuçları gösterme durumunu kontrol et
  let hideResults = false;

  if (poll.hideResultsUntilClosed && poll.status !== 'closed') {
    if (!req.user || (!req.user._id.equals(poll.creator._id) && req.user.role !== 'admin')) {
      // Subreddit moderatörü kontrolü
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

  if (hideResults) {
    return res.status(403).json({
      success: false,
      message: 'Bu anketin sonuçları anket kapanana kadar gizlidir',
    });
  }

  // İstatistikler için oyları getir
  const votes = await Vote.find({ poll: id })
    .populate('user', 'username avatar createdAt')
    .sort('-timestamp');

  // Oy zaman dağılımı
  const hourlyData = {};
  const dailyData = {};

  votes.forEach((vote) => {
    // Saat bazlı dağılım
    const hourKey = new Date(vote.timestamp).toISOString().slice(0, 13);
    hourlyData[hourKey] = (hourlyData[hourKey] || 0) + 1;

    // Gün bazlı dağılım
    const dayKey = new Date(vote.timestamp).toISOString().slice(0, 10);
    dailyData[dayKey] = (dailyData[dayKey] || 0) + 1;
  });

  // Seçeneklere göre oy dağılımı
  const optionStats = {};
  poll.options.forEach((option) => {
    optionStats[option._id] = {
      text: option.text,
      votes: option.votes,
      percentage: poll.totalVotes > 0 ? Math.round((option.votes / poll.totalVotes) * 100) : 0,
    };
  });

  // İlk 10 oy veren kullanıcı (gizlilik için sınırlı bilgi)
  const recentVoters = votes.slice(0, 10).map((vote) => ({
    username: vote.user.username,
    avatar: vote.user.avatar,
    timestamp: vote.timestamp,
  }));

  res.status(200).json({
    success: true,
    data: {
      poll: {
        _id: poll._id,
        question: poll.question,
        status: poll.status,
        createdAt: poll.createdAt,
        endDate: poll.endDate,
        closedAt: poll.closedAt,
        totalVotes: poll.totalVotes,
      },
      creator: {
        _id: poll.creator._id,
        username: poll.creator.username,
        avatar: poll.creator.avatar,
      },
      subreddit: poll.subreddit
        ? {
            _id: poll.subreddit._id,
            name: poll.subreddit.name,
            title: poll.subreddit.title,
            icon: poll.subreddit.icon,
          }
        : null,
      stats: {
        optionStats,
        totalVotes: poll.totalVotes,
        timeDistribution: {
          hourly: hourlyData,
          daily: dailyData,
        },
        recentVoters,
      },
    },
  });
});

module.exports = {
  createPoll,
  getPoll,
  voteOnPoll,
  addPollOption,
  closePoll,
  listPolls,
  updatePoll,
  deletePoll,
  getPollStats,
};
