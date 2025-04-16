const Poll = require('../models/Poll');
const PollOption = require('../models/PollOption');
const PollVote = require('../models/PollVote');
const Post = require('../models/Post');
const User = require('../models/User');
const asyncHandler = require('../middleware/async');
const ErrorResponse = require('../utils/errorResponse');
const mongoose = require('mongoose');

/**
 * @desc    Anket oluştur
 * @route   POST /api/posts/:postId/polls
 * @access  Private
 */
const createPoll = asyncHandler(async (req, res, next) => {
  const { postId } = req.params;
  const { options, endDate, allowMultipleVotes = false, maxSelections = 1 } = req.body;

  // ID formatı kontrolü
  if (!mongoose.Types.ObjectId.isValid(postId)) {
    return next(new ErrorResponse('Geçersiz post ID formatı', 400));
  }

  // Post'u kontrol et
  const post = await Post.findById(postId);

  if (!post) {
    return next(new ErrorResponse('Post bulunamadı', 404));
  }

  // Post sahibi kontrolü
  if (post.author.toString() !== req.user._id.toString()) {
    return next(new ErrorResponse('Sadece post sahibi anket ekleyebilir', 403));
  }

  // Post türü kontrolü
  if (post.type !== 'poll') {
    return next(new ErrorResponse('Bu post anket türünde değil', 400));
  }

  // Zaten anket var mı kontrol et
  const existingPoll = await Poll.findOne({ post: postId });

  if (existingPoll) {
    return next(new ErrorResponse('Bu post için zaten bir anket oluşturulmuş', 400));
  }

  // Anket seçeneklerini doğrula
  if (!options || !Array.isArray(options) || options.length < 2) {
    return next(new ErrorResponse('En az 2 anket seçeneği gereklidir', 400));
  }

  if (options.length > 10) {
    return next(new ErrorResponse('Bir ankette en fazla 10 seçenek olabilir', 400));
  }

  // Boş seçenek var mı kontrol et
  if (options.some((option) => !option.trim())) {
    return next(new ErrorResponse('Boş anket seçeneği olamaz', 400));
  }

  // Bitiş tarihini doğrula
  const parsedEndDate = new Date(endDate);

  if (isNaN(parsedEndDate.getTime())) {
    return next(new ErrorResponse('Geçersiz bitiş tarihi formatı', 400));
  }

  const now = new Date();
  const maxDuration = 7 * 24 * 60 * 60 * 1000; // 7 gün (milisaniye)

  if (parsedEndDate <= now) {
    return next(new ErrorResponse('Bitiş tarihi gelecekte olmalıdır', 400));
  }

  if (parsedEndDate > new Date(now.getTime() + maxDuration)) {
    return next(new ErrorResponse('Anket süresi en fazla 7 gün olabilir', 400));
  }

  // Maksimum seçim sayısını doğrula
  if (maxSelections < 1 || maxSelections > 6) {
    return next(new ErrorResponse('Maksimum seçim sayısı 1-6 arasında olmalıdır', 400));
  }

  if (allowMultipleVotes && maxSelections > options.length) {
    return next(new ErrorResponse('Maksimum seçim sayısı, seçenek sayısından fazla olamaz', 400));
  }

  // Transaction başlat
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Seçenekleri oluştur
    const pollOptions = await PollOption.create(
      options.map((text) => ({
        text,
        votes: 0,
        addedBy: req.user._id,
      })),
      { session },
    );

    // Anket oluştur
    const poll = await Poll.create(
      [
        {
          post: postId,
          options: pollOptions.map((option) => option._id),
          totalVotes: 0,
          endDate: parsedEndDate,
          allowMultipleVotes,
          maxSelections,
        },
      ],
      { session },
    );

    await session.commitTransaction();

    // Tam anket bilgilerini getir
    const fullPoll = await Poll.findById(poll[0]._id).populate('options');

    res.status(201).json({
      success: true,
      data: fullPoll,
    });
  } catch (error) {
    await session.abortTransaction();
    return next(new ErrorResponse('Anket oluşturulurken bir hata oluştu', 500));
  } finally {
    session.endSession();
  }
});

/**
 * @desc    Bir anketi getir
 * @route   GET /api/polls/:id
 * @access  Public
 */
const getPoll = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  // ID formatı kontrolü
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorResponse('Geçersiz anket ID formatı', 400));
  }

  // Anketi ve seçeneklerini getir
  const poll = await Poll.findById(id)
    .populate('options')
    .populate('post', 'title author subreddit')
    .populate({
      path: 'post',
      populate: {
        path: 'author',
        select: 'username profilePicture',
      },
    })
    .populate({
      path: 'post',
      populate: {
        path: 'subreddit',
        select: 'name',
      },
    });

  if (!poll) {
    return next(new ErrorResponse('Anket bulunamadı', 404));
  }

  // Kullanıcının oyları
  let userVotes = [];

  if (req.user) {
    userVotes = await PollVote.find({
      poll: id,
      user: req.user._id,
    }).distinct('option');
  }

  // Anket sonuçlarını belirli durumlarda gizle
  let hideResults = false;

  if (poll.hideResultsUntilClosed && poll.isActive) {
    // Kullanıcı oy vermedi ve admin/moderatör değilse sonuçları gizle
    if (userVotes.length === 0 && (!req.user || req.user.role !== 'admin')) {
      hideResults = true;
    }
  }

  // Sonuçları hazırla
  const preparedPoll = {
    ...poll.toObject(),
    userVotes,
    options: poll.options.map((option) => {
      const optionObj = option.toObject();

      if (hideResults && !userVotes.includes(option._id.toString())) {
        optionObj.votes = 0;
        optionObj.percentage = 0;
      } else {
        optionObj.percentage =
          poll.totalVotes > 0 ? Math.round((option.votes / poll.totalVotes) * 100) : 0;
        optionObj.userVoted = userVotes.includes(option._id.toString());
      }

      return optionObj;
    }),
    hideResults,
  };

  res.status(200).json({
    success: true,
    data: preparedPoll,
  });
});

