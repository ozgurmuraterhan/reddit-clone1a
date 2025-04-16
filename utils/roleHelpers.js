const mongoose = require('mongoose');
const User = require('../models/User');

/**
 * Kullanıcının bir subreddit'te moderatör olup olmadığını kontrol eder
 * @param {String} userId - Kullanıcı ID
 * @param {String} subredditId - Subreddit ID
 * @returns {Promise<Boolean>} - Kullanıcı moderatör ise true
 */
const isModeratorOf = async (userId, subredditId) => {
  if (!userId || !subredditId) return false;

  // UserRoleAssignment üzerinden kontrol
  const roleAssignment = await mongoose.model('UserRoleAssignment').findOne({
    user: userId,
    entityType: 'subreddit',
    entity: subredditId,
    role: { $in: await getModeratorRoleIds() },
  });

  if (roleAssignment) return true;

  // Site admin kontrolü
  const user = await User.findById(userId);
  return user && user.role === 'admin';
};

/**
 * Moderatör rollerinin ID'lerini döndürür
 * @returns {Promise<Array>} - Moderatör rol ID'leri
 */
const getModeratorRoleIds = async () => {
  const moderatorRoles = await mongoose.model('Role').find({
    scope: 'subreddit',
    name: { $in: ['moderator', 'admin'] },
  });

  return moderatorRoles.map((role) => role._id);
};

/**
 * Kullanıcının belirli bir subreddit'te belirli bir role sahip olup olmadığını kontrol eder
 * @param {String} userId - Kullanıcı ID
 * @param {String} subredditId - Subreddit ID
 * @param {String|Array} roleName - Kontrol edilecek rol veya roller
 * @returns {Promise<Boolean>} - Kullanıcı belirtilen role sahipse true
 */
const hasRoleInSubreddit = async (userId, subredditId, roleName) => {
  if (!userId || !subredditId) return false;

  const roleNames = Array.isArray(roleName) ? roleName : [roleName];

  // Rol ID'lerini bul
  const roles = await mongoose.model('Role').find({
    scope: 'subreddit',
    name: { $in: roleNames },
  });

  const roleIds = roles.map((role) => role._id);

  // Rol atamasını kontrol et
  const roleAssignment = await mongoose.model('UserRoleAssignment').findOne({
    user: userId,
    entityType: 'subreddit',
    entity: subredditId,
    role: { $in: roleIds },
  });

  return !!roleAssignment;
};

/**
 * Kullanıcının site admin olup olmadığını kontrol eder
 * @param {String} userId - Kullanıcı ID
 * @returns {Promise<Boolean>} - Kullanıcı site admin ise true
 */
const isSiteAdmin = async (userId) => {
  if (!userId) return false;

  const user = await User.findById(userId);
  return user && user.role === 'admin';
};

module.exports = {
  isModeratorOf,
  hasRoleInSubreddit,
  isSiteAdmin,
  getModeratorRoleIds,
};
