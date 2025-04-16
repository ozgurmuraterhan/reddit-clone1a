const User = require('../models/User');
const TwoFactorAuth = require('../models/TwoFactorAuth');
const asyncHandler = require('../middleware/async');
const ErrorResponse = require('../utils/errorResponse');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const crypto = require('crypto');

/**
 * @desc    İki faktörlü kimlik doğrulama için başlangıç ayarlarını oluştur
 * @route   POST /api/auth/2fa/setup
 * @access  Private
 */
const setupTwoFactorAuth = asyncHandler(async (req, res, next) => {
  const userId = req.user.id;

  // Kullanıcının mevcut 2FA ayarlarını kontrol et
  let twoFactorAuth = await TwoFactorAuth.findOne({ user: userId });

  if (twoFactorAuth && twoFactorAuth.isEnabled) {
    return next(new ErrorResponse('İki faktörlü kimlik doğrulama zaten etkinleştirilmiş', 400));
  }

  // Yeni bir secret oluştur
  const secret = speakeasy.generateSecret({
    length: 20,
    name: `RedditClone:${req.user.username}`,
  });

  // QR kodu oluştur
  const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);

  // Eğer mevcut bir kayıt yoksa oluştur, varsa güncelle
  if (!twoFactorAuth) {
    twoFactorAuth = await TwoFactorAuth.create({
      user: userId,
      secret: secret.base32,
      isEnabled: false,
    });
  } else {
    twoFactorAuth.secret = secret.base32;
    twoFactorAuth.isEnabled = false;
    await twoFactorAuth.save();
  }

  res.status(200).json({
    success: true,
    data: {
      secret: secret.base32,
      qrCode: qrCodeUrl,
    },
  });
});

/**
 * @desc    İki faktörlü kimlik doğrulamayı etkinleştir
 * @route   POST /api/auth/2fa/enable
 * @access  Private
 */
const enableTwoFactorAuth = asyncHandler(async (req, res, next) => {
  const userId = req.user.id;
  const { token } = req.body;

  if (!token) {
    return next(new ErrorResponse('Doğrulama kodu gereklidir', 400));
  }

  // Kullanıcının 2FA ayarlarını kontrol et
  const twoFactorAuth = await TwoFactorAuth.findOne({ user: userId });

  if (!twoFactorAuth) {
    return next(new ErrorResponse('Önce 2FA kurulumu yapmalısınız', 400));
  }

  if (twoFactorAuth.isEnabled) {
    return next(new ErrorResponse('İki faktörlü kimlik doğrulama zaten etkin', 400));
  }

  // Token'ı doğrula
  const verified = speakeasy.totp.verify({
    secret: twoFactorAuth.secret,
    encoding: 'base32',
    token: token,
    window: 1, // 30 saniyelik bir pencere içinde -1, 0, +1 adımlarını kabul eder
  });

  if (!verified) {
    return next(new ErrorResponse('Geçersiz doğrulama kodu', 400));
  }

  // Yedek kodları oluştur
  const backupCodes = generateBackupCodes(10);

  // 2FA'yı etkinleştir
  twoFactorAuth.isEnabled = true;
  twoFactorAuth.backupCodes = backupCodes.map((code) => ({
    code: code,
    isUsed: false,
  }));
  twoFactorAuth.lastUsed = new Date();
  await twoFactorAuth.save();

  res.status(200).json({
    success: true,
    data: {
      isEnabled: true,
      backupCodes: backupCodes.map((code) => code.replace(/(.{4})(.{4})/, '$1-$2')), // Format: XXXX-XXXX
    },
    message:
      'İki faktörlü kimlik doğrulama başarıyla etkinleştirildi. Yedek kodlarınızı güvenli bir yerde saklayın.',
  });
});

/**
 * @desc    İki faktörlü kimlik doğrulamayı devre dışı bırak
 * @route   POST /api/auth/2fa/disable
 * @access  Private
 */
