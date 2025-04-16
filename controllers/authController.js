const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Role = require('../models/Role');
const UserRoleAssignment = require('../models/UserRoleAssignment');
const Permission = require('../models/Permission');
const ErrorResponse = require('../utils/errorResponse');
const asyncHandler = require('../middleware/async');
const sendEmail = require('../utils/sendEmail');

/**
 * @desc    Kullanıcı kaydı oluştur
 * @route   POST /api/auth/register
 * @access  Public
 */
const register = asyncHandler(async (req, res, next) => {
  const { username, email, password, confirmPassword } = req.body;

  // Şifre doğrulama kontrolü
  if (password !== confirmPassword) {
    return next(new ErrorResponse('Şifreler eşleşmiyor', 400));
  }

  // Kullanıcı adı ve email kontrolü
  const usernameExists = await User.findOne({ username });
  if (usernameExists) {
    return next(new ErrorResponse('Bu kullanıcı adı zaten kullanılıyor', 400));
  }

  const emailExists = await User.findOne({ email });
  if (emailExists) {
    return next(new ErrorResponse('Bu email adresi zaten kullanılıyor', 400));
  }

  // Şifre hashleme
  const salt = await bcrypt.genSalt(12);
  const hashedPassword = await bcrypt.hash(password, salt);

  // Doğrulama token'ı oluştur
  const verificationToken = crypto.randomBytes(20).toString('hex');
  const verificationTokenExpire = Date.now() + 24 * 60 * 60 * 1000; // 24 saat

  // Kullanıcı oluştur
  const user = await User.create({
    username,
    email,
    password: hashedPassword,
    verificationToken,
    verificationTokenExpire,
    accountStatus: 'pending_verification',
  });

  // Default kullanıcı rolünü bul ve ata
  const defaultRole = await Role.findOne({ isDefault: true, scope: 'site' });
  if (defaultRole) {
    await UserRoleAssignment.create({
      user: user._id,
      role: defaultRole._id,
    });
  }

  // Doğrulama e-postası gönder
  try {
    const verificationUrl = `${req.protocol}://${req.get('host')}/api/auth/verify-email/${verificationToken}`;

    const message = `
      <h1>Email Adresinizi Doğrulayın</h1>
      <p>Reddit klonumuza hoş geldiniz! Hesabınızı aktifleştirmek için lütfen aşağıdaki bağlantıya tıklayın:</p>
      <a href="${verificationUrl}" target="_blank">Hesabımı Doğrula</a>
      <p>Bu e-posta sizin tarafınızdan talep edilmediyse, lütfen dikkate almayın.</p>
    `;

    await sendEmail({
      email: user.email,
      subject: 'Email Doğrulama',
      html: message,
    });

    res.status(201).json({
      success: true,
      message:
        'Kullanıcı kaydı başarılı. Email adresinize gönderilen link ile hesabınızı doğrulayın.',
    });
  } catch (error) {
    // Email gönderilemediğinde kullanıcıyı bilgilendir ama işlemi iptal etme
    console.error('Email gönderme hatası:', error);

    res.status(201).json({
      success: true,
      message:
        'Kullanıcı kaydı başarılı fakat doğrulama e-postası gönderilemedi. Lütfen yöneticiyle iletişime geçin.',
      error: 'Email gönderme hatası',
    });
  }
});

/**
 * @desc    Email doğrulama
 * @route   GET /api/auth/verify-email/:token
 * @access  Public
 */
const verifyEmail = asyncHandler(async (req, res, next) => {
  const { token } = req.params;

  // Token ile kullanıcıyı bul
  const user = await User.findOne({
    verificationToken: token,
    verificationTokenExpire: { $gt: Date.now() },
  });

  if (!user) {
    return next(new ErrorResponse("Geçersiz veya süresi dolmuş doğrulama token'ı", 400));
  }

  // Kullanıcı hesabını aktifleştir
  user.emailVerified = true;
  user.accountStatus = 'active';
  user.verificationToken = undefined;
  user.verificationTokenExpire = undefined;
  await user.save();

  res.status(200).json({
    success: true,
    message: 'Email doğrulama başarılı. Hesabınız aktifleştirildi.',
  });
});