/**
 * @desc    Post'a ait anketi getir
 * @route   GET /api/posts/:postId/poll
 * @access  Public
 */
const getPostPoll = asyncHandler(async (req, res, next) => {
  const { postId } = req.params;

  // ID formatı kontrolü
  if (!mongoose.Types.ObjectId.isValid(postId)) {
    return next(new ErrorResponse('Geçersiz post ID formatı', 400));
  }

  // Post'u kontrol et
  const post = await Post.findById(postId);

  if (!post) {
    return next(new ErrorResponse('Post bulunamadı', 404));
  }

  // Anketi bul
  const poll = await Poll.findOne({ post: postId })
    .populate('options')
    .populate('post', 'title author subreddit')
    .populate({
      path: 'post',
      populate: {
        path: 'author',
        select: 'username profilePicture',
      },
    });

  if (!poll) {
    return next(new ErrorResponse('Bu post için anket bulunamadı', 404));
  }

  // Kullanıcının oyları
  let userVotes = [];

  if (req.user) {
    userVotes = await PollVote.find({
      poll: poll._id,
      user: req.user._id,
    }).distinct('option');
  }

  // Anket sonuçlarını belirli durumlarda gizle
  let hideResults = false;

  if (poll.hideResultsUntilClosed && poll.isActive) {
    // Kullanıcı oy vermedi ve admin/moderatör değilse sonuçları gizle
    if (userVotes.length === 0 && (!req.user || req.user.role !== 'admin')) {
      hideResults = true;
    }
  }

  // Sonuçları hazırla
  const preparedPoll = {
    ...poll.toObject(),
    userVotes,
    isActive: new Date() < poll.endDate,
    remainingTime:
      new Date() < poll.endDate
        ? Math.floor((poll.endDate - new Date()) / 1000) // kalan süre (saniye)
        : 0,
    options: poll.options.map((option) => {
      const optionObj = option.toObject();

      if (hideResults && !userVotes.includes(option._id.toString())) {
        optionObj.votes = 0;
        optionObj.percentage = 0;
      } else {
        optionObj.percentage =
          poll.totalVotes > 0 ? Math.round((option.votes / poll.totalVotes) * 100) : 0;
        optionObj.userVoted = userVotes.includes(option._id.toString());
      }

      return optionObj;
    }),
    hideResults,
  };

  res.status(200).json({
    success: true,
    data: preparedPoll,
  });
});

/**
 * @desc    Ankete oy ver
 * @route   POST /api/polls/:id/vote
 * @access  Private
 */