const disableTwoFactorAuth = asyncHandler(async (req, res, next) => {
  const userId = req.user.id;
  const { token, password } = req.body;

  if (!token && !password) {
    return next(new ErrorResponse('Doğrulama kodu veya şifre gereklidir', 400));
  }

  // Kullanıcıyı ve 2FA ayarlarını kontrol et
  const user = await User.findById(userId).select('+password');
  const twoFactorAuth = await TwoFactorAuth.findOne({ user: userId });

  if (!twoFactorAuth || !twoFactorAuth.isEnabled) {
    return next(new ErrorResponse('İki faktörlü kimlik doğrulama zaten devre dışı', 400));
  }

  // Şifre veya token ile doğrulama yap
  let isVerified = false;

  if (password) {
    // Şifre ile doğrulama
    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      return next(new ErrorResponse('Geçersiz şifre', 401));
    }
    isVerified = true;
  } else if (token) {
    // Token ile doğrulama
    isVerified = speakeasy.totp.verify({
      secret: twoFactorAuth.secret,
      encoding: 'base32',
      token: token,
      window: 1,
    });
  }

  if (!isVerified) {
    return next(new ErrorResponse('Doğrulama başarısız', 401));
  }

  // 2FA'yı devre dışı bırak
  twoFactorAuth.isEnabled = false;
  twoFactorAuth.backupCodes = [];
  await twoFactorAuth.save();

  res.status(200).json({
    success: true,
    message: 'İki faktörlü kimlik doğrulama başarıyla devre dışı bırakıldı',
  });
});

/**
 * @desc    Giriş sırasında 2FA doğrulaması
 * @route   POST /api/auth/2fa/verify
 * @access  Public
 */
const verifyTwoFactorAuth = asyncHandler(async (req, res, next) => {
  const { userId, token, backupCode } = req.body;

  if (!userId) {
    return next(new ErrorResponse('Kullanıcı kimliği gereklidir', 400));
  }

  if (!token && !backupCode) {
    return next(new ErrorResponse('Doğrulama kodu veya yedek kod gereklidir', 400));
  }

  // Kullanıcı ve 2FA ayarlarını kontrol et
  const user = await User.findById(userId);
  if (!user) {
    return next(new ErrorResponse('Kullanıcı bulunamadı', 404));
  }

  const twoFactorAuth = await TwoFactorAuth.findOne({ user: userId });
  if (!twoFactorAuth || !twoFactorAuth.isEnabled) {
    return next(new ErrorResponse('Bu kullanıcı için 2FA etkin değil', 400));
  }

  let isVerified = false;

  if (token) {
    // TOTP ile doğrulama
    isVerified = speakeasy.totp.verify({
      secret: twoFactorAuth.secret,
      encoding: 'base32',
      token: token,
      window: 1,
    });
  } else if (backupCode) {
    // Yedek kod ile doğrulama
    const formattedBackupCode = backupCode.replace('-', ''); // Format: XXXXXXXX
    const backupCodeIndex = twoFactorAuth.backupCodes.findIndex(
      (code) => code.code === formattedBackupCode && !code.isUsed,
    );

    if (backupCodeIndex !== -1) {
      // Yedek kodu kullanıldı olarak işaretle
      twoFactorAuth.backupCodes[backupCodeIndex].isUsed = true;
      isVerified = true;
    }
  }

  if (!isVerified) {
    return next(new ErrorResponse('Geçersiz doğrulama kodu', 401));
  }

  // Son kullanma zamanını güncelle
  twoFactorAuth.lastUsed = new Date();
  await twoFactorAuth.save();

  // Kullanıcı oturumunu oluştur
  sendTokenResponse(user, 200, res);
});

/**
 * @desc    2FA durumunu kontrol et
 * @route   GET /api/auth/2fa/status
 * @access  Private
 */
const getTwoFactorAuthStatus = asyncHandler(async (req, res, next) => {
  const userId = req.user.id;

  const twoFactorAuth = await TwoFactorAuth.findOne({ user: userId });

  const status = {
    isEnabled: twoFactorAuth ? twoFactorAuth.isEnabled : false,
    hasBackupCodes: twoFactorAuth
      ? twoFactorAuth.backupCodes && twoFactorAuth.backupCodes.length > 0
      : false,
    lastUsed: twoFactorAuth ? twoFactorAuth.lastUsed : null,
  };

  res.status(200).json({
    success: true,
    data: status,
  });
});

/**
 * @desc    Yeni yedek kodları oluştur
 * @route   POST /api/auth/2fa/backup-codes
 * @access  Private
 */
