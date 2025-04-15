const { Role, Permission, UserRoleAssignment } = require('../models');

/**
 * Kullanıcının rollerini getir
 * @param {string} userId - Kullanıcı ID'si
 * @param {string} subredditId - Subreddit ID'si (opsiyonel)
 * @returns {Promise<Array>} - Roller dizisi
 */
const getUserRoles = async (userId, subredditId = null) => {
  try {
    const query = { user: userId };

    if (subredditId) {
      // Subreddit belirtilmişse sadece o subreddit'e ait rolleri getir
      query.subreddit = subredditId;
    }

    const roleAssignments = await UserRoleAssignment.find(query)
      .populate('role')
      .lean();

    // Süre dolmuş rolleri filtrele
    const validRoleAssignments = roleAssignments.filter(assignment => {
      return !assignment.expiresAt || new Date(assignment.expiresAt) > new Date();
    });

    return validRoleAssignments.map(assignment => assignment.role);
  } catch (error) {
    console.error('Error in getUserRoles:', error);
    return [];
  }
};

/**
 * Kullanıcının izinlerini getir
 * @param {string} userId - Kullanıcı ID'si
 * @param {string} subredditId - Subreddit ID'si (opsiyonel)
 * @returns {Promise<Array>} - İzinler dizisi
 */
const getUserPermissions = async (userId, subredditId = null) => {
  try {
    const roles = await getUserRoles(userId, subredditId);

    // Tüm rollerin ID'lerini topla
    const roleIds = roles.map(role => role._id);

    // Rollere ait tüm izinleri getir
    const populatedRoles = await Role.find({ _id: { $in: roleIds } })
      .populate('permissions')
      .lean();

    // Tüm izinleri düzleştir ve benzersiz yap
    const allPermissions = populatedRoles.reduce((permissions, role) => {
      return [...permissions, ...(role.permissions || [])];
    }, []);

    // Benzersiz izinleri döndür (id bazında)
    return Array.from(new Map(allPermissions.map(perm => [perm._id.toString(), perm])).values());
  } catch (error) {
    console.error('Error in getUserPermissions:', error);
    return [];
  }
};

/**
 * Kullanıcının belirli bir role sahip olup olmadığını kontrol et
 * @param {string} userId - Kullanıcı ID'si
 * @param {string|Array} roleNames - Rol adı veya adları
 * @param {string} subredditId - Subreddit ID'si (opsiyonel)
 * @returns {Promise<boolean>} - Kullanıcının rolü var mı
 */
const userHasRole = async (userId, roleNames, subredditId = null) => {
  try {
    const roles = await getUserRoles(userId, subredditId);

    // Tekil rol adını diziye çevir
    const rolesToCheck = Array.isArray(roleNames) ? roleNames : [roleNames];

    // Kullanıcının rollerinden herhangi biri istenen rollerden birine eşleşiyor mu?
    return roles.some(role => rolesToCheck.includes(role.name));
  } catch (error) {
    console.error('Error in userHasRole:', error);
    return false;
  }
};

/**
 * Kullanıcının belirli bir izne sahip olup olmadığını kontrol et
 * @param {string} userId - Kullanıcı ID'si
 * @param {string|Array} permissionNames - İzin adı veya adları
 * @param {string} subredditId - Subreddit ID'si (opsiyonel)
 * @returns {Promise<boolean>} - Kullanıcının izni var mı
 */
const userHasPermission = async (userId, permissionNames, subredditId = null) => {
  try {
    const permissions = await getUserPermissions(userId, subredditId);

    // Tekil izin adını diziye çevir
    const permissionsToCheck = Array.isArray(permissionNames) ? permissionNames : [permissionNames];

    // Kullanıcının izinlerinden herhangi biri istenen izinlerden birine eşleşiyor mu?
    return permissions.some(permission => permissionsToCheck.includes(permission.name));
  } catch (error) {
    console.error('Error in userHasPermission:', error);
    return false;
  }
};

module.exports = {
  getUserRoles,
  getUserPermissions,
  userHasRole,
  userHasPermission
};