const votePoll = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { optionIds } = req.body;

  // ID formatı kontrolü
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorResponse('Geçersiz anket ID formatı', 400));
  }

  // Seçenekleri doğrula
  if (!optionIds || !Array.isArray(optionIds) || optionIds.length === 0) {
    return next(new ErrorResponse('En az bir seçenek belirtilmelidir', 400));
  }

  // Anketi bul
  const poll = await Poll.findById(id).populate('options');

  if (!poll) {
    return next(new ErrorResponse('Anket bulunamadı', 404));
  }

  // Anketin aktif olup olmadığını kontrol et
  if (new Date() > poll.endDate) {
    return next(new ErrorResponse('Bu anket sona ermiş, artık oy verilemez', 400));
  }

  // Kullanıcının daha önce oy verip vermediğini kontrol et
  const existingVotes = await PollVote.find({
    poll: id,
    user: req.user._id,
  });

  // Eğer zaten oy verilmişse ve çoklu oy verme izni yoksa hata ver
  if (existingVotes.length > 0 && !poll.allowMultipleVotes) {
    return next(new ErrorResponse('Bu ankete zaten oy verdiniz', 400));
  }

  // Maksimum seçim sayısını aşmadığından emin ol
  if (optionIds.length > poll.maxSelections) {
    return next(new ErrorResponse(`En fazla ${poll.maxSelections} seçenek seçebilirsiniz`, 400));
  }

  // Seçeneklerin geçerliliğini kontrol et
  const validOptionIds = poll.options.map((option) => option._id.toString());
  const invalidOptions = optionIds.filter((id) => !validOptionIds.includes(id));

  if (invalidOptions.length > 0) {
    return next(new ErrorResponse("Geçersiz seçenek ID'leri: " + invalidOptions.join(', '), 400));
  }

  // Transaction başlat
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Eğer kullanıcı daha önce oy verdiyse ve yeniden oy veriyorsa, önceki oyları sil
    if (existingVotes.length > 0) {
      // Önceki oyların seçeneklerindeki oy sayılarını azalt
      for (const vote of existingVotes) {
        await PollOption.findByIdAndUpdate(vote.option, { $inc: { votes: -1 } }, { session });

        // Toplam oy sayısını azalt
        await Poll.findByIdAndUpdate(id, { $inc: { totalVotes: -1 } }, { session });
      }

      // Önceki oyları sil
      await PollVote.deleteMany({ poll: id, user: req.user._id }, { session });
    }

    // Yeni oyları oluştur ve seçenek oy sayılarını artır
    const votes = [];

    for (const optionId of optionIds) {
      // Yeni oy oluştur
      const vote = new PollVote({
        poll: id,
        option: optionId,
        user: req.user._id,
      });

      votes.push(vote);

      // Seçeneğin oy sayısını artır
      await PollOption.findByIdAndUpdate(optionId, { $inc: { votes: 1 } }, { session });
    }

    // Oyları kaydet
    await PollVote.insertMany(votes, { session });

    // Anketin toplam oy sayısını güncelle
    await Poll.findByIdAndUpdate(id, { $inc: { totalVotes: optionIds.length } }, { session });

    await session.commitTransaction();

    // Güncellenmiş anketi getir
    const updatedPoll = await Poll.findById(id).populate('options');

    // Kullanıcının oylarını getir
    const userVotes = await PollVote.find({
      poll: id,
      user: req.user._id,
    }).select('option');

    // Sonuçları hazırla
    const preparedPoll = {
      ...updatedPoll.toObject(),
      userVotes: userVotes.map((vote) => vote.option.toString()),
      isActive: new Date() < updatedPoll.endDate,
      remainingTime:
        new Date() < updatedPoll.endDate
          ? Math.floor((updatedPoll.endDate - new Date()) / 1000) // kalan süre (saniye)
          : 0,
      options: updatedPoll.options.map((option) => {
        const optionObj = option.toObject();
        optionObj.percentage =
          updatedPoll.totalVotes > 0
            ? Math.round((option.votes / updatedPoll.totalVotes) * 100)
            : 0;
        optionObj.userVoted = userVotes.some(
          (vote) => vote.option.toString() === option._id.toString(),
        );
        return optionObj;
      }),
    };

    res.status(200).json({
      success: true,
      data: preparedPoll,
      message: 'Oyunuz başarıyla kaydedildi',
    });
  } catch (error) {
    await session.abortTransaction();
    return next(new ErrorResponse('Oy verilirken bir hata oluştu', 500));
  } finally {
    session.endSession();
  }
});

/**
 * @desc    Anket seçeneği ekle
 * @route   POST /api/polls/:id/options
 * @access  Private
 */
const addPollOption = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { text } = req.body;

  // ID formatı kontrolü
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorResponse('Geçersiz anket ID formatı', 400));
  }

  // Seçenek metnini doğrula
  if (!text || !text.trim()) {
    return next(new ErrorResponse('Seçenek metni gereklidir', 400));
  }

  // Anketi bul
  const poll = await Poll.findById(id).populate('options');

  if (!poll) {
    return next(new ErrorResponse('Anket bulunamadı', 404));
  }

  // Anketin aktif olup olmadığını kontrol et
  if (new Date() > poll.endDate) {
    return next(new ErrorResponse('Bu anket sona ermiş, artık seçenek eklenemez', 400));
  }

  // Post'u bul ve kontrol et
  const post = await Post.findById(poll.post);

  if (!post) {
    return next(new ErrorResponse('İlgili post bulunamadı', 404));
  }

  // Yetki kontrolü - Post sahibi veya moderatör/admin olmalı
  const isPostAuthor = post.author.toString() === req.user._id.toString();
  const isAdmin = req.user.role === 'admin';

  if (!isPostAuthor && !isAdmin) {
    // Moderatör kontrolü
    const subredditId = post.subreddit;
    const isModerator =
      req.user.role === 'moderator' ||
      (await SubredditMembership.findOne({
        user: req.user._id,
        subreddit: subredditId,
        type: 'moderator',
      }));

    if (!isModerator) {
      return next(new ErrorResponse('Bu ankete seçenek ekleme yetkiniz yok', 403));
    }
  }

  // Aynı metinde bir seçenek var mı kontrol et
  const existingOption = poll.options.find(
    (option) => option.text.toLowerCase() === text.trim().toLowerCase(),
  );

  if (existingOption) {
    return next(new ErrorResponse('Bu seçenek zaten mevcut', 400));
  }

  // Maksimum seçenek sayısını kontrol et
  if (poll.options.length >= 10) {
    return next(new ErrorResponse('Bir ankette en fazla 10 seçenek olabilir', 400));
  }

  // Yeni seçeneği oluştur
  const newOption = await PollOption.create({
    text: text.trim(),
    votes: 0,
    addedBy: req.user._id,
  });

  // Seçeneği ankete ekle
  poll.options.push(newOption._id);
  await poll.save();

  // Güncellenmiş anketi getir
  const updatedPoll = await Poll.findById(id).populate('options');

  res.status(201).json({
    success: true,
    data: updatedPoll,
    message: 'Anket seçeneği başarıyla eklendi',
  });
});

/**
 * @desc    Anket seçeneği sil (oy yoksa)
 * @route   DELETE /api/polls/:id/options/:optionId
 * @access  Private
 */
