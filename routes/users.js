const express = require('express');
const {
  isAuthenticated,
  hasPermission,
  hasRole,
  isAdmin
} = require('../middleware/auth');
const userController = require('../controllers/userController');

const router = express.Router();

// Tüm kullanıcıları getir (sadece admin)
router.get('/',
  isAuthenticated,
  isAdmin,
  userController.getUsers
);

// Kullanıcı profili getir
router.get('/:username', userController.getUserProfile);

// Giriş yapmış kullanıcının kendi profilini güncelleme
router.put('/me',
  isAuthenticated,
  userController.updateProfile
);

// Admin: Kullanıcıyı güncelleme
router.put('/:userId',
  isAuthenticated,
  isAdmin,
  userController.updateUser
);

// Admin: Kullanıcıyı silme/deaktif etme
router.delete('/:userId',
  isAuthenticated,
  isAdmin,
  userController.deleteUser
);

// Kullanıcı gönderilerini getir
router.get('/:username/posts', userController.getUserPosts);

// Kullanıcı yorumlarını getir
router.get('/:username/comments', userController.getUserComments);

// Kullanıcıyı takip et
router.post('/:username/follow',
  isAuthenticated,
  userController.followUser
);

// Kullanıcı takibini bırak
router.delete('/:username/follow',
  isAuthenticated,
  userController.unfollowUser
);

// Kullanıcı ayarlarını getir
router.get('/me/settings',
  isAuthenticated,
  userController.getUserSettings
);

// Kullanıcı ayarlarını güncelle
router.put('/me/settings',
  isAuthenticated,
  userController.updateUserSettings
);

module.exports = router;
