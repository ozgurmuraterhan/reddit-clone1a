const Poll = require('../models/Poll');
const PollOption = require('../models/PollOption');
const PollVote = require('../models/PollVote');
const Post = require('../models/Post');
const User = require('../models/User');
const SubredditMembership = require('../models/SubredditMembership');
const asyncHandler = require('../middleware/async');
const ErrorResponse = require('../utils/errorResponse');
const mongoose = require('mongoose');

/**
 * @desc    Anket seçeneği oluştur
 * @route   POST /api/polls/:pollId/options
 * @access  Private (Anket sahibi veya moderatör/admin)
 */
const createPollOption = asyncHandler(async (req, res, next) => {
  const { pollId } = req.params;
  const { text } = req.body;
  const userId = req.user._id;

  // ID formatı kontrolü
  if (!mongoose.Types.ObjectId.isValid(pollId)) {
    return next(new ErrorResponse('Geçersiz anket ID formatı', 400));
  }

  // Seçenek metnini doğrula
  if (!text || text.trim() === '') {
    return next(new ErrorResponse('Seçenek metni gereklidir', 400));
  }

  if (text.length > 100) {
    return next(new ErrorResponse('Seçenek metni 100 karakterden uzun olamaz', 400));
  }

  // Anketi bul
  const poll = await Poll.findById(pollId).populate('options');

  if (!poll) {
    return next(new ErrorResponse('Anket bulunamadı', 404));
  }

  // Anketin aktif olup olmadığını kontrol et
  if (new Date() >= poll.endDate) {
    return next(new ErrorResponse('Bu anket sona ermiş, artık seçenek eklenemez', 400));
  }

  // Post'u bul
  const post = await Post.findById(poll.post);

  if (!post) {
    return next(new ErrorResponse('İlgili post bulunamadı', 404));
  }

  // Yetki kontrolü - Post sahibi veya moderatör/admin olmalı
  const isPostAuthor = post.author.toString() === userId.toString();
  const isAdmin = req.user.role === 'admin';

  if (!isPostAuthor && !isAdmin) {
    // Moderatör kontrolü
    const subredditId = post.subreddit;
    const isModerator = await SubredditMembership.findOne({
      user: userId,
      subreddit: subredditId,
      type: 'moderator',
    });

    if (!isModerator) {
      return next(new ErrorResponse('Bu ankete seçenek ekleme yetkiniz yok', 403));
    }
  }

  // Maksimum seçenek sayısını kontrol et
  if (poll.options.length >= 10) {
    return next(new ErrorResponse('Bir ankette en fazla 10 seçenek olabilir', 400));
  }

  // Seçenek metninin benzersiz olduğunu kontrol et
  const existingOption = await PollOption.findOne({
    poll: pollId,
    text: { $regex: new RegExp(`^${text.trim()}$`, 'i') },
  });

  if (existingOption) {
    return next(new ErrorResponse('Bu metinde bir seçenek zaten mevcut', 400));
  }

  // Yeni seçenek için pozisyon belirle
  const position = poll.options.length + 1;

  // Yeni seçeneği oluştur
  const newOption = await PollOption.create({
    poll: pollId,
    text: text.trim(),
    voteCount: 0,
    position,
  });

  // Seçeneği ankete ekle
  poll.options.push(newOption._id);
  await poll.save();

  res.status(201).json({
    success: true,
    data: newOption,
    message: 'Anket seçeneği başarıyla eklendi',
  });
});

/**
 * @desc    Anket seçeneği detaylarını getir
 * @route   GET /api/poll-options/:optionId
 * @access  Public
 */