const removePollOption = asyncHandler(async (req, res, next) => {
  const { id, optionId } = req.params;

  // ID formatları kontrolü
  if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(optionId)) {
    return next(new ErrorResponse('Geçersiz ID formatı', 400));
  }

  // Anketi bul
  const poll = await Poll.findById(id).populate('options');

  if (!poll) {
    return next(new ErrorResponse('Anket bulunamadı', 404));
  }

  // Anketin aktif olup olmadığını kontrol et
  if (new Date() > poll.endDate) {
    return next(new ErrorResponse('Bu anket sona ermiş, artık seçenek silinemez', 400));
  }

  // Seçeneği bul
  const option = await PollOption.findById(optionId);

  if (!option) {
    return next(new ErrorResponse('Seçenek bulunamadı', 404));
  }

  // Seçeneğin bu ankete ait olup olmadığını kontrol et
  if (!poll.options.some((opt) => opt._id.toString() === optionId)) {
    return next(new ErrorResponse('Bu seçenek bu ankete ait değil', 400));
  }

  // Post'u bul ve kontrol et
  const post = await Post.findById(poll.post);

  if (!post) {
    return next(new ErrorResponse('İlgili post bulunamadı', 404));
  }

  // Yetki kontrolü - Post sahibi veya moderatör/admin olmalı
  const isPostAuthor = post.author.toString() === req.user._id.toString();
  const isAdmin = req.user.role === 'admin';

  if (!isPostAuthor && !isAdmin) {
    // Moderatör kontrolü
    const subredditId = post.subreddit;
    const isModerator =
      req.user.role === 'moderator' ||
      (await SubredditMembership.findOne({
        user: req.user._id,
        subreddit: subredditId,
        type: 'moderator',
      }));

    if (!isModerator) {
      return next(new ErrorResponse('Bu anketten seçenek silme yetkiniz yok', 403));
    }
  }

  // Seçeneğe ait oyları kontrol et
  if (option.votes > 0) {
    return next(new ErrorResponse('Oy alan bir seçenek silinemez', 400));
  }

  // Minimum 2 seçenek olmalı
  if (poll.options.length <= 2) {
    return next(new ErrorResponse('Bir ankette en az 2 seçenek olmalıdır', 400));
  }

  // Seçeneği anketten kaldır
  poll.options = poll.options.filter((opt) => opt._id.toString() !== optionId);
  await poll.save();

  // Seçeneği sil
  await PollOption.findByIdAndDelete(optionId);

  // Güncellenmiş anketi getir
  const updatedPoll = await Poll.findById(id).populate('options');

  res.status(200).json({
    success: true,
    data: updatedPoll,
    message: 'Anket seçeneği başarıyla silindi',
  });
});

/**
 * @desc    Anket süresini değiştir
 * @route   PUT /api/polls/:id/duration
 * @access  Private
 */
const updatePollDuration = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { endDate } = req.body;

  // ID formatı kontrolü
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorResponse('Geçersiz anket ID formatı', 400));
  }

  // Bitiş tarihini doğrula
  const parsedEndDate = new Date(endDate);

  if (isNaN(parsedEndDate.getTime())) {
    return next(new ErrorResponse('Geçersiz bitiş tarihi formatı', 400));
  }

  // Anketi bul
  const poll = await Poll.findById(id);

  if (!poll) {
    return next(new ErrorResponse('Anket bulunamadı', 404));
  }

  // Anketin aktif olup olmadığını kontrol et
  if (new Date() > poll.endDate) {
    return next(new ErrorResponse('Bu anket zaten sona ermiş', 400));
  }

  // Post'u bul ve kontrol et
  const post = await Post.findById(poll.post);

  if (!post) {
    return next(new ErrorResponse('İlgili post bulunamadı', 404));
  }

  // Yetki kontrolü - Post sahibi veya moderatör/admin olmalı
  const isPostAuthor = post.author.toString() === req.user._id.toString();
  const isAdmin = req.user.role === 'admin';

  if (!isPostAuthor && !isAdmin) {
    // Moderatör kontrolü
    const subredditId = post.subreddit;
    const isModerator =
      req.user.role === 'moderator' ||
      (await SubredditMembership.findOne({
        user: req.user._id,
        subreddit: subredditId,
        type: 'moderator',
      }));

    if (!isModerator) {
      return next(new ErrorResponse('Bu anketin süresini değiştirme yetkiniz yok', 403));
    }
  }

  const now = new Date();
  const maxDuration = 7 * 24 * 60 * 60 * 1000; // 7 gün (milisaniye)

  // Yeni bitiş tarihi şu anki zamandan sonra olmalı
  if (parsedEndDate <= now) {
    return next(new ErrorResponse('Bitiş tarihi gelecekte olmalıdır', 400));
  }

  // Şu anki tarihten itibaren 7 günden fazla olamaz
  if (parsedEndDate > new Date(now.getTime() + maxDuration)) {
    return next(new ErrorResponse('Anket süresi şu andan itibaren en fazla 7 gün olabilir', 400));
  }

  // Anketi güncelle
  poll.endDate = parsedEndDate;
  await poll.save();

  res.status(200).json({
    success: true,
    data: poll,
    message: 'Anket süresi başarıyla güncellendi',
  });
});

/**
 * @desc    Anketi erken sonlandır
 * @route   PUT /api/polls/:id/close
 * @access  Private
 */
