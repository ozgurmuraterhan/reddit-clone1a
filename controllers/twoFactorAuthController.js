const crypto = require('crypto');
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');
const asyncHandler = require('../middleware/async');
const ErrorResponse = require('../utils/errorResponse');
const TwoFactorAuth = require('../models/TwoFactorAuth');
const User = require('../models/User');
const AdminLog = require('../models/AdminLog');

/**
 * @desc    İki faktörlü doğrulama için QR kodu ve geçici secret oluştur
 * @route   GET /api/users/2fa/setup
 * @access  Private
 */
const setupTwoFactorAuth = asyncHandler(async (req, res, next) => {
  const userId = req.user._id;

  // Kullanıcının mevcut 2FA durumunu kontrol et
  const existingSetup = await TwoFactorAuth.findOne({ user: userId });

  if (existingSetup && existingSetup.isEnabled) {
    return next(
      new ErrorResponse('İki faktörlü doğrulama zaten etkin. Önce devre dışı bırakın.', 400),
    );
  }

  // Geçici secret oluştur
  const secret = speakeasy.generateSecret({
    length: 20,
    name: `RedditClone:${req.user.username}`,
  });

  // Eğer daha önce kurulum yapıldıysa güncelle, yoksa yeni oluştur
  if (existingSetup) {
    existingSetup.tempSecret = secret.base32;
    existingSetup.updatedAt = Date.now();
    await existingSetup.save();
  } else {
    await TwoFactorAuth.create({
      user: userId,
      tempSecret: secret.base32,
      isEnabled: false,
    });
  }

  // QR kod URL'i oluştur
  const qrCodeUrl = await qrcode.toDataURL(secret.otpauth_url);

  res.status(200).json({
    success: true,
    data: {
      qrCode: qrCodeUrl,
      secret: secret.base32, // Manuel kurulum için
      otpAuthUrl: secret.otpauth_url,
    },
    message:
      'İki faktörlü doğrulama kurulumu başlatıldı. Lütfen bir sonraki adımda doğrulama kodunu girin.',
  });
});

/**
 * @desc    Geçici secret'ı doğrula ve 2FA'yı etkinleştir
 * @route   POST /api/users/2fa/verify-setup
 * @access  Private
 */
const verifyAndEnableTwoFactorAuth = asyncHandler(async (req, res, next) => {
  const { token } = req.body;
  const userId = req.user._id;

  if (!token) {
    return next(new ErrorResponse('Doğrulama kodu gereklidir', 400));
  }

  // Kullanıcının 2FA kurulumunu bul
  const twoFactorAuth = await TwoFactorAuth.findOne({
    user: userId,
    isEnabled: false,
    tempSecret: { $exists: true, $ne: null },
  });

  if (!twoFactorAuth) {
    return next(new ErrorResponse('Önce 2FA kurulumunu başlatmalısınız', 404));
  }

  // Token'ı doğrula
  const verified = speakeasy.totp.verify({
    secret: twoFactorAuth.tempSecret,
    encoding: 'base32',
    token: token,
    window: 1, // ±1 adım (30 saniye) tolerans
  });

  if (!verified) {
    return next(new ErrorResponse('Geçersiz doğrulama kodu. Lütfen tekrar deneyin.', 400));
  }

  // Doğrulama başarılı, 2FA'yı etkinleştir
  twoFactorAuth.secret = twoFactorAuth.tempSecret;
  twoFactorAuth.tempSecret = undefined;
  twoFactorAuth.isEnabled = true;
  twoFactorAuth.enabledAt = Date.now();
  twoFactorAuth.updatedAt = Date.now();

  // Yedek kodlar oluştur (10 adet)
  twoFactorAuth.backupCodes = Array(10)
    .fill()
    .map(() => ({
      code: crypto.randomBytes(4).toString('hex'),
      isUsed: false,
    }));

  await twoFactorAuth.save();

  // Kullanıcı modelinde 2FA durumunu güncelle
  await User.findByIdAndUpdate(userId, { isTwoFactorEnabled: true });

  // Güvenlik log kaydı tut
  await AdminLog.create({
    user: userId,
    action: '2fa_enabled',
    details: 'İki faktörlü doğrulama etkinleştirildi',
    ip: req.ip,
  });

  // Yedek kodları döndür
  const backupCodes = twoFactorAuth.backupCodes.map((item) => item.code);

  res.status(200).json({
    success: true,
    message: 'İki faktörlü doğrulama başarıyla etkinleştirildi',
    data: {
      isEnabled: true,
      backupCodes,
    },
  });
});