/**
 * @desc    Kullanıcı girişi
 * @route   POST /api/auth/login
 * @access  Public
 */
const login = asyncHandler(async (req, res, next) => {
  const { username, email, password } = req.body;

  // Kullanıcı adı veya email kontrolü
  if (!username && !email) {
    return next(new ErrorResponse('Lütfen kullanıcı adı veya email girin', 400));
  }

  // Şifre kontrolü
  if (!password) {
    return next(new ErrorResponse('Lütfen şifre girin', 400));
  }

  // Kullanıcıyı bul
  const query = {};
  if (username) query.username = username;
  if (email) query.email = email;

  const user = await User.findOne(query).select('+password');

  if (!user) {
    return next(new ErrorResponse('Hatalı kullanıcı bilgileri', 401));
  }

  // Hesap durumu kontrolü
  if (user.accountStatus === 'suspended') {
    return next(
      new ErrorResponse(
        'Hesabınız askıya alınmıştır. Daha fazla bilgi için yöneticiyle iletişime geçin.',
        403,
      ),
    );
  }

  if (user.accountStatus === 'pending_verification') {
    return next(
      new ErrorResponse('Lütfen hesabınızı email adresinize gönderilen link ile doğrulayın.', 401),
    );
  }

  if (user.accountStatus === 'deleted') {
    return next(new ErrorResponse('Bu hesap silindi', 401));
  }

  // Şifre kontrolü
  const isMatch = await bcrypt.compare(password, user.password);

  if (!isMatch) {
    return next(new ErrorResponse('Hatalı kullanıcı bilgileri', 401));
  }

  // Son giriş tarihini güncelle
  user.lastLogin = Date.now();
  user.lastActive = Date.now();
  await user.save();

  // JWT token oluştur
  sendTokenResponse(user, 200, res);
});

/**
 * @desc    Sosyal medya hesabı ile giriş/kayıt
 * @route   POST /api/auth/social/:provider
 * @access  Public
 */
const socialAuth = asyncHandler(async (req, res, next) => {
  const { provider } = req.params;
  const { id, email, name, picture } = req.body;

  if (!['google', 'facebook', 'twitter', 'github'].includes(provider)) {
    return next(new ErrorResponse('Desteklenmeyen kimlik doğrulama sağlayıcısı', 400));
  }

  if (!id || !email) {
    return next(new ErrorResponse('ID ve email bilgileri gereklidir', 400));
  }

  // Email doğrulaması yapılmış sosyal giriş kabul edilir
  let user = await User.findOne({ email });

  if (user) {
    // Eğer kullanıcı varsa auth provider bilgisini güncelle/ekle
    if (user.authProvider !== provider || user.authProviderId !== id) {
      user.authProvider = provider;
      user.authProviderId = id;
      await user.save();
    }
  } else {
    // Kullanıcı yoksa oluştur
    const username = await generateUniqueUsername(name || email.split('@')[0]);

    user = await User.create({
      username,
      email,
      password: crypto.randomBytes(16).toString('hex'), // Rastgele şifre (direkt giriş yapılamaz)
      profilePicture: picture || `default-profile.png`,
      authProvider: provider,
      authProviderId: id,
      emailVerified: true, // Sosyal giriş kullanıcıları email doğrulaması atlar
      accountStatus: 'active',
    });

    // Default kullanıcı rolünü ata
    const defaultRole = await Role.findOne({ isDefault: true, scope: 'site' });
    if (defaultRole) {
      await UserRoleAssignment.create({
        user: user._id,
        role: defaultRole._id,
      });
    }
  }

  // Son giriş tarihini güncelle
  user.lastLogin = Date.now();
  user.lastActive = Date.now();
  await user.save();

  // JWT token oluştur
  sendTokenResponse(user, 200, res);
});