const regenerateBackupCodes = asyncHandler(async (req, res, next) => {
  const userId = req.user.id;
  const { token } = req.body;

  if (!token) {
    return next(new ErrorResponse('Doğrulama kodu gereklidir', 400));
  }

  const twoFactorAuth = await TwoFactorAuth.findOne({ user: userId });

  if (!twoFactorAuth || !twoFactorAuth.isEnabled) {
    return next(new ErrorResponse('İki faktörlü kimlik doğrulama etkin değil', 400));
  }

  // Token doğrulama
  const verified = speakeasy.totp.verify({
    secret: twoFactorAuth.secret,
    encoding: 'base32',
    token: token,
    window: 1,
  });

  if (!verified) {
    return next(new ErrorResponse('Geçersiz doğrulama kodu', 401));
  }

  // Yeni yedek kodlar oluştur
  const backupCodes = generateBackupCodes(10);

  // Yedek kodları güncelle
  twoFactorAuth.backupCodes = backupCodes.map((code) => ({
    code: code,
    isUsed: false,
  }));

  await twoFactorAuth.save();

  res.status(200).json({
    success: true,
    data: {
      backupCodes: backupCodes.map((code) => code.replace(/(.{4})(.{4})/, '$1-$2')),
    },
    message: 'Yeni yedek kodlar başarıyla oluşturuldu. Bu kodları güvenli bir yerde saklayın.',
  });
});

/**
 * @desc    2FA secret anahtarını sıfırla (güvenlik ihlali durumunda)
 * @route   POST /api/auth/2fa/reset
 * @access  Private
 */
const resetTwoFactorAuth = asyncHandler(async (req, res, next) => {
  const userId = req.user.id;
  const { password } = req.body;

  if (!password) {
    return next(new ErrorResponse('Şifre gereklidir', 400));
  }

  // Kullanıcıyı kontrol et
  const user = await User.findById(userId).select('+password');

  // Şifre doğrulama
  const isMatch = await user.matchPassword(password);
  if (!isMatch) {
    return next(new ErrorResponse('Geçersiz şifre', 401));
  }

  // 2FA kaydını bul
  const twoFactorAuth = await TwoFactorAuth.findOne({ user: userId });

  if (!twoFactorAuth) {
    return next(new ErrorResponse('İki faktörlü kimlik doğrulama kaydı bulunamadı', 404));
  }

  // Yeni bir secret oluştur
  const secret = speakeasy.generateSecret({
    length: 20,
    name: `RedditClone:${req.user.username}`,
  });

  // QR kodu oluştur
  const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);

  // 2FA kaydını güncelle
  twoFactorAuth.secret = secret.base32;
  twoFactorAuth.isEnabled = false;
  twoFactorAuth.backupCodes = [];
  await twoFactorAuth.save();

  res.status(200).json({
    success: true,
    data: {
      secret: secret.base32,
      qrCode: qrCodeUrl,
    },
    message:
      '2FA anahtarı başarıyla sıfırlandı. Yeniden etkinleştirmek için yeni QR kodunu taratın.',
  });
});

// ==================== HELPER FUNCTIONS ====================

/**
 * Yedek kodlar oluştur
 * @param {Number} count - Kaç adet kod oluşturulacak
 * @returns {Array} - Yedek kodlar listesi
 */
const generateBackupCodes = (count = 10) => {
  const codes = [];
  for (let i = 0; i < count; i++) {
    // 8 karakterlik alfanumerik kod oluştur
    const code = crypto.randomBytes(4).toString('hex').toUpperCase();
    codes.push(code);
  }
  return codes;
};

/**
 * Token oluşturup cookie içinde gönder
 * @param {Object} user - Kullanıcı objesi
 * @param {Number} statusCode - HTTP status kodu
 * @param {Object} res - Response objesi
 */
const sendTokenResponse = (user, statusCode, res) => {
  // Token oluştur
  const token = user.getSignedJwtToken();

  const options = {
    expires: new Date(Date.now() + process.env.JWT_COOKIE_EXPIRE * 24 * 60 * 60 * 1000),
    httpOnly: true,
  };

  if (process.env.NODE_ENV === 'production') {
    options.secure = true;
  }

  // Kullanıcı bilgilerini dön, hassas bilgileri çıkar
  const userData = {
    id: user._id,
    username: user.username,
    email: user.email,
    profilePicture: user.profilePicture,
    createdAt: user.createdAt,
    lastLogin: user.lastLogin,
    accountStatus: user.accountStatus,
    twoFactorAuthEnabled: true, // 2FA doğrulaması geçildiği için true
  };

  res.status(statusCode).cookie('token', token, options).json({
    success: true,
    token,
    data: userData,
  });
};