/**
 * @desc    İki faktörlü doğrulama ile giriş doğrulama
 * @route   POST /api/auth/2fa/verify
 * @access  Public (token gerekir)
 */
const verifyTwoFactorAuthToken = asyncHandler(async (req, res, next) => {
  const { token, userId, tempAuthToken } = req.body;

  if (!token || !userId || !tempAuthToken) {
    return next(new ErrorResponse('Token, kullanıcı ID ve geçici oturum tokeni gereklidir', 400));
  }

  // Geçici oturum tokenini doğrula
  // NOT: Bu kısım auth middleware ile entegre edilmelidir

  // Kullanıcının 2FA bilgisini bul
  const twoFactorAuth = await TwoFactorAuth.findOne({
    user: userId,
    isEnabled: true,
  });

  if (!twoFactorAuth) {
    return next(new ErrorResponse('Kullanıcı için 2FA bulunamadı', 404));
  }

  // TOTP kodunu doğrula
  const verified = speakeasy.totp.verify({
    secret: twoFactorAuth.secret,
    encoding: 'base32',
    token: token,
    window: 1,
  });

  if (!verified) {
    // Başarısız giriş denemesini log'la
    await AdminLog.create({
      user: userId,
      action: '2fa_verification_failed',
      details: 'Başarısız 2FA doğrulama denemesi',
      ip: req.ip,
    });

    return next(new ErrorResponse('Geçersiz doğrulama kodu', 400));
  }

  // Son kullanımı güncelle
  twoFactorAuth.lastUsed = Date.now();
  twoFactorAuth.updatedAt = Date.now();
  await twoFactorAuth.save();

  // Başarılı girişi log'la
  await AdminLog.create({
    user: userId,
    action: '2fa_verification_success',
    details: '2FA doğrulama başarılı',
    ip: req.ip,
  });

  // AuthController ile entegre edilecek - JWT token üretimi burada yapılabilir

  res.status(200).json({
    success: true,
    message: 'İki faktörlü doğrulama başarılı',
    data: {
      // JWT token ve kullanıcı bilgileri burada döndürülecek
    },
  });
});

/**
 * @desc    Yedek kod ile giriş doğrulama
 * @route   POST /api/auth/2fa/verify-backup
 * @access  Public (token gerekir)
 */
const verifyBackupCode = asyncHandler(async (req, res, next) => {
  const { backupCode, userId, tempAuthToken } = req.body;

  if (!backupCode || !userId || !tempAuthToken) {
    return next(
      new ErrorResponse('Yedek kod, kullanıcı ID ve geçici oturum tokeni gereklidir', 400),
    );
  }

  // Geçici oturum tokenini doğrula
  // NOT: Bu kısım auth middleware ile entegre edilmelidir

  // Kullanıcının 2FA bilgisini bul
  const twoFactorAuth = await TwoFactorAuth.findOne({
    user: userId,
    isEnabled: true,
  });

  if (!twoFactorAuth) {
    return next(new ErrorResponse('Kullanıcı için 2FA bulunamadı', 404));
  }

  // Yedek kod geçerli mi kontrol et
  const backupCodeIndex = twoFactorAuth.backupCodes.findIndex(
    (item) => item.code === backupCode && !item.isUsed,
  );

  if (backupCodeIndex === -1) {
    // Başarısız giriş denemesini log'la
    await AdminLog.create({
      user: userId,
      action: '2fa_backup_code_verification_failed',
      details: 'Geçersiz yedek kod ile başarısız doğrulama denemesi',
      ip: req.ip,
    });

    return next(new ErrorResponse('Geçersiz veya kullanılmış yedek kod', 400));
  }

  // Yedek kodu kullanılmış olarak işaretle
  twoFactorAuth.backupCodes[backupCodeIndex].isUsed = true;
  twoFactorAuth.backupCodes[backupCodeIndex].usedAt = Date.now();

  // Son kullanımı güncelle
  twoFactorAuth.lastUsed = Date.now();
  twoFactorAuth.updatedAt = Date.now();

  await twoFactorAuth.save();

  // Başarılı girişi log'la
  await AdminLog.create({
    user: userId,
    action: '2fa_backup_code_verification_success',
    details: 'Yedek kod ile başarılı doğrulama',
    ip: req.ip,
  });

  // AuthController ile entegre edilecek - JWT token üretimi burada yapılabilir

  res.status(200).json({
    success: true,
    message: 'Yedek kod doğrulama başarılı',
    data: {
      // JWT token ve kullanıcı bilgileri burada döndürülecek
    },
  });
});