/**
 * @desc    Mevcut giriş yapmış kullanıcı bilgilerini getir
 * @route   GET /api/auth/me
 * @access  Private
 */
const getMe = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.user._id).select('-password');

  // Kullanıcının rollerini getir
  const roleAssignments = await UserRoleAssignment.find({ user: user._id }).populate({
    path: 'role',
    select: 'name permissions scope',
    populate: {
      path: 'permissions',
      select: 'name category scope',
    },
  });

  // Basitleştirilmiş rol ve izin listesi oluştur
  const roles = roleAssignments.map((assignment) => ({
    id: assignment.role._id,
    name: assignment.role.name,
    scope: assignment.role.scope,
    subreddit: assignment.subreddit || null,
    permissions: assignment.role.permissions.map((p) => p.name),
  }));

  // Son aktiflik tarihini güncelle
  user.lastActive = Date.now();
  await user.save({ validateBeforeSave: false });

  res.status(200).json({
    success: true,
    data: {
      user,
      roles,
    },
  });
});

/**
 * @desc    Kullanıcı çıkışı
 * @route   GET /api/auth/logout
 * @access  Private
 */
const logout = asyncHandler(async (req, res, next) => {
  res.cookie('token', 'none', {
    expires: new Date(Date.now() + 10 * 1000), // 10 saniye sonra expire
    httpOnly: true,
  });

  res.status(200).json({
    success: true,
    data: {},
  });
});

/**
 * @desc    Şifre güncelleme
 * @route   PUT /api/auth/update-password
 * @access  Private
 */
const updatePassword = asyncHandler(async (req, res, next) => {
  const { currentPassword, newPassword, confirmPassword } = req.body;

  // Şifre doğrulama kontrolü
  if (newPassword !== confirmPassword) {
    return next(new ErrorResponse('Yeni şifreler eşleşmiyor', 400));
  }

  // Kullanıcıyı şifresiyle getir
  const user = await User.findById(req.user._id).select('+password');

  // Sosyal medya hesabıyla giriş yapan kullanıcılar için kontrol
  if (user.authProvider !== 'local') {
    return next(
      new ErrorResponse(
        `${user.authProvider} hesabı ile giriş yaptığınız için şifre değiştiremezsiniz`,
        400,
      ),
    );
  }

  // Mevcut şifre kontrolü
  const isMatch = await bcrypt.compare(currentPassword, user.password);

  if (!isMatch) {
    return next(new ErrorResponse('Mevcut şifre hatalı', 401));
  }

  // Şifre hashleme
  const salt = await bcrypt.genSalt(12);
  const hashedPassword = await bcrypt.hash(newPassword, salt);

  // Şifreyi güncelle
  user.password = hashedPassword;
  await user.save();

  sendTokenResponse(user, 200, res);
});

/**
 * @desc    Şifremi unuttum
 * @route   POST /api/auth/forgot-password
 * @access  Public
 */
const forgotPassword = asyncHandler(async (req, res, next) => {
  const { email } = req.body;

  if (!email) {
    return next(new ErrorResponse('Lütfen email adresinizi girin', 400));
  }

  const user = await User.findOne({ email });

  if (!user) {
    return next(new ErrorResponse('Bu email adresiyle kayıtlı kullanıcı bulunamadı', 404));
  }

  // Sosyal medya hesabıyla giriş yapan kullanıcılar için kontrol
  if (user.authProvider !== 'local') {
    return next(new ErrorResponse(`Lütfen ${user.authProvider} hesabınızla giriş yapın`, 400));
  }

  // Şifre sıfırlama token'ı oluştur
  const resetToken = crypto.randomBytes(20).toString('hex');

  // Token'ı hash'le ve DB'ye kaydet
  user.resetPasswordToken = crypto.createHash('sha256').update(resetToken).digest('hex');

  // Token süresi: 10 dakika
  user.resetPasswordExpire = Date.now() + 10 * 60 * 1000;

  await user.save({ validateBeforeSave: false });

  // Şifre sıfırlama e-postası gönder
  try {
    const resetUrl = `${req.protocol}://${req.get('host')}/api/auth/reset-password/${resetToken}`;

    const message = `
      <h1>Şifre Sıfırlama İsteği</h1>
      <p>Şifrenizi sıfırlamak için aşağıdaki bağlantıya tıklayın:</p>
      <a href="${resetUrl}" target="_blank">Şifremi Sıfırla</a>
      <p>Bu link 10 dakika sonra geçerliliğini yitirecektir.</p>
      <p>Eğer bu isteği siz yapmadıysanız, bu e-postayı dikkate almayın.</p>
    `;

    await sendEmail({
      email: user.email,
      subject: 'Şifre Sıfırlama',
      html: message,
    });

    res.status(200).json({
      success: true,
      message: 'Şifre sıfırlama linki e-posta adresinize gönderildi',
    });
  } catch (error) {
    console.error('Email gönderme hatası:', error);

    // Token'ları sıfırla
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;
    await user.save({ validateBeforeSave: false });

    return next(new ErrorResponse('Email gönderilemedi. Lütfen daha sonra tekrar deneyin.', 500));
  }
});