const closePoll = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  // ID formatı kontrolü
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorResponse('Geçersiz anket ID formatı', 400));
  }

  // Anketi bul
  const poll = await Poll.findById(id);

  if (!poll) {
    return next(new ErrorResponse('Anket bulunamadı', 404));
  }

  // Anketin zaten kapanıp kapanmadığını kontrol et
  if (new Date() > poll.endDate) {
    return next(new ErrorResponse('Bu anket zaten sona ermiş', 400));
  }

  // Post'u bul ve kontrol et
  const post = await Post.findById(poll.post);

  if (!post) {
    return next(new ErrorResponse('İlgili post bulunamadı', 404));
  }

  // Yetki kontrolü - Post sahibi veya moderatör/admin olmalı
  const isPostAuthor = post.author.toString() === req.user._id.toString();
  const isAdmin = req.user.role === 'admin';

  if (!isPostAuthor && !isAdmin) {
    // Moderatör kontrolü
    const subredditId = post.subreddit;
    const isModerator =
      req.user.role === 'moderator' ||
      (await SubredditMembership.findOne({
        user: req.user._id,
        subreddit: subredditId,
        type: 'moderator',
      }));

    if (!isModerator) {
      return next(new ErrorResponse('Bu anketi sonlandırma yetkiniz yok', 403));
    }
  }

  // Anketi şimdi sonlandır
  poll.endDate = new Date();
  await poll.save();

  // Güncellenmiş anketi getir
  const updatedPoll = await Poll.findById(id).populate('options');

  // Kullanıcının oylarını getir
  let userVotes = [];

  if (req.user) {
    userVotes = await PollVote.find({
      poll: id,
      user: req.user._id,
    }).distinct('option');
  }

  // Sonuçları hazırla
  const preparedPoll = {
    ...updatedPoll.toObject(),
    userVotes,
    isActive: false,
    remainingTime: 0,
    options: updatedPoll.options.map((option) => {
      const optionObj = option.toObject();
      optionObj.percentage =
        updatedPoll.totalVotes > 0 ? Math.round((option.votes / updatedPoll.totalVotes) * 100) : 0;
      optionObj.userVoted = userVotes.includes(option._id.toString());
      return optionObj;
    }),
  };

  res.status(200).json({
    success: true,
    data: preparedPoll,
    message: 'Anket başarıyla sonlandırıldı',
  });
});

/**
 * @desc    Anket ayarlarını güncelle
 * @route   PUT /api/polls/:id/settings
 * @access  Private
 */
const updatePollSettings = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { allowMultipleVotes, maxSelections, hideResultsUntilClosed } = req.body;

  // ID formatı kontrolü
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorResponse('Geçersiz anket ID formatı', 400));
  }

  // Anketi bul
  const poll = await Poll.findById(id).populate('options');

  if (!poll) {
    return next(new ErrorResponse('Anket bulunamadı', 404));
  }

  // Anketin zaten kapanıp kapanmadığını kontrol et
  if (new Date() > poll.endDate) {
    return next(new ErrorResponse('Bu anket sona ermiş, artık ayarları değiştirilemez', 400));
  }

  // Post'u bul ve kontrol et
  const post = await Post.findById(poll.post);

  if (!post) {
    return next(new ErrorResponse('İlgili post bulunamadı', 404));
  }

  // Yetki kontrolü - Post sahibi veya moderatör/admin olmalı
  const isPostAuthor = post.author.toString() === req.user._id.toString();
  const isAdmin = req.user.role === 'admin';

  if (!isPostAuthor && !isAdmin) {
    // Moderatör kontrolü
    const subredditId = post.subreddit;
    const isModerator =
      req.user.role === 'moderator' ||
      (await SubredditMembership.findOne({
        user: req.user._id,
        subreddit: subredditId,
        type: 'moderator',
      }));

    if (!isModerator) {
      return next(new ErrorResponse('Bu anketin ayarlarını değiştirme yetkiniz yok', 403));
    }
  }

  // Ayarları doğrula
  if (maxSelections !== undefined) {
    if (maxSelections < 1 || maxSelections > 6) {
      return next(new ErrorResponse('Maksimum seçim sayısı 1-6 arasında olmalıdır', 400));
    }

    if (maxSelections > poll.options.length) {
      return next(new ErrorResponse('Maksimum seçim sayısı, seçenek sayısından fazla olamaz', 400));
    }
  }

  // Anketi güncelle
  const updates = {};

  if (allowMultipleVotes !== undefined) {
    updates.allowMultipleVotes = allowMultipleVotes;
  }

  if (maxSelections !== undefined) {
    updates.maxSelections = maxSelections;
  }

  if (hideResultsUntilClosed !== undefined) {
    updates.hideResultsUntilClosed = hideResultsUntilClosed;
  }

  const updatedPoll = await Poll.findByIdAndUpdate(id, { $set: updates }, { new: true }).populate(
    'options',
  );

  // Kullanıcının oylarını getir
  let userVotes = [];

  if (req.user) {
    userVotes = await PollVote.find({
      poll: id,
      user: req.user._id,
    }).distinct('option');
  }

  // Sonuçları hazırla
  const preparedPoll = {
    ...updatedPoll.toObject(),
    userVotes,
    isActive: new Date() < updatedPoll.endDate,
    remainingTime:
      new Date() < updatedPoll.endDate
        ? Math.floor((updatedPoll.endDate - new Date()) / 1000) // kalan süre (saniye)
        : 0,
    options: updatedPoll.options.map((option) => {
      const optionObj = option.toObject();

      // Sonuçları gizle
      if (
        updatedPoll.hideResultsUntilClosed &&
        new Date() < updatedPoll.endDate &&
        !userVotes.includes(option._id.toString())
      ) {
        optionObj.votes = 0;
        optionObj.percentage = 0;
      } else {
        optionObj.percentage =
          updatedPoll.totalVotes > 0
            ? Math.round((option.votes / updatedPoll.totalVotes) * 100)
            : 0;
      }

      optionObj.userVoted = userVotes.includes(option._id.toString());
      return optionObj;
    }),
  };

  res.status(200).json({
    success: true,
    data: preparedPoll,
    message: 'Anket ayarları başarıyla güncellendi',
  });
});