/**
 * @desc    İki faktörlü doğrulamayı devre dışı bırak
 * @route   POST /api/users/2fa/disable
 * @access  Private
 */
const disableTwoFactorAuth = asyncHandler(async (req, res, next) => {
  const { token, password } = req.body;
  const userId = req.user._id;

  if (!password) {
    return next(new ErrorResponse('Şifre gereklidir', 400));
  }

  // Kullanıcı şifresini doğrula
  const user = await User.findById(userId).select('+password');

  if (!user) {
    return next(new ErrorResponse('Kullanıcı bulunamadı', 404));
  }

  const isPasswordMatch = await user.matchPassword(password);

  if (!isPasswordMatch) {
    return next(new ErrorResponse('Geçersiz şifre', 401));
  }

  // Kullanıcının 2FA bilgisini bul
  const twoFactorAuth = await TwoFactorAuth.findOne({
    user: userId,
    isEnabled: true,
  });

  if (!twoFactorAuth) {
    return next(new ErrorResponse('İki faktörlü doğrulama zaten devre dışı', 400));
  }

  // 2FA kodunu da doğrula (ekstra güvenlik için)
  if (token) {
    const verified = speakeasy.totp.verify({
      secret: twoFactorAuth.secret,
      encoding: 'base32',
      token: token,
      window: 1,
    });

    if (!verified) {
      return next(new ErrorResponse('Geçersiz doğrulama kodu', 400));
    }
  }

  // 2FA'yı devre dışı bırak
  await TwoFactorAuth.findByIdAndDelete(twoFactorAuth._id);

  // Kullanıcı modelini güncelle
  user.isTwoFactorEnabled = false;
  await user.save();

  // Güvenlik log kaydı tut
  await AdminLog.create({
    user: userId,
    action: '2fa_disabled',
    details: 'İki faktörlü doğrulama devre dışı bırakıldı',
    ip: req.ip,
  });

  res.status(200).json({
    success: true,
    message: 'İki faktörlü doğrulama başarıyla devre dışı bırakıldı',
    data: {
      isTwoFactorEnabled: false,
    },
  });
});

/**
 * @desc    Kullanıcının 2FA durumunu kontrol et
 * @route   GET /api/users/2fa/status
 * @access  Private
 */
const getTwoFactorAuthStatus = asyncHandler(async (req, res, next) => {
  const userId = req.user._id;

  // Kullanıcının 2FA bilgisini bul
  const twoFactorAuth = await TwoFactorAuth.findOne({
    user: userId,
  });

  const status = {
    isEnabled: false,
    enabledAt: null,
    lastUsed: null,
  };

  if (twoFactorAuth && twoFactorAuth.isEnabled) {
    status.isEnabled = true;
    status.enabledAt = twoFactorAuth.enabledAt;
    status.lastUsed = twoFactorAuth.lastUsed;
  }

  res.status(200).json({
    success: true,
    data: status,
  });
});

/**
 * @desc    Yeni yedek kodlar oluştur
 * @route   POST /api/users/2fa/backup-codes/regenerate
 * @access  Private
 */
const regenerateBackupCodes = asyncHandler(async (req, res, next) => {
  const { token, password } = req.body;
  const userId = req.user._id;

  if (!password) {
    return next(new ErrorResponse('Şifre gereklidir', 400));
  }

  // Kullanıcı şifresini doğrula
  const user = await User.findById(userId).select('+password');

  if (!user) {
    return next(new ErrorResponse('Kullanıcı bulunamadı', 404));
  }

  const isPasswordMatch = await user.matchPassword(password);

  if (!isPasswordMatch) {
    return next(new ErrorResponse('Geçersiz şifre', 401));
  }

  // Kullanıcının 2FA bilgisini bul
  const twoFactorAuth = await TwoFactorAuth.findOne({
    user: userId,
    isEnabled: true,
  });

  if (!twoFactorAuth) {
    return next(new ErrorResponse('İki faktörlü doğrulama etkin değil', 400));
  }

  // 2FA kodunu da doğrula (ekstra güvenlik için)
  if (token) {
    const verified = speakeasy.totp.verify({
      secret: twoFactorAuth.secret,
      encoding: 'base32',
      token: token,
      window: 1,
    });

    if (!verified) {
      return next(new ErrorResponse('Geçersiz doğrulama kodu', 400));
    }
  }

  // Yeni yedek kodlar oluştur
  twoFactorAuth.backupCodes = Array(10)
    .fill()
    .map(() => ({
      code: crypto.randomBytes(4).toString('hex'),
      isUsed: false,
    }));

  twoFactorAuth.updatedAt = Date.now();
  await twoFactorAuth.save();

  // Güvenlik log kaydı tut
  await AdminLog.create({
    user: userId,
    action: '2fa_backup_codes_regenerated',
    details: 'Yedek kodlar yeniden oluşturuldu',
    ip: req.ip,
  });

  // Yedek kodları döndür
  const backupCodes = twoFactorAuth.backupCodes.map((item) => item.code);

  res.status(200).json({
    success: true,
    message: 'Yedek kodlar başarıyla yeniden oluşturuldu',
    data: {
      backupCodes,
    },
  });
});