const getPollOption = asyncHandler(async (req, res, next) => {
  const { optionId } = req.params;

  // ID formatı kontrolü
  if (!mongoose.Types.ObjectId.isValid(optionId)) {
    return next(new ErrorResponse('Geçersiz seçenek ID formatı', 400));
  }

  // Seçeneği bul
  const option = await PollOption.findById(optionId);

  if (!option) {
    return next(new ErrorResponse('Seçenek bulunamadı', 404));
  }

  // Anket bilgilerini getir
  const poll = await Poll.findById(option.poll);

  if (!poll) {
    return next(new ErrorResponse('İlgili anket bulunamadı', 404));
  }

  // Kullanıcının bu seçeneğe oy verip vermediğini kontrol et
  let userVoted = false;
  if (req.user) {
    const vote = await PollVote.findOne({
      poll: poll._id,
      option: optionId,
      user: req.user._id,
    });
    userVoted = !!vote;
  }

  // Sonuçların gizlenmesi gerekip gerekmediğini kontrol et
  let hideResults = false;
  if (poll.hideResultsUntilClosed && new Date() < poll.endDate) {
    // Kullanıcı oy vermediyse ve admin/moderatör değilse
    if (!userVoted && (!req.user || req.user.role !== 'admin')) {
      const post = await Post.findById(poll.post);
      const subredditId = post ? post.subreddit : null;

      // Moderatör kontrolü
      const isModerator =
        req.user &&
        subredditId &&
        (await SubredditMembership.findOne({
          user: req.user._id,
          subreddit: subredditId,
          type: 'moderator',
        }));

      if (!isModerator) {
        hideResults = true;
      }
    }
  }

  // Seçenek bilgilerini hazırla
  const optionData = {
    _id: option._id,
    text: option.text,
    voteCount: hideResults ? 0 : option.voteCount,
    position: option.position,
    percentage: hideResults
      ? 0
      : poll.totalVotes > 0
        ? Math.round((option.voteCount / poll.totalVotes) * 100)
        : 0,
    createdAt: option.createdAt,
    userVoted,
    poll: {
      _id: poll._id,
      totalVotes: poll.totalVotes,
      endDate: poll.endDate,
      isActive: new Date() < poll.endDate,
    },
  };

  res.status(200).json({
    success: true,
    data: optionData,
  });
});

/**
 * @desc    Anket seçeneğini güncelle
 * @route   PUT /api/poll-options/:optionId
 * @access  Private (Anket sahibi veya moderatör/admin)
 */
const updatePollOption = asyncHandler(async (req, res, next) => {
  const { optionId } = req.params;
  const { text } = req.body;
  const userId = req.user._id;

  // ID formatı kontrolü
  if (!mongoose.Types.ObjectId.isValid(optionId)) {
    return next(new ErrorResponse('Geçersiz seçenek ID formatı', 400));
  }

  // Metni doğrula
  if (!text || text.trim() === '') {
    return next(new ErrorResponse('Seçenek metni gereklidir', 400));
  }

  if (text.length > 100) {
    return next(new ErrorResponse('Seçenek metni 100 karakterden uzun olamaz', 400));
  }

  // Seçeneği bul
  const option = await PollOption.findById(optionId);

  if (!option) {
    return next(new ErrorResponse('Seçenek bulunamadı', 404));
  }

  // Anketi bul
  const poll = await Poll.findById(option.poll);

  if (!poll) {
    return next(new ErrorResponse('İlgili anket bulunamadı', 404));
  }

  // Anketin aktif olup olmadığını kontrol et
  if (new Date() >= poll.endDate) {
    return next(new ErrorResponse('Bu anket sona ermiş, artık seçenekler düzenlenemez', 400));
  }

  // Post'u bul
  const post = await Post.findById(poll.post);

  if (!post) {
    return next(new ErrorResponse('İlgili post bulunamadı', 404));
  }

  // Yetki kontrolü
  const isPostAuthor = post.author.toString() === userId.toString();
  const isAdmin = req.user.role === 'admin';

  if (!isPostAuthor && !isAdmin) {
    // Moderatör kontrolü
    const subredditId = post.subreddit;
    const isModerator = await SubredditMembership.findOne({
      user: userId,
      subreddit: subredditId,
      type: 'moderator',
    });

    if (!isModerator) {
      return next(new ErrorResponse('Bu seçeneği düzenleme yetkiniz yok', 403));
    }
  }

  // Seçenek üzerinde oy olup olmadığını kontrol et
  if (option.voteCount > 0) {
    return next(new ErrorResponse('Oy alan bir seçenek düzenlenemez', 400));
  }

  // Aynı metinde başka bir seçenek var mı kontrol et
  const existingOption = await PollOption.findOne({
    poll: poll._id,
    text: { $regex: new RegExp(`^${text.trim()}$`, 'i') },
    _id: { $ne: optionId },
  });

  if (existingOption) {
    return next(new ErrorResponse('Bu metinde bir seçenek zaten mevcut', 400));
  }

  // Seçeneği güncelle
  option.text = text.trim();
  await option.save();

  res.status(200).json({
    success: true,
    data: option,
    message: 'Anket seçeneği başarıyla güncellendi',
  });
});