/**
 * @desc    Popüler anketleri getir
 * @route   GET /api/polls/popular
 * @access  Public
 */
const getPopularPolls = asyncHandler(async (req, res, next) => {
  const { limit = 5, subredditId, activeOnly = true } = req.query;

  // Filtreleme seçenekleri
  const filter = {};

  // Aktif anketleri filtrele
  if (activeOnly === 'true') {
    filter.endDate = { $gt: new Date() };
  }

  // Belirli bir subreddit için filtrele
  if (subredditId) {
    if (!mongoose.Types.ObjectId.isValid(subredditId)) {
      return next(new ErrorResponse('Geçersiz subreddit ID formatı', 400));
    }

    // Önce subreddit'in var olduğunu kontrol et
    const subreddit = await Subreddit.findById(subredditId);

    if (!subreddit) {
      return next(new ErrorResponse('Subreddit bulunamadı', 404));
    }

    // Post'ları bu subreddit'e ait olanları bul
    const posts = await Post.find({ subreddit: subredditId }).select('_id');
    filter.post = { $in: posts.map((post) => post._id) };
  }

  // En popüler anketleri bul (en fazla oy alanlar)
  const polls = await Poll.find(filter)
    .sort({ totalVotes: -1 })
    .limit(parseInt(limit))
    .populate('options')
    .populate({
      path: 'post',
      select: 'title author subreddit createdAt',
      populate: [
        { path: 'author', select: 'username profilePicture' },
        { path: 'subreddit', select: 'name icon' },
      ],
    });

  // Kullanıcının oylarını getir
  let userVotes = {};

  if (req.user) {
    const votes = await PollVote.find({
      poll: { $in: polls.map((poll) => poll._id) },
      user: req.user._id,
    });

    // Anket ID'lerine göre oyları grupla
    votes.forEach((vote) => {
      if (!userVotes[vote.poll]) {
        userVotes[vote.poll] = [];
      }
      userVotes[vote.poll].push(vote.option.toString());
    });
  }

  // Anketleri hazırla
  const preparedPolls = polls.map((poll) => {
    const pollObj = poll.toObject();
    const userPollVotes = userVotes[poll._id] || [];

    // Sonuçları hazırla
    pollObj.isActive = new Date() < poll.endDate;
    pollObj.remainingTime =
      new Date() < poll.endDate
        ? Math.floor((poll.endDate - new Date()) / 1000) // kalan süre (saniye)
        : 0;

    // Sonuçları gizle
    const hideResults =
      poll.hideResultsUntilClosed && pollObj.isActive && userPollVotes.length === 0;

    pollObj.options = poll.options.map((option) => {
      const optionObj = option.toObject();

      if (hideResults) {
        optionObj.votes = 0;
        optionObj.percentage = 0;
      } else {
        optionObj.percentage =
          poll.totalVotes > 0 ? Math.round((option.votes / poll.totalVotes) * 100) : 0;
      }

      optionObj.userVoted = userPollVotes.includes(option._id.toString());
      return optionObj;
    });

    pollObj.userVotes = userPollVotes;
    pollObj.hideResults = hideResults;

    return pollObj;
  });

  res.status(200).json({
    success: true,
    count: preparedPolls.length,
    data: preparedPolls,
  });
});

/**
 * @desc    Kullanıcının oy verdiği anketleri getir
 * @route   GET /api/polls/voted
 * @access  Private
 */
const getUserVotedPolls = asyncHandler(async (req, res, next) => {
  const { page = 1, limit = 10 } = req.query;
  const userId = req.user._id;

  // Kullanıcının oylarını bul
  const userVoteGroups = await PollVote.aggregate([
    { $match: { user: mongoose.Types.ObjectId(userId) } },
    { $group: { _id: '$poll', options: { $push: '$option' } } },
  ]);

  // Oy verilen anket ID'lerini al
  const pollIds = userVoteGroups.map((group) => group._id);

  // Toplam anketi say
  const total = pollIds.length;

  // Sayfalama
  const skip = (parseInt(page) - 1) * parseInt(limit);
  const paginatedPollIds = pollIds.slice(skip, skip + parseInt(limit));

  // Anketleri getir
  const polls = await Poll.find({ _id: { $in: paginatedPollIds } })
    .populate('options')
    .populate({
      path: 'post',
      select: 'title author subreddit createdAt',
      populate: [
        { path: 'author', select: 'username profilePicture' },
        { path: 'subreddit', select: 'name icon' },
      ],
    });

  // Oy verilen seçenekleri eşleştir
  const pollsWithVotes = polls.map((poll) => {
    const pollObj = poll.toObject();
    const voteGroup = userVoteGroups.find((group) => group._id.toString() === poll._id.toString());
    const userVotes = voteGroup ? voteGroup.options.map((opt) => opt.toString()) : [];

    pollObj.isActive = new Date() < poll.endDate;
    pollObj.remainingTime =
      new Date() < poll.endDate
        ? Math.floor((poll.endDate - new Date()) / 1000) // kalan süre (saniye)
        : 0;

    pollObj.options = poll.options.map((option) => {
      const optionObj = option.toObject();
      optionObj.percentage =
        poll.totalVotes > 0 ? Math.round((option.votes / poll.totalVotes) * 100) : 0;
      optionObj.userVoted = userVotes.includes(option._id.toString());
      return optionObj;
    });

    pollObj.userVotes = userVotes;

    return pollObj;
  });

  res.status(200).json({
    success: true,
    count: pollsWithVotes.length,
    total,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      pages: Math.ceil(total / parseInt(limit)),
    },
    data: pollsWithVotes,
  });
});

