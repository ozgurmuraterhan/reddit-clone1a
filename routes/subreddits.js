const express = require('express');
const {
  isAuthenticated,
  hasPermission,
  isModeratorOf,
  rateLimit
} = require('../middleware/auth');
const subredditController = require('../controllers/subredditController');

const router = express.Router();

// Rate limiting
const createSubredditLimit = rateLimit('/api/subreddits/create', 5, 24 * 60 * 60 * 1000); // 5 subreddit/gün

// Subreddit listesi
router.get('/', subredditController.getSubreddits);

// Subreddit detayı
router.get('/:name', subredditController.getSubredditByName);

// Subreddit oluştur
router.post('/',
  isAuthenticated,
  createSubredditLimit,
  hasPermission('subreddit:create'),
  subredditController.createSubreddit
);

// Subreddit güncelle (moderatör)
router.put('/:name',
  isAuthenticated,
  isModeratorOf('subreddit', 'name'),
  subredditController.updateSubreddit
);

// Subreddit kural listesi
router.get('/:name/rules', subredditController.getSubredditRules);

// Subreddit kural ekle (moderatör)
router.post('/:name/rules',
  isAuthenticated,
  isModeratorOf('subreddit', 'name'),
  subredditController.addSubredditRule
);

// Subreddit kural güncelle (moderatör)
router.put('/:name/rules/:ruleId',
  isAuthenticated,
  isModeratorOf('subreddit', 'name'),
  subredditController.updateSubredditRule
);

// Subreddit kural sil (moderatör)
router.delete('/:name/rules/:ruleId',
  isAuthenticated,
  isModeratorOf('subreddit', 'name'),
  subredditController.deleteSubredditRule
);

// Subreddit gönderileri
router.get('/:name/posts', subredditController.getSubredditPosts);

// Subreddit'e katıl
router.post('/:name/join',
  isAuthenticated,
  subredditController.joinSubreddit
);

// Subreddit'ten ayrıl
router.post('/:name/leave',
  isAuthenticated,
  subredditController.leaveSubreddit
);

// Subreddit moderatör listesi
router.get('/:name/moderators', subredditController.getSubredditModerators);

// Subreddit moderatör ekle (mod required)
router.post('/:name/moderators',
  isAuthenticated,
  isModeratorOf('subreddit', 'name'),
  subredditController.addModerator
);

// Subreddit moderatör sil (mod required)
router.delete('/:name/moderators/:userId',
  isAuthenticated,
  isModeratorOf('subreddit', 'name'),
  subredditController.removeModerator
);

// Subreddit flair listesi
router.get('/:name/flairs', subredditController.getSubredditFlairs);

// Subreddit flair ekle (moderatör)
router.post('/:name/flairs',
  isAuthenticated,
  isModeratorOf('subreddit', 'name'),
  subredditController.addFlair
);

// Subreddit flair güncelle (moderatör)
router.put('/:name/flairs/:flairId',
  isAuthenticated,
  isModeratorOf('subreddit', 'name'),
  subredditController.updateFlair
);

// Subreddit flair sil (moderatör)
router.delete('/:name/flairs/:flairId',
  isAuthenticated,
  isModeratorOf('subreddit', 'name'),
  subredditController.deleteFlair
);

// Subreddit ayarlarını getir (moderatör)
router.get('/:name/settings',
  isAuthenticated,
  isModeratorOf('subreddit', 'name'),
  subredditController.getSubredditSettings
);

// Subreddit ayarlarını güncelle (moderatör)
router.put('/:name/settings',
  isAuthenticated,
  isModeratorOf('subreddit', 'name'),
  subredditController.updateSubredditSettings
);

module.exports = router;