/**
 * @desc    Şifre sıfırlama
 * @route   PUT /api/auth/reset-password/:token
 * @access  Public
 */
const resetPassword = asyncHandler(async (req, res, next) => {
  const { token } = req.params;
  const { password, confirmPassword } = req.body;

  // Şifre doğrulama kontrolü
  if (!password || !confirmPassword) {
    return next(new ErrorResponse('Lütfen şifre ve şifre doğrulama alanlarını doldurun', 400));
  }

  if (password !== confirmPassword) {
    return next(new ErrorResponse('Şifreler eşleşmiyor', 400));
  }

  // Token'ı hash'le
  const resetPasswordToken = crypto.createHash('sha256').update(token).digest('hex');

  // Token'a sahip ve süresi dolmamış kullanıcıyı bul
  const user = await User.findOne({
    resetPasswordToken,
    resetPasswordExpire: { $gt: Date.now() },
  });

  if (!user) {
    return next(new ErrorResponse('Geçersiz veya süresi dolmuş token', 400));
  }

  // Şifre hashleme
  const salt = await bcrypt.genSalt(12);
  const hashedPassword = await bcrypt.hash(password, salt);

  // Şifreyi güncelle ve token'ları sıfırla
  user.password = hashedPassword;
  user.resetPasswordToken = undefined;
  user.resetPasswordExpire = undefined;
  await user.save();

  // E-posta bildirimi gönder
  try {
    const message = `
      <h1>Şifreniz Başarıyla Değiştirildi</h1>
      <p>Reddit klonumuzda şifreniz başarıyla değiştirildi.</p>
      <p>Eğer bu değişikliği siz yapmadıysanız, lütfen hemen bizimle iletişime geçin.</p>
    `;

    await sendEmail({
      email: user.email,
      subject: 'Şifre Değişikliği Bildirimi',
      html: message,
    });
  } catch (error) {
    console.error('Email gönderme hatası:', error);
    // Şifre değişikliği tamamlandı, email gönderim hatası işlemi engellemez
  }

  sendTokenResponse(user, 200, res);
});

/**
 * @desc    Profil güncelleme
 * @route   PUT /api/auth/update-profile
 * @access  Private
 */
const updateProfile = asyncHandler(async (req, res, next) => {
  const allowedFields = ['bio'];
  const updateData = {};

  // İzin verilen alanları güncelleme objesine ekle
  Object.keys(req.body).forEach((key) => {
    if (allowedFields.includes(key)) {
      updateData[key] = req.body[key];
    }
  });

  // Güncelleme yapılacak alan yok ise
  if (Object.keys(updateData).length === 0) {
    return next(new ErrorResponse('Güncellenecek alan bulunamadı', 400));
  }

  // Kullanıcıyı güncelle
  const user = await User.findByIdAndUpdate(req.user._id, updateData, {
    new: true,
    runValidators: true,
  }).select('-password');

  res.status(200).json({
    success: true,
    data: user,
  });
});