/**
 * @desc    Anket istatistiklerini getir
 * @route   GET /api/polls/:id/stats
 * @access  Private (moderatör, admin veya anket sahibi)
 */
const getPollStats = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  // ID formatı kontrolü
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorResponse('Geçersiz anket ID formatı', 400));
  }

  // Anketi bul
  const poll = await Poll.findById(id)
    .populate('options')
    .populate({
      path: 'post',
      select: 'title author subreddit createdAt',
      populate: [
        { path: 'author', select: 'username' },
        { path: 'subreddit', select: 'name' },
      ],
    });

  if (!poll) {
    return next(new ErrorResponse('Anket bulunamadı', 404));
  }

  // Yetki kontrolü
  const isPostAuthor = poll.post.author._id.toString() === req.user._id.toString();
  const isAdmin = req.user.role === 'admin';

  if (!isPostAuthor && !isAdmin) {
    const subredditId = poll.post.subreddit._id;
    const isModerator =
      req.user.role === 'moderator' ||
      (await SubredditMembership.findOne({
        user: req.user._id,
        subreddit: subredditId,
        type: 'moderator',
      }));

    if (!isModerator) {
      return next(new ErrorResponse('Bu anketin istatistiklerini görüntüleme yetkiniz yok', 403));
    }
  }

  // Oy istatistiklerini getir
  const voteStats = await PollVote.aggregate([
    { $match: { poll: mongoose.Types.ObjectId(id) } },
    { $group: { _id: '$option', count: { $sum: 1 } } },
  ]);

  // Oylama zamanı dağılımı
  const hourlyVotes = await PollVote.aggregate([
    { $match: { poll: mongoose.Types.ObjectId(id) } },
    {
      $group: {
        _id: {
          year: { $year: '$createdAt' },
          month: { $month: '$createdAt' },
          day: { $dayOfMonth: '$createdAt' },
          hour: { $hour: '$createdAt' },
        },
        count: { $sum: 1 },
      },
    },
    { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1, '_id.hour': 1 } },
  ]);

  // Seçeneklere göre oy dağılımı
  const optionStats = poll.options.map((option) => {
    const voteStat = voteStats.find((stat) => stat._id.toString() === option._id.toString());
    const votes = voteStat ? voteStat.count : 0;

    return {
      _id: option._id,
      text: option.text,
      votes,
      percentage: poll.totalVotes > 0 ? Math.round((votes / poll.totalVotes) * 100) : 0,
    };
  });

  // Zamansal veri formatını düzenle
  const voteTimeline = hourlyVotes.map((hourData) => ({
    timestamp: new Date(
      hourData._id.year,
      hourData._id.month - 1,
      hourData._id.day,
      hourData._id.hour,
    ).toISOString(),
    count: hourData.count,
  }));

  // Anket istatistiklerini hazırla
  const pollStats = {
    _id: poll._id,
    title: poll.post.title,
    author: poll.post.author.username,
    subreddit: poll.post.subreddit.name,
    createdAt: poll.createdAt,
    endDate: poll.endDate,
    isActive: new Date() < poll.endDate,
    remainingTime:
      new Date() < poll.endDate
        ? Math.floor((poll.endDate - new Date()) / 1000) // kalan süre (saniye)
        : 0,
    totalVotes: poll.totalVotes,
    options: optionStats,
    voteTimeline,
  };

  res.status(200).json({
    success: true,
    data: pollStats,
  });
});

/**
 * @desc    Anket detaylarını getir (admin arayüzü için)
 * @route   GET /api/polls/:id/admin
 * @access  Private (Admin)
 */