/**
 * @desc    Anket seçeneğini sil
 * @route   DELETE /api/poll-options/:optionId
 * @access  Private (Anket sahibi veya moderatör/admin)
 */
const deletePollOption = asyncHandler(async (req, res, next) => {
  const { optionId } = req.params;
  const userId = req.user._id;

  // ID formatı kontrolü
  if (!mongoose.Types.ObjectId.isValid(optionId)) {
    return next(new ErrorResponse('Geçersiz seçenek ID formatı', 400));
  }

  // Seçeneği bul
  const option = await PollOption.findById(optionId);

  if (!option) {
    return next(new ErrorResponse('Seçenek bulunamadı', 404));
  }

  // Anketi bul
  const poll = await Poll.findById(option.poll).populate('options');

  if (!poll) {
    return next(new ErrorResponse('İlgili anket bulunamadı', 404));
  }

  // Anketin aktif olup olmadığını kontrol et
  if (new Date() >= poll.endDate) {
    return next(new ErrorResponse('Bu anket sona ermiş, artık seçenekler silinemez', 400));
  }

  // Post'u bul
  const post = await Post.findById(poll.post);

  if (!post) {
    return next(new ErrorResponse('İlgili post bulunamadı', 404));
  }

  // Yetki kontrolü
  const isPostAuthor = post.author.toString() === userId.toString();
  const isAdmin = req.user.role === 'admin';

  if (!isPostAuthor && !isAdmin) {
    // Moderatör kontrolü
    const subredditId = post.subreddit;
    const isModerator = await SubredditMembership.findOne({
      user: userId,
      subreddit: subredditId,
      type: 'moderator',
    });

    if (!isModerator) {
      return next(new ErrorResponse('Bu seçeneği silme yetkiniz yok', 403));
    }
  }

  // Seçenek üzerinde oy olup olmadığını kontrol et
  if (option.voteCount > 0) {
    return next(new ErrorResponse('Oy alan bir seçenek silinemez', 400));
  }

  // Minimum seçenek sayısı kontrolü (en az 2 seçenek olmalı)
  if (poll.options.length <= 2) {
    return next(new ErrorResponse('Bir ankette en az 2 seçenek olmalıdır', 400));
  }

  // Transaction başlat
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Seçeneği anketten kaldır
    poll.options = poll.options.filter((opt) => opt._id.toString() !== optionId);
    await poll.save({ session });

    // Seçeneği sil
    await PollOption.findByIdAndDelete(optionId, { session });

    // Kalan seçeneklerin pozisyonlarını güncelle
    let position = 1;
    for (const optId of poll.options) {
      await PollOption.findByIdAndUpdate(optId, { position: position++ }, { session });
    }

    await session.commitTransaction();

    res.status(200).json({
      success: true,
      data: {},
      message: 'Anket seçeneği başarıyla silindi',
    });
  } catch (error) {
    await session.abortTransaction();
    return next(new ErrorResponse('Seçenek silinirken bir hata oluştu', 500));
  } finally {
    session.endSession();
  }
});

/**
 * @desc    Anket seçeneklerini yeniden sırala
 * @route   PUT /api/polls/:pollId/options/reorder
 * @access  Private (Anket sahibi veya moderatör/admin)
 */