/**
 * @desc    Hesabı silme (soft delete)
 * @route   DELETE /api/auth/delete-account
 * @access  Private
 */
const deleteAccount = asyncHandler(async (req, res, next) => {
  const { password, confirmDelete } = req.body;

  // Silme onayı
  if (!confirmDelete || confirmDelete !== 'DELETE') {
    return next(
      new ErrorResponse('Hesap silme işlemi için "DELETE" yazarak onay vermeniz gerekiyor', 400),
    );
  }

  // Kullanıcıyı şifresiyle getir
  const user = await User.findById(req.user._id).select('+password');

  // Sosyal giriş kontrolü
  if (user.authProvider !== 'local') {
    // Sosyal giriş için şifre doğrulaması gerekmez
  } else {
    // Şifre kontrolü
    if (!password) {
      return next(new ErrorResponse('Lütfen şifrenizi girin', 400));
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return next(new ErrorResponse('Şifre hatalı', 401));
    }
  }

  // Kullanıcı hesabını soft delete
  user.isDeleted = true;
  user.deletedAt = Date.now();
  user.accountStatus = 'deleted';
  user.username = `deleted_${user.username}_${Date.now()}`;
  user.email = `deleted_${user.email}_${Date.now()}`;
  await user.save({ validateBeforeSave: false });

  // İlişkili içerikleri işaretleme (posts ve comments)
  // Bu işlem arka planda görev olarak çalıştırılabilir

  // Gönderi ve yorumları işaretleme
  await Post.updateMany(
    { author: user._id },
    { isDeleted: true, deletedAt: Date.now(), deletedBy: user._id },
  );

  await Comment.updateMany(
    { author: user._id },
    { isDeleted: true, deletedAt: Date.now(), deletedBy: user._id },
  );

  // Oturumu sonlandır
  res.cookie('token', 'none', {
    expires: new Date(Date.now() + 10 * 1000),
    httpOnly: true,
  });

  res.status(200).json({
    success: true,
    message: 'Hesabınız başarıyla silindi.',
  });
});

/**
 * @desc    Token oluşturma ve yanıt gönderme yardımcı fonksiyonu
 * @private
 */
const sendTokenResponse = (user, statusCode, res) => {
  // JWT token oluştur
  const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE,
  });

  const options = {
    expires: new Date(Date.now() + process.env.JWT_COOKIE_EXPIRE * 24 * 60 * 60 * 1000),
    httpOnly: true,
  };

  // HTTPS modunda güvenli cookie
  if (process.env.NODE_ENV === 'production') {
    options.secure = true;
  }

  // Bazı hassas verileri çıkar
  user.password = undefined;

  res.status(statusCode).cookie('token', token, options).json({
    success: true,
    token,
    user,
  });
};

/**
 * @desc    Benzersiz kullanıcı adı oluşturma (Sosyal giriş için)
 * @private
 */
const generateUniqueUsername = async (baseUsername) => {
  // Kullanıcı adını oluştur (özel karakterleri kaldır)
  let username = baseUsername
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .substring(0, 15); // Max 15 karakter

  // Kullanıcı adı boşsa default değer ata
  if (!username) {
    username = 'user';
  }

  // Benzersiz kullanıcı adı oluştur
  let isUnique = false;
  let counter = 0;
  let finalUsername = username;

  while (!isUnique) {
    // Aynı kullanıcı adı var mı kontrol et
    const existing = await User.findOne({ username: finalUsername });

    if (!existing) {
      isUnique = true;
    } else {
      counter++;
      finalUsername = `${username}${counter}`;
    }

    // Sonsuz döngü önlemi
    if (counter > 1000) {
      finalUsername = `user_${crypto.randomBytes(4).toString('hex')}`;
      isUnique = true;
    }
  }

  return finalUsername;
};

module.exports = {
  register,
  verifyEmail,
  login,
  socialAuth,
  getMe,
  logout,
  updatePassword,
  forgotPassword,
  resetPassword,
  updateProfile,
  deleteAccount,
};