/**
 * @desc    2FA durumunu kontrol et (Giriş akışı için)
 * @route   POST /api/auth/2fa/check
 * @access  Public
 */
const checkTwoFactorAuth = asyncHandler(async (req, res, next) => {
  const { userId } = req.body;

  if (!userId) {
    return next(new ErrorResponse('Kullanıcı kimliği gereklidir', 400));
  }

  // Kullanıcı ve 2FA ayarlarını kontrol et
  const user = await User.findById(userId);
  if (!user) {
    return next(new ErrorResponse('Kullanıcı bulunamadı', 404));
  }

  const twoFactorAuth = await TwoFactorAuth.findOne({ user: userId });

  if (!twoFactorAuth || !twoFactorAuth.isEnabled) {
    // 2FA etkin değilse direkt oturum aç
    sendTokenResponse(user, 200, res);
  } else {
    // 2FA etkinse doğrulama gerektiğini bildir
    res.status(200).json({
      success: true,
      requires2FA: true,
      userId: user._id,
      message: 'İki faktörlü kimlik doğrulama gerekiyor',
    });
  }
});

/**
 * @desc    Mevcut 2FA yedek kodlarını getir
 * @route   GET /api/auth/2fa/backup-codes
 * @access  Private
 */
const getBackupCodes = asyncHandler(async (req, res, next) => {
  const userId = req.user.id;
  const { password } = req.body;

  if (!password) {
    return next(new ErrorResponse('Şifre gereklidir', 400));
  }

  // Kullanıcıyı kontrol et
  const user = await User.findById(userId).select('+password');

  // Şifre doğrulama
  const isMatch = await user.matchPassword(password);
  if (!isMatch) {
    return next(new ErrorResponse('Geçersiz şifre', 401));
  }

  // 2FA yedek kodlarını al
  const twoFactorAuth = await TwoFactorAuth.findOne({ user: userId });

  if (!twoFactorAuth || !twoFactorAuth.isEnabled) {
    return next(new ErrorResponse('İki faktörlü kimlik doğrulama etkin değil', 400));
  }

  // Kullanılmamış yedek kodları filtrele
  const unusedBackupCodes = twoFactorAuth.backupCodes
    .filter((code) => !code.isUsed)
    .map((code) => code.code.replace(/(.{4})(.{4})/, '$1-$2'));

  res.status(200).json({
    success: true,
    data: {
      backupCodes: unusedBackupCodes,
      total: unusedBackupCodes.length,
    },
  });
});

/**
 * @desc    Kullanıcının 2FA aktivite günlüğünü getir
 * @route   GET /api/auth/2fa/activity
 * @access  Private
 */
const getTwoFactorAuthActivity = asyncHandler(async (req, res, next) => {
  const userId = req.user.id;

  // 2FA bilgilerini getir
  const twoFactorAuth = await TwoFactorAuth.findOne({ user: userId });

  if (!twoFactorAuth) {
    return next(new ErrorResponse('İki faktörlü kimlik doğrulama kaydı bulunamadı', 404));
  }

  // Aktivite bilgilerini dön
  const activityInfo = {
    isEnabled: twoFactorAuth.isEnabled,
    lastUsed: twoFactorAuth.lastUsed,
    createdAt: twoFactorAuth.createdAt,
    updatedAt: twoFactorAuth.updatedAt,
    backupCodesCount: twoFactorAuth.backupCodes.length,
    backupCodesUsed: twoFactorAuth.backupCodes.filter((code) => code.isUsed).length,
  };

  res.status(200).json({
    success: true,
    data: activityInfo,
  });
});

module.exports = {
  setupTwoFactorAuth,
  enableTwoFactorAuth,
  disableTwoFactorAuth,
  verifyTwoFactorAuth,
  getTwoFactorAuthStatus,
  regenerateBackupCodes,
  resetTwoFactorAuth,
  checkTwoFactorAuth,
  getBackupCodes,
  getTwoFactorAuthActivity,
};