const reorderPollOptions = asyncHandler(async (req, res, next) => {
  const { pollId } = req.params;
  const { order } = req.body;
  const userId = req.user._id;

  // ID formatı kontrolü
  if (!mongoose.Types.ObjectId.isValid(pollId)) {
    return next(new ErrorResponse('Geçersiz anket ID formatı', 400));
  }

  // Sıralama verisi kontrolü
  if (!order || !Array.isArray(order) || order.length === 0) {
    return next(new ErrorResponse('Geçerli bir sıralama listesi sağlanmalıdır', 400));
  }

  // Anketi bul
  const poll = await Poll.findById(pollId).populate('options');

  if (!poll) {
    return next(new ErrorResponse('Anket bulunamadı', 404));
  }

  // Anketin aktif olup olmadığını kontrol et
  if (new Date() >= poll.endDate) {
    return next(
      new ErrorResponse('Bu anket sona ermiş, artık seçenekler yeniden sıralanamaz', 400),
    );
  }

  // Post'u bul
  const post = await Post.findById(poll.post);

  if (!post) {
    return next(new ErrorResponse('İlgili post bulunamadı', 404));
  }

  // Yetki kontrolü
  const isPostAuthor = post.author.toString() === userId.toString();
  const isAdmin = req.user.role === 'admin';

  if (!isPostAuthor && !isAdmin) {
    // Moderatör kontrolü
    const subredditId = post.subreddit;
    const isModerator = await SubredditMembership.findOne({
      user: userId,
      subreddit: subredditId,
      type: 'moderator',
    });

    if (!isModerator) {
      return next(new ErrorResponse('Bu seçenekleri yeniden sıralama yetkiniz yok', 403));
    }
  }

  // Sıralama listesinin anket seçenekleriyle eşleştiğini kontrol et
  if (order.length !== poll.options.length) {
    return next(new ErrorResponse('Sıralama listesi tüm seçenekleri içermelidir', 400));
  }

  // Tüm ID'lerin geçerli olduğunu ve ankete ait olduğunu kontrol et
  const optionIds = poll.options.map((opt) => opt._id.toString());
  const allValid = order.every(
    (id) => mongoose.Types.ObjectId.isValid(id) && optionIds.includes(id),
  );

  if (!allValid) {
    return next(
      new ErrorResponse('Sıralama listesinde geçersiz veya ankete ait olmayan ID var', 400),
    );
  }

  // Transaction başlat
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Seçenekleri yeniden sırala
    for (let i = 0; i < order.length; i++) {
      await PollOption.findByIdAndUpdate(order[i], { position: i + 1 }, { session });
    }

    await session.commitTransaction();

    // Güncellenmiş anketi getir
    const updatedPoll = await Poll.findById(pollId).populate({
      path: 'options',
      options: { sort: { position: 1 } },
    });

    res.status(200).json({
      success: true,
      data: updatedPoll,
      message: 'Anket seçenekleri başarıyla yeniden sıralandı',
    });
  } catch (error) {
    await session.abortTransaction();
    return next(new ErrorResponse('Seçenekler yeniden sıralanırken bir hata oluştu', 500));
  } finally {
    session.endSession();
  }
});

/**
 * @desc    Anket seçeneğine oy ver
 * @route   POST /api/poll-options/:optionId/vote
 * @access  Private
 */
const voteForOption = asyncHandler(async (req, res, next) => {
  const { optionId } = req.params;
  const userId = req.user._id;

  // ID formatı kontrolü
  if (!mongoose.Types.ObjectId.isValid(optionId)) {
    return next(new ErrorResponse('Geçersiz seçenek ID formatı', 400));
  }

  // Seçeneği bul
  const option = await PollOption.findById(optionId);

  if (!option) {
    return next(new ErrorResponse('Seçenek bulunamadı', 404));
  }

  // Anketi bul
  const poll = await Poll.findById(option.poll).populate('options');

  if (!poll) {
    return next(new ErrorResponse('İlgili anket bulunamadı', 404));
  }

  // Anketin aktif olup olmadığını kontrol et
  if (new Date() >= poll.endDate) {
    return next(new ErrorResponse('Bu anket sona ermiş, artık oy verilemez', 400));
  }

  // Önceki oyu kontrol et
  const existingVote = await PollVote.findOne({
    poll: poll._id,
    user: userId,
    option: optionId,
  });

  // Eğer bu seçeneğe zaten oy verilmişse, hata döndür
  if (existingVote) {
    return next(new ErrorResponse('Bu seçeneğe zaten oy vermişsiniz', 400));
  }

  // Kullanıcının tüm oylarını kontrol et
  const userVotes = await PollVote.find({
    poll: poll._id,
    user: userId,
  });

  // Çoklu oy izni yok ise ve zaten oy verilmişse
  if (!poll.allowMultipleVotes && userVotes.length > 0) {
    return next(new ErrorResponse('Bu ankette sadece bir seçeneğe oy verebilirsiniz', 400));
  }

  // Maksimum seçim sayısını kontrol et
  if (userVotes.length >= poll.maxSelections) {
    return next(
      new ErrorResponse(
        `Bu ankette en fazla ${poll.maxSelections} seçeneğe oy verebilirsiniz`,
        400,
      ),
    );
  }

  // Transaction başlat
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Yeni oy oluştur
    await PollVote.create(
      [
        {
          poll: poll._id,
          option: optionId,
          user: userId,
        },
      ],
      { session },
    );

    // Seçeneğin oy sayısını artır
    await PollOption.findByIdAndUpdate(optionId, { $inc: { voteCount: 1 } }, { session });

    // Anketin toplam oy sayısını artır
    await Poll.findByIdAndUpdate(poll._id, { $inc: { totalVotes: 1 } }, { session });

    await session.commitTransaction();

    // Güncellenmiş seçenek ve anketi getir
    const updatedOption = await PollOption.findById(optionId);
    const updatedPoll = await Poll.findById(poll._id);

    // Kullanıcının tüm oylarını getir
    const allUserVotes = await PollVote.find({
      poll: poll._id,
      user: userId,
    }).select('option');

    res.status(200).json({
      success: true,
      data: {
        option: updatedOption,
        poll: {
          _id: updatedPoll._id,
          totalVotes: updatedPoll.totalVotes,
        },
        userVotes: allUserVotes.map((vote) => vote.option.toString()),
      },
      message: 'Oy başarıyla kaydedildi',
    });
  } catch (error) {
    await session.abortTransaction();
    return next(new ErrorResponse('Oy verilirken bir hata oluştu', 500));
  } finally {
    session.endSession();
  }
});