const getAdminPollDetails = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  // Yetki kontrolü
  if (req.user.role !== 'admin') {
    return next(new ErrorResponse('Bu işlem için admin yetkiniz yok', 403));
  }

  // ID formatı kontrolü
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorResponse('Geçersiz anket ID formatı', 400));
  }

  // Anketi bul
  const poll = await Poll.findById(id)
    .populate('options')
    .populate({
      path: 'post',
      select: 'title author subreddit createdAt',
      populate: [
        { path: 'author', select: 'username email' },
        { path: 'subreddit', select: 'name' },
      ],
    });

  if (!poll) {
    return next(new ErrorResponse('Anket bulunamadı', 404));
  }

  // Son 10 oy
  const recentVotes = await PollVote.find({ poll: id })
    .sort({ createdAt: -1 })
    .limit(10)
    .populate('user', 'username email')
    .populate('option');

  // IP bazlı oy sayımı
  const ipVoteCounts = await PollVote.aggregate([
    { $match: { poll: mongoose.Types.ObjectId(id) } },
    { $group: { _id: '$ip', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 10 },
  ]);

  // Kullanıcı bazlı oy sayımı
  const userVoteCounts = await PollVote.aggregate([
    { $match: { poll: mongoose.Types.ObjectId(id) } },
    { $group: { _id: '$user', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 10 },
  ]);

  // Kullanıcı bilgilerini getir
  const userIds = userVoteCounts.map((item) => item._id).filter((id) => id !== null);
  const users = await User.find({ _id: { $in: userIds } }).select('username');

  // Kullanıcı adlarını eşleştir
  const userVoteCountsWithNames = userVoteCounts.map((item) => {
    if (!item._id) {
      return { user: 'Anonim', count: item.count };
    }

    const user = users.find((u) => u._id.toString() === item._id.toString());
    return {
      userId: item._id,
      username: user ? user.username : 'Silinmiş Kullanıcı',
      count: item.count,
    };
  });

  res.status(200).json({
    success: true,
    data: {
      poll,
      recentVotes,
      ipVoteCounts,
      userVoteCounts: userVoteCountsWithNames,
    },
  });
});

/**
 * @desc    Anket oylama geçmişini temizle
 * @route   DELETE /api/polls/:id/votes
 * @access  Private (Admin)
 */
const clearPollVotes = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { reason } = req.body;

  // Yetki kontrolü
  if (req.user.role !== 'admin') {
    return next(new ErrorResponse('Bu işlem için admin yetkiniz yok', 403));
  }

  // ID formatı kontrolü
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorResponse('Geçersiz anket ID formatı', 400));
  }

  // Anketi bul
  const poll = await Poll.findById(id).populate('options');

  if (!poll) {
    return next(new ErrorResponse('Anket bulunamadı', 404));
  }

  // Transaction başlat
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Tüm oyları sil
    await PollVote.deleteMany({ poll: id }, { session });

    // Seçenek oy sayılarını sıfırla
    for (const option of poll.options) {
      await PollOption.findByIdAndUpdate(option._id, { votes: 0 }, { session });
    }

    // Toplam oy sayısını sıfırla
    poll.totalVotes = 0;
    await poll.save({ session });

    // Admin log kaydı oluştur
    await AdminLog.create(
      [
        {
          user: req.user._id,
          action: 'poll_votes_cleared',
          details: `Anket oyları temizlendi: ${poll._id}`,
          reason: reason || 'Belirtilmemiş',
          targetType: 'poll',
          targetId: poll._id,
        },
      ],
      { session },
    );

    await session.commitTransaction();

    res.status(200).json({
      success: true,
      message: 'Anket oyları başarıyla temizlendi',
      data: {},
    });
  } catch (error) {
    await session.abortTransaction();
    return next(new ErrorResponse('Anket oyları temizlenirken bir hata oluştu', 500));
  } finally {
    session.endSession();
  }
});

/**
 * @desc    Anket sil
 * @route   DELETE /api/polls/:id
 * @access  Private (Post sahibi, Moderatör veya Admin)
 */
const deletePoll = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  // ID formatı kontrolü
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorResponse('Geçersiz anket ID formatı', 400));
  }

  // Anketi bul
  const poll = await Poll.findById(id);

  if (!poll) {
    return next(new ErrorResponse('Anket bulunamadı', 404));
  }

  // Post'u bul ve kontrol et
  const post = await Post.findById(poll.post);

  if (!post) {
    return next(new ErrorResponse('İlgili post bulunamadı', 404));
  }

  // Yetki kontrolü
  const isPostAuthor = post.author.toString() === req.user._id.toString();
  const isAdmin = req.user.role === 'admin';

  if (!isPostAuthor && !isAdmin) {
    // Moderatör kontrolü
    const subredditId = post.subreddit;
    const isModerator =
      req.user.role === 'moderator' ||
      (await SubredditMembership.findOne({
        user: req.user._id,
        subreddit: subredditId,
        type: 'moderator',
      }));

    if (!isModerator) {
      return next(new ErrorResponse('Bu anketi silme yetkiniz yok', 403));
    }
  }

  // Transaction başlat
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Anket oylarını sil
    await PollVote.deleteMany({ poll: id }, { session });

    // Anket seçeneklerini sil
    for (const optionId of poll.options) {
      await PollOption.findByIdAndDelete(optionId, { session });
    }

    // Anketi sil
    await Poll.findByIdAndDelete(id, { session });

    // Post'un türünü güncelle
    post.type = 'text';
    await post.save({ session });

    await session.commitTransaction();

    res.status(200).json({
      success: true,
      message: 'Anket başarıyla silindi',
      data: {},
    });
  } catch (error) {
    await session.abortTransaction();
    return next(new ErrorResponse('Anket silinirken bir hata oluştu', 500));
  } finally {
    session.endSession();
  }
});

module.exports = {
  createPoll,
  getPoll,
  getPostPoll,
  votePoll,
  addPollOption,
  removePollOption,
  updatePollDuration,
  closePoll,
  updatePollSettings,
  getPopularPolls,
  getUserVotedPolls,
  getPollStats,
  getAdminPollDetails,
  clearPollVotes,
  deletePoll,
};