/**
 * @desc    Yedek kodları getir
 * @route   GET /api/users/2fa/backup-codes
 * @access  Private
 */
const getBackupCodes = asyncHandler(async (req, res, next) => {
  const userId = req.user._id;

  // Kullanıcının 2FA bilgisini bul
  const twoFactorAuth = await TwoFactorAuth.findOne({
    user: userId,
    isEnabled: true,
  });

  if (!twoFactorAuth) {
    return next(new ErrorResponse('İki faktörlü doğrulama etkin değil', 400));
  }

  // Yedek kodları filtrele ve sadece kullanılmamış olanları döndür
  const unusedBackupCodes = twoFactorAuth.backupCodes
    .filter((item) => !item.isUsed)
    .map((item) => item.code);

  // Kullanılmış yedek kod sayısını hesapla
  const usedBackupCodesCount = twoFactorAuth.backupCodes.filter((item) => item.isUsed).length;

  res.status(200).json({
    success: true,
    data: {
      backupCodes: unusedBackupCodes,
      usedCount: usedBackupCodesCount,
      totalCount: twoFactorAuth.backupCodes.length,
    },
  });
});

/**
 * @desc    Recovery URL ile 2FA sıfırlama (Admin için)
 * @route   POST /api/admin/users/:userId/2fa/reset
 * @access  Admin
 */
const resetUserTwoFactorAuth = asyncHandler(async (req, res, next) => {
  const { userId } = req.params;

  // Admin kontrolü middleware tarafından yapılıyor olmalı

  // Kullanıcıyı kontrol et
  const user = await User.findById(userId);

  if (!user) {
    return next(new ErrorResponse('Kullanıcı bulunamadı', 404));
  }

  // 2FA'yı kaldır
  await TwoFactorAuth.findOneAndDelete({ user: userId });

  // Kullanıcı modelini güncelle
  user.isTwoFactorEnabled = false;
  await user.save();

  // Admin log kaydı tut
  await AdminLog.create({
    user: req.user._id,
    targetUser: userId,
    action: 'admin_reset_2fa',
    details: `Kullanıcı ${user.username} için 2FA sıfırlandı`,
    ip: req.ip,
  });

  res.status(200).json({
    success: true,
    message: `Kullanıcı ${user.username} için iki faktörlü doğrulama sıfırlandı`,
    data: {
      userId,
      username: user.username,
      isTwoFactorEnabled: false,
    },
  });
});

/**
 * @desc    Kullanıcının doğrulama adımına gerek duyup duymadığını kontrol et
 * @route   POST /api/auth/2fa/needed
 * @access  Public (first auth token required)
 */
const checkIfTwoFactorAuthNeeded = asyncHandler(async (req, res, next) => {
  const { userId } = req.body;

  if (!userId) {
    return next(new ErrorResponse('Kullanıcı ID gereklidir', 400));
  }

  // Kullanıcıyı kontrol et
  const user = await User.findById(userId);

  if (!user) {
    return next(new ErrorResponse('Kullanıcı bulunamadı', 404));
  }

  // 2FA durumunu kontrol et
  const twoFactorAuth = await TwoFactorAuth.findOne({
    user: userId,
    isEnabled: true,
  });

  const isTwoFactorEnabled = !!twoFactorAuth;

  res.status(200).json({
    success: true,
    data: {
      isTwoFactorEnabled,
      username: user.username,
    },
  });
});

module.exports = {
  setupTwoFactorAuth,
  verifyAndEnableTwoFactorAuth,
  verifyTwoFactorAuthToken,
  verifyBackupCode,
  disableTwoFactorAuth,
  getTwoFactorAuthStatus,
  regenerateBackupCodes,
  getBackupCodes,
  resetUserTwoFactorAuth,
  checkIfTwoFactorAuthNeeded,
};