/**
 * @desc    Anket seçeneğinden oy kaldır
 * @route   DELETE /api/poll-options/:optionId/vote
 * @access  Private
 */
const removeVoteFromOption = asyncHandler(async (req, res, next) => {
  const { optionId } = req.params;
  const userId = req.user._id;

  // ID formatı kontrolü
  if (!mongoose.Types.ObjectId.isValid(optionId)) {
    return next(new ErrorResponse('Geçersiz seçenek ID formatı', 400));
  }

  // Seçeneği bul
  const option = await PollOption.findById(optionId);

  if (!option) {
    return next(new ErrorResponse('Seçenek bulunamadı', 404));
  }

  // Anketi bul
  const poll = await Poll.findById(option.poll);

  if (!poll) {
    return next(new ErrorResponse('İlgili anket bulunamadı', 404));
  }

  // Anketin aktif olup olmadığını kontrol et
  if (new Date() >= poll.endDate) {
    return next(new ErrorResponse('Bu anket sona ermiş, artık oy değiştirilemez', 400));
  }

  // Kullanıcının oyunu bul
  const vote = await PollVote.findOne({
    poll: poll._id,
    option: optionId,
    user: userId,
  });

  if (!vote) {
    return next(new ErrorResponse('Bu seçeneğe oy vermemişsiniz', 404));
  }

  // Transaction başlat
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Oyu sil
    await PollVote.findByIdAndDelete(vote._id, { session });

    // Seçeneğin oy sayısını azalt
    await PollOption.findByIdAndUpdate(optionId, { $inc: { voteCount: -1 } }, { session });

    // Anketin toplam oy sayısını azalt
    await Poll.findByIdAndUpdate(poll._id, { $inc: { totalVotes: -1 } }, { session });

    await session.commitTransaction();

    // Güncellenmiş seçenek ve anketi getir
    const updatedOption = await PollOption.findById(optionId);
    const updatedPoll = await Poll.findById(poll._id);

    // Kullanıcının kalan oylarını getir
    const remainingVotes = await PollVote.find({
      poll: poll._id,
      user: userId,
    }).select('option');

    res.status(200).json({
      success: true,
      data: {
        option: updatedOption,
        poll: {
          _id: updatedPoll._id,
          totalVotes: updatedPoll.totalVotes,
        },
        userVotes: remainingVotes.map((vote) => vote.option.toString()),
      },
      message: 'Oy başarıyla kaldırıldı',
    });
  } catch (error) {
    await session.abortTransaction();
    return next(new ErrorResponse('Oy kaldırılırken bir hata oluştu', 500));
  } finally {
    session.endSession();
  }
});

/**
 * @desc    Anket seçeneği detaylı istatistikleri getir
 * @route   GET /api/poll-options/:optionId/stats
 * @access  Private (Anket sahibi, moderatör veya admin)
 */
const getOptionStats = asyncHandler(async (req, res, next) => {
  const { optionId } = req.params;
  const userId = req.user._id;

  // ID formatı kontrolü
  if (!mongoose.Types.ObjectId.isValid(optionId)) {
    return next(new ErrorResponse('Geçersiz seçenek ID formatı', 400));
  }

  // Seçeneği bul
  const option = await PollOption.findById(optionId);

  if (!option) {
    return next(new ErrorResponse('Seçenek bulunamadı', 404));
  }

  // Anketi bul
  const poll = await Poll.findById(option.poll);

  if (!poll) {
    return next(new ErrorResponse('İlgili anket bulunamadı', 404));
  }

  // Post'u bul
  const post = await Post.findById(poll.post);

  if (!post) {
    return next(new ErrorResponse('İlgili post bulunamadı', 404));
  }

  // Yetki kontrolü
  const isPostAuthor = post.author.toString() === userId.toString();
  const isAdmin = req.user.role === 'admin';

  if (!isPostAuthor && !isAdmin) {
    // Moderatör kontrolü
    const subredditId = post.subreddit;
    const isModerator = await SubredditMembership.findOne({
      user: userId,
      subreddit: subredditId,
      type: 'moderator',
    });

    if (!isModerator) {
      return next(new ErrorResponse('Bu seçeneğin istatistiklerini görme yetkiniz yok', 403));
    }
  }

  // Zaman içindeki oy dağılımı
  const voteTimeline = await PollVote.aggregate([
    { $match: { option: mongoose.Types.ObjectId(optionId) } },
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

  // Son 10 oy veren kullanıcı
  const recentVoters = await PollVote.find({ option: optionId })
    .sort({ createdAt: -1 })
    .limit(10)
    .populate('user', 'username profilePicture')
    .select('createdAt');

  // Zamansal veri formatını düzenle
  const formattedTimeline = voteTimeline.map((hourData) => ({
    timestamp: new Date(
      hourData._id.year,
      hourData._id.month - 1,
      hourData._id.day,
      hourData._id.hour,
    ).toISOString(),
    count: hourData.count,
  }));

  // Bu seçeneğin diğer seçeneklere göre durumu
  const allOptions = await PollOption.find({ poll: poll._id }).sort({ position: 1 });

  const optionRanking = allOptions.map((opt) => ({
    _id: opt._id,
    text: opt.text,
    voteCount: opt.voteCount,
    position: opt.position,
    percentage: poll.totalVotes > 0 ? Math.round((opt.voteCount / poll.totalVotes) * 100) : 0,
    isTarget: opt._id.toString() === optionId,
  }));

  res.status(200).json({
    success: true,
    data: {
      option: {
        _id: option._id,
        text: option.text,
        voteCount: option.voteCount,
        position: option.position,
        percentage:
          poll.totalVotes > 0 ? Math.round((option.voteCount / poll.totalVotes) * 100) : 0,
      },
      poll: {
        _id: poll._id,
        totalVotes: poll.totalVotes,
        endDate: poll.endDate,
        isActive: new Date() < poll.endDate,
        allowMultipleVotes: poll.allowMultipleVotes,
        maxSelections: poll.maxSelections,
      },
      post: {
        _id: post._id,
        title: post.title,
        author: post.author,
      },
      stats: {
        timeline: formattedTimeline,
        recentVoters,
        ranking: optionRanking,
      },
    },
  });
});

/**
 * @desc    Seçeneğe oy veren kullanıcıları getir (admin)
 * @route   GET /api/poll-options/:optionId/voters
 * @access  Private (Admin)
 */
const getOptionVoters = asyncHandler(async (req, res, next) => {
  const { optionId } = req.params;
  const { page = 1, limit = 50 } = req.query;

  // Yetki kontrolü
  if (req.user.role !== 'admin') {
    return next(new ErrorResponse('Bu işlem için admin yetkiniz yok', 403));
  }

  // ID formatı kontrolü
  if (!mongoose.Types.ObjectId.isValid(optionId)) {
    return next(new ErrorResponse('Geçersiz seçenek ID formatı', 400));
  }

  // Seçeneği bul
  const option = await PollOption.findById(optionId);

  if (!option) {
    return next(new ErrorResponse('Seçenek bulunamadı', 404));
  }

  // Sayfalama
  const startIndex = (parseInt(page) - 1) * parseInt(limit);
  const endIndex = parseInt(page) * parseInt(limit);

  // Toplam oy sayısını bul
  const totalVotes = await PollVote.countDocuments({ option: optionId });

  // Oy veren kullanıcıları getir
  const votes = await PollVote.find({ option: optionId })
    .sort({ createdAt: -1 })
    .skip(startIndex)
    .limit(parseInt(limit))
    .populate('user', 'username email profilePicture')
    .select('createdAt ip');

  // Sayfalama sonuçları
  const pagination = {};

  if (endIndex < totalVotes) {
    pagination.next = {
      page: parseInt(page) + 1,
      limit: parseInt(limit),
    };
  }

  if (startIndex > 0) {
    pagination.prev = {
      page: parseInt(page) - 1,
      limit: parseInt(limit),
    };
  }

  res.status(200).json({
    success: true,
    count: votes.length,
    total: totalVotes,
    pagination,
    data: {
      option,
      votes,
    },
  });
});

/**
 * @desc    Toplu seçenek ekleme (admin özelliği)
 * @route   POST /api/polls/:pollId/options/bulk
 * @access  Private (Admin)
 */
const bulkAddOptions = asyncHandler(async (req, res, next) => {
  const { pollId } = req.params;
  const { options } = req.body;

  // Yetki kontrolü
  if (req.user.role !== 'admin') {
    return next(new ErrorResponse('Bu işlem için admin yetkiniz yok', 403));
  }

  // ID formatı kontrolü
  if (!mongoose.Types.ObjectId.isValid(pollId)) {
    return next(new ErrorResponse('Geçersiz anket ID formatı', 400));
  }

  // Gelen veriyi kontrol et
  if (!options || !Array.isArray(options) || options.length === 0) {
    return next(new ErrorResponse('Eklenecek seçenekler dizisi gereklidir', 400));
  }

  // Maksimum seçenek sayısını kontrol et
  if (options.length > 10) {
    return next(new ErrorResponse('En fazla 10 seçenek eklenebilir', 400));
  }

  // Anketi bul
  const poll = await Poll.findById(pollId).populate('options');

  if (!poll) {
    return next(new ErrorResponse('Anket bulunamadı', 404));
  }

  // Anketin aktif olup olmadığını kontrol et
  if (new Date() >= poll.endDate) {
    return next(new ErrorResponse('Bu anket sona ermiş, artık seçenek eklenemez', 400));
  }

  // Toplam seçenek sayısı kontrolü
  if (poll.options.length + options.length > 10) {
    return next(new ErrorResponse('Bir ankette en fazla 10 seçenek olabilir', 400));
  }

  // Benzersiz text kontrolü
  const optionTexts = options.map((opt) => opt.trim().toLowerCase());

  // Aynı metinde seçenek var mı kontrol et
  const duplicateTexts = optionTexts.filter((text, index) => optionTexts.indexOf(text) !== index);

  if (duplicateTexts.length > 0) {
    return next(new ErrorResponse('Listede tekrarlanan seçenek metinleri var', 400));
  }

  // Mevcut seçeneklerle çakışma var mı kontrol et
  const existingTexts = await PollOption.find({ poll: pollId })
    .select('text')
    .then((opts) => opts.map((opt) => opt.text.toLowerCase()));

  const conflictingTexts = optionTexts.filter((text) => existingTexts.includes(text));

  if (conflictingTexts.length > 0) {
    return next(new ErrorResponse('Bazı seçenekler zaten mevcut', 400));
  }

  // Transaction başlat
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Yeni pozisyon belirle
    let position = poll.options.length + 1;

    // Seçenekleri oluştur
    const createdOptions = [];

    for (const optionText of options) {
      if (optionText && optionText.trim()) {
        const newOption = await PollOption.create(
          [
            {
              poll: pollId,
              text: optionText.trim(),
              voteCount: 0,
              position: position++,
            },
          ],
          { session },
        );

        createdOptions.push(newOption[0]);

        // Seçeneği ankete ekle
        poll.options.push(newOption[0]._id);
      }
    }

    // Anketi güncelle
    await poll.save({ session });

    await session.commitTransaction();

    res.status(201).json({
      success: true,
      data: createdOptions,
      message: `${createdOptions.length} seçenek başarıyla eklendi`,
    });
  } catch (error) {
    await session.abortTransaction();
    return next(new ErrorResponse('Seçenekler eklenirken bir hata oluştu', 500));
  } finally {
    session.endSession();
  }
});

module.exports = {
  createPollOption,
  getPollOption,
  updatePollOption,
  deletePollOption,
  reorderPollOptions,
  voteForOption,
  removeVoteFromOption,
  getOptionStats,
  getOptionVoters,
  bulkAddOptions,
};
