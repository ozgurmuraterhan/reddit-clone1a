const { Permission, User, Role, Subreddit, SubredditMembership, ModLog } = require('../models');
const mongoose = require('mongoose');

/**
 * @desc    İzin bilgilerini getir
 * @route   GET /api/permissions/:permissionId
 * @access  Private/Admin
 */
const getPermissionById = async (req, res) => {
  try {
    const { permissionId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(permissionId)) {
      return res.status(400).json({
        success: false,
        message: 'Geçersiz izin ID formatı',
      });
    }

    // Yetki kontrolü
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Bu bilgilere erişmek için admin yetkileri gerekiyor',
      });
    }

    const permission = await Permission.findById(permissionId);

    if (!permission) {
      return res.status(404).json({
        success: false,
        message: 'İzin bulunamadı',
      });
    }

    res.status(200).json({
      success: true,
      data: permission,
    });
  } catch (error) {
    console.error('Get permission error:', error);
    res.status(500).json({
      success: false,
      message: 'İzin bilgisi getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * @desc    Tüm izinleri getir
 * @route   GET /api/permissions
 * @access  Private/Admin
 */
const getAllPermissions = async (req, res) => {
  try {
    // Yetki kontrolü
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Bu bilgilere erişmek için admin yetkileri gerekiyor',
      });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip = (page - 1) * limit;
    const search = req.query.search || '';
    const type = req.query.type;
    const scope = req.query.scope;

    // Filtre oluştur
    let filter = {};

    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
      ];
    }

    if (type) {
      filter.type = type;
    }

    if (scope) {
      filter.scope = scope;
    }

    // İzinleri getir
    const permissions = await Permission.find(filter)
      .sort({ scope: 1, type: 1, name: 1 })
      .skip(skip)
      .limit(limit);

    const totalPermissions = await Permission.countDocuments(filter);

    res.status(200).json({
      success: true,
      count: permissions.length,
      total: totalPermissions,
      totalPages: Math.ceil(totalPermissions / limit),
      currentPage: page,
      data: permissions,
    });
  } catch (error) {
    console.error('Get all permissions error:', error);
    res.status(500).json({
      success: false,
      message: 'İzinler getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * @desc    Yeni izin oluştur
 * @route   POST /api/permissions
 * @access  Private/Admin
 */
const createPermission = async (req, res) => {
  try {
    // Yetki kontrolü
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Bu işlem için admin yetkileri gerekiyor',
      });
    }

    const { name, description, type, scope, resource, action, defaultRoles, subreddit } = req.body;

    // Eksik alan kontrolü
    if (!name || !type || !scope || !action) {
      return res.status(400).json({
        success: false,
        message: 'Lütfen gerekli tüm alanları doldurun: name, type, scope, action',
      });
    }

    // Subreddit izni için subreddit ID kontrolü
    if (scope === 'subreddit' && !subreddit) {
      return res.status(400).json({
        success: false,
        message: 'Subreddit kapsamlı izinler için subreddit ID gereklidir',
      });
    }

    if (subreddit && !mongoose.Types.ObjectId.isValid(subreddit)) {
      return res.status(400).json({
        success: false,
        message: 'Geçersiz subreddit ID formatı',
      });
    }

    // Aynı isimde izin var mı kontrol et
    const existingPermission = await Permission.findOne({
      name,
      scope,
      subreddit: scope === 'subreddit' ? subreddit : null,
    });

    if (existingPermission) {
      return res.status(400).json({
        success: false,
        message: 'Bu isimde ve kapsamda bir izin zaten mevcut',
      });
    }

    // İzni oluştur
    const permission = await Permission.create({
      name,
      description,
      type,
      scope,
      resource,
      action,
      defaultRoles: defaultRoles || [],
      subreddit: scope === 'subreddit' ? subreddit : null,
      createdBy: req.user._id,
    });

    // Eğer default roller belirtilmişse, bu izni rollere ekle
    if (defaultRoles && defaultRoles.length > 0) {
      await Role.updateMany(
        { name: { $in: defaultRoles } },
        { $addToSet: { permissions: permission._id } },
      );
    }

    res.status(201).json({
      success: true,
      message: 'İzin başarıyla oluşturuldu',
      data: permission,
    });
  } catch (error) {
    console.error('Create permission error:', error);
    res.status(500).json({
      success: false,
      message: 'İzin oluşturulurken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * @desc    İzni güncelle
 * @route   PUT /api/permissions/:permissionId
 * @access  Private/Admin
 */
const updatePermission = async (req, res) => {
  try {
    const { permissionId } = req.params;

    // Yetki kontrolü
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Bu işlem için admin yetkileri gerekiyor',
      });
    }

    if (!mongoose.Types.ObjectId.isValid(permissionId)) {
      return res.status(400).json({
        success: false,
        message: 'Geçersiz izin ID formatı',
      });
    }

    const { name, description, type, scope, resource, action, defaultRoles, subreddit, isActive } =
      req.body;

    // İzni bul
    const permission = await Permission.findById(permissionId);

    if (!permission) {
      return res.status(404).json({
        success: false,
        message: 'İzin bulunamadı',
      });
    }

    // Aynı isimde başka izin var mı kontrol et (güncellenen izin hariç)
    if (name && name !== permission.name) {
      const existingPermission = await Permission.findOne({
        name,
        scope: scope || permission.scope,
        subreddit: scope === 'subreddit' ? subreddit || permission.subreddit : null,
        _id: { $ne: permissionId },
      });

      if (existingPermission) {
        return res.status(400).json({
          success: false,
          message: 'Bu isimde ve kapsamda bir izin zaten mevcut',
        });
      }
    }

    // Mevcut default rolleri sakla
    const previousDefaultRoles = [...permission.defaultRoles];

    // İzni güncelle
    const updateFields = {};

    if (name) updateFields.name = name;
    if (description !== undefined) updateFields.description = description;
    if (type) updateFields.type = type;
    if (scope) updateFields.scope = scope;
    if (resource) updateFields.resource = resource;
    if (action) updateFields.action = action;
    if (defaultRoles) updateFields.defaultRoles = defaultRoles;
    if (scope === 'subreddit' && subreddit) updateFields.subreddit = subreddit;
    if (isActive !== undefined) updateFields.isActive = isActive;

    const updatedPermission = await Permission.findByIdAndUpdate(permissionId, updateFields, {
      new: true,
      runValidators: true,
    });

    // Default roller değiştiyse, rolleri güncelle
    if (defaultRoles && JSON.stringify(defaultRoles) !== JSON.stringify(previousDefaultRoles)) {
      // Eski rollerden izni kaldır (yeni listede olmayanlar)
      const rolesToRemove = previousDefaultRoles.filter((role) => !defaultRoles.includes(role));

      if (rolesToRemove.length > 0) {
        await Role.updateMany(
          { name: { $in: rolesToRemove } },
          { $pull: { permissions: permissionId } },
        );
      }

      // Yeni rollere izni ekle (eski listede olmayanlar)
      const rolesToAdd = defaultRoles.filter((role) => !previousDefaultRoles.includes(role));

      if (rolesToAdd.length > 0) {
        await Role.updateMany(
          { name: { $in: rolesToAdd } },
          { $addToSet: { permissions: permissionId } },
        );
      }
    }

    res.status(200).json({
      success: true,
      message: 'İzin başarıyla güncellendi',
      data: updatedPermission,
    });
  } catch (error) {
    console.error('Update permission error:', error);
    res.status(500).json({
      success: false,
      message: 'İzin güncellenirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * @desc    İzni sil
 * @route   DELETE /api/permissions/:permissionId
 * @access  Private/Admin
 */
const deletePermission = async (req, res) => {
  try {
    const { permissionId } = req.params;

    // Yetki kontrolü
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Bu işlem için admin yetkileri gerekiyor',
      });
    }

    if (!mongoose.Types.ObjectId.isValid(permissionId)) {
      return res.status(400).json({
        success: false,
        message: 'Geçersiz izin ID formatı',
      });
    }

    // İzni bul
    const permission = await Permission.findById(permissionId);

    if (!permission) {
      return res.status(404).json({
        success: false,
        message: 'İzin bulunamadı',
      });
    }

    // İzni rollerde kullanan var mı kontrol et
    const rolesUsingPermission = await Role.find({ permissions: permissionId });

    if (rolesUsingPermission.length > 0) {
      // İzni rollerden kaldır
      await Role.updateMany(
        { permissions: permissionId },
        { $pull: { permissions: permissionId } },
      );
    }

    // İzni sil
    await Permission.findByIdAndDelete(permissionId);

    res.status(200).json({
      success: true,
      message: 'İzin başarıyla silindi',
    });
  } catch (error) {
    console.error('Delete permission error:', error);
    res.status(500).json({
      success: false,
      message: 'İzin silinirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * @desc    Kullanıcının izinlerini kontrol et
 * @route   GET /api/permissions/check
 * @access  Private
 */
const checkUserPermissions = async (req, res) => {
  try {
    const { resource, action, subredditId } = req.query;
    const userId = req.user._id;

    if (!resource || !action) {
      return res.status(400).json({
        success: false,
        message: 'Kaynak (resource) ve eylem (action) parametreleri gereklidir',
      });
    }

    // Site-çapındaki izinleri kontrol et (rol-bazlı)
    const user = await User.findById(userId).populate('role');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Kullanıcı bulunamadı',
      });
    }

    // Admin rolü her şeye izin verir
    if (user.role && user.role.name === 'admin') {
      return res.status(200).json({
        success: true,
        hasPermission: true,
        message: 'Admin kullanıcısı tüm izinlere sahiptir',
      });
    }

    // Site-çapındaki izinleri kontrol et
    let hasPermission = false;

    if (user.role && user.role.permissions && user.role.permissions.length > 0) {
      // Rol ile ilişkilendirilmiş izinleri getir
      const rolePermissions = await Permission.find({
        _id: { $in: user.role.permissions },
        resource,
        action,
        scope: 'site',
        isActive: true,
      });

      if (rolePermissions.length > 0) {
        hasPermission = true;
      }
    }

    // Subreddit izinlerini kontrol et (eğer subredditId verilmişse)
    if (subredditId && !hasPermission) {
      if (!mongoose.Types.ObjectId.isValid(subredditId)) {
        return res.status(400).json({
          success: false,
          message: 'Geçersiz subreddit ID formatı',
        });
      }

      // Kullanıcının subreddit üyeliğini kontrol et
      const membership = await SubredditMembership.findOne({
        user: userId,
        subreddit: subredditId,
      });

      if (membership) {
        // Moderatör mü?
        if (membership.isModerator) {
          // Subreddit yöneticileri için genellikle özel izinler vardır
          const modPermissions = await Permission.find({
            resource,
            action,
            scope: 'subreddit',
            subreddit: subredditId,
            defaultRoles: 'moderator',
            isActive: true,
          });

          if (modPermissions.length > 0) {
            hasPermission = true;
          }
        }

        // Kullanıcıya özel verilmiş subreddit izinleri var mı?
        if (!hasPermission && membership.permissions && membership.permissions.length > 0) {
          const specificPermissions = await Permission.find({
            _id: { $in: membership.permissions },
            resource,
            action,
            scope: 'subreddit',
            subreddit: subredditId,
            isActive: true,
          });

          if (specificPermissions.length > 0) {
            hasPermission = true;
          }
        }

        // Subreddit üyeleri için varsayılan izinler
        if (!hasPermission) {
          const memberPermissions = await Permission.find({
            resource,
            action,
            scope: 'subreddit',
            subreddit: subredditId,
            defaultRoles: 'member',
            isActive: true,
          });

          if (memberPermissions.length > 0) {
            hasPermission = true;
          }
        }
      } else {
        // Üye olmayan ziyaretçiler için varsayılan izinler
        const visitorPermissions = await Permission.find({
          resource,
          action,
          scope: 'subreddit',
          subreddit: subredditId,
          defaultRoles: 'visitor',
          isActive: true,
        });

        if (visitorPermissions.length > 0) {
          hasPermission = true;
        }
      }
    }

    res.status(200).json({
      success: true,
      hasPermission,
      resource,
      action,
      subreddit: subredditId || null,
    });
  } catch (error) {
    console.error('Check user permissions error:', error);
    res.status(500).json({
      success: false,
      message: 'İzinler kontrol edilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * @desc    Subreddit için izinleri getir
 * @route   GET /api/subreddits/:subredditId/permissions
 * @access  Private/Moderator
 */
const getSubredditPermissions = async (req, res) => {
  try {
    const { subredditId } = req.params;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(subredditId)) {
      return res.status(400).json({
        success: false,
        message: 'Geçersiz subreddit ID formatı',
      });
    }

    // Subreddit'i kontrol et
    const subreddit = await Subreddit.findById(subredditId);
    if (!subreddit) {
      return res.status(404).json({
        success: false,
        message: 'Subreddit bulunamadı',
      });
    }

    // Yetki kontrolü (admin veya moderatör olmalı)
    if (req.user.role !== 'admin') {
      const membership = await SubredditMembership.findOne({
        user: userId,
        subreddit: subredditId,
        isModerator: true,
      });

      if (!membership) {
        return res.status(403).json({
          success: false,
          message: 'Bu bilgilere erişmek için moderatör yetkileri gerekiyor',
        });
      }
    }

    // Subreddit izinlerini getir
    const permissions = await Permission.find({
      scope: 'subreddit',
      subreddit: subredditId,
    }).sort({ type: 1, resource: 1, action: 1 });

    // İzinleri rollere göre grupla
    const groupedPermissions = {
      moderator: permissions.filter((p) => p.defaultRoles.includes('moderator')),
      member: permissions.filter((p) => p.defaultRoles.includes('member')),
      visitor: permissions.filter((p) => p.defaultRoles.includes('visitor')),
      other: permissions.filter(
        (p) =>
          !p.defaultRoles.includes('moderator') &&
          !p.defaultRoles.includes('member') &&
          !p.defaultRoles.includes('visitor'),
      ),
    };

    res.status(200).json({
      success: true,
      count: permissions.length,
      data: {
        all: permissions,
        grouped: groupedPermissions,
      },
    });
  } catch (error) {
    console.error('Get subreddit permissions error:', error);
    res.status(500).json({
      success: false,
      message: 'Subreddit izinleri getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * @desc    Subreddit için izin oluştur veya güncelle
 * @route   POST /api/subreddits/:subredditId/permissions
 * @access  Private/Moderator
 */
const manageSubredditPermission = async (req, res) => {
  try {
    const { subredditId } = req.params;
    const userId = req.user._id;
    const { name, description, resource, action, defaultRoles, isActive } = req.body;

    if (!mongoose.Types.ObjectId.isValid(subredditId)) {
      return res.status(400).json({
        success: false,
        message: 'Geçersiz subreddit ID formatı',
      });
    }

    // Eksik alan kontrolü
    if (!name || !resource || !action || !defaultRoles) {
      return res.status(400).json({
        success: false,
        message: 'Lütfen gerekli tüm alanları doldurun: name, resource, action, defaultRoles',
      });
    }

    // Subreddit'i kontrol et
    const subreddit = await Subreddit.findById(subredditId);
    if (!subreddit) {
      return res.status(404).json({
        success: false,
        message: 'Subreddit bulunamadı',
      });
    }

    // Yetki kontrolü (admin veya kurucu moderatör olmalı)
    if (req.user.role !== 'admin') {
      const membership = await SubredditMembership.findOne({
        user: userId,
        subreddit: subredditId,
        isModerator: true,
      });

      if (!membership || !membership.isFounder) {
        return res.status(403).json({
          success: false,
          message: 'Bu işlem için kurucu moderatör yetkileri gerekiyor',
        });
      }
    }

    // Aynı isimde izin var mı kontrol et (varsa güncelle, yoksa oluştur)
    let permission = await Permission.findOne({
      name,
      scope: 'subreddit',
      subreddit: subredditId,
    });

    if (permission) {
      // İzni güncelle
      permission.description = description || permission.description;
      permission.resource = resource;
      permission.action = action;
      permission.defaultRoles = defaultRoles;
      permission.isActive = isActive !== undefined ? isActive : permission.isActive;
      permission.updatedAt = Date.now();
      permission.updatedBy = userId;

      await permission.save();

      // Moderasyon kaydı oluştur
      await ModLog.create({
        subreddit: subredditId,
        action: 'permission_updated',
        targetType: 'permission',
        targetId: permission._id,
        moderator: userId,
        details: `İzin güncellendi: ${name} (${resource}.${action})`,
      });

      res.status(200).json({
        success: true,
        message: 'İzin başarıyla güncellendi',
        data: permission,
      });
    } else {
      // Yeni izin oluştur
      permission = await Permission.create({
        name,
        description,
        type: 'custom', // Subreddit izinleri özel olarak işaretlenebilir
        scope: 'subreddit',
        subreddit: subredditId,
        resource,
        action,
        defaultRoles,
        isActive: isActive !== undefined ? isActive : true,
        createdBy: userId,
      });

      // Moderasyon kaydı oluştur
      await ModLog.create({
        subreddit: subredditId,
        action: 'permission_created',
        targetType: 'permission',
        targetId: permission._id,
        moderator: userId,
        details: `İzin oluşturuldu: ${name} (${resource}.${action})`,
      });

      res.status(201).json({
        success: true,
        message: 'İzin başarıyla oluşturuldu',
        data: permission,
      });
    }
  } catch (error) {
    console.error('Manage subreddit permission error:', error);
    res.status(500).json({
      success: false,
      message: 'Subreddit izni yönetilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * @desc    Kullanıcıya özel izin atama
 * @route   POST /api/users/:userId/permissions
 * @access  Private/Admin
 */
const assignUserPermission = async (req, res) => {
  try {
    const { userId } = req.params;
    const { permissionId, subredditId, granted } = req.body;

    // Yetki kontrolü
    if (req.user.role !== 'admin') {
      // Subreddit izni ise moderatör kontrolü yap
      if (subredditId) {
        const membership = await SubredditMembership.findOne({
          user: req.user._id,
          subreddit: subredditId,
          isModerator: true,
        });

        if (!membership) {
          return res.status(403).json({
            success: false,
            message: 'Bu işlem için moderatör yetkileri gerekiyor',
          });
        }
      } else {
        return res.status(403).json({
          success: false,
          message: 'Bu işlem için admin yetkileri gerekiyor',
        });
      }
    }

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: 'Geçersiz kullanıcı ID formatı',
      });
    }

    if (!mongoose.Types.ObjectId.isValid(permissionId)) {
      return res.status(400).json({
        success: false,
        message: 'Geçersiz izin ID formatı',
      });
    }

    // Kullanıcıyı ve izni kontrol et
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Kullanıcı bulunamadı',
      });
    }

    const permission = await Permission.findById(permissionId);
    if (!permission) {
      return res.status(404).json({
        success: false,
        message: 'İzin bulunamadı',
      });
    }

    // Subreddit izni ise, subreddit üyeliğini bulup güncelle
    if (permission.scope === 'subreddit' && permission.subreddit) {
      // Subreddit ID kontrol et
      if (!subredditId || !permission.subreddit.equals(subredditId)) {
        return res.status(400).json({
          success: false,
          message: 'İzin ve subreddit eşleşmiyor',
        });
      }

      let membership = await SubredditMembership.findOne({
        user: userId,
        subreddit: subredditId,
      });

      if (!membership) {
        // Eğer üye değilse ve izin veriliyorsa, üyelik oluştur
        if (granted) {
          membership = await SubredditMembership.create({
            user: userId,
            subreddit: subredditId,
            permissions: [permissionId],
            joinedAt: Date.now(),
          });

          // Moderasyon kaydı oluştur
          await ModLog.create({
            subreddit: subredditId,
            action: 'user_added_with_permission',
            targetType: 'user',
            targetId: userId,
            moderator: req.user._id,
            details: `Kullanıcı ${user.username} subreddit'e eklendi ve özel izin verildi: ${permission.name}`,
          });
        } else {
          return res.status(404).json({
            success: false,
            message: "Kullanıcı bu subreddit'e üye değil",
          });
        }
      } else {
        // Üyelik varsa, izinleri güncelle
        if (granted) {
          // İzni ekle
          if (!membership.permissions.includes(permissionId)) {
            membership.permissions.push(permissionId);
            await membership.save();

            // Moderasyon kaydı oluştur
            await ModLog.create({
              subreddit: subredditId,
              action: 'permission_granted',
              targetType: 'user',
              targetId: userId,
              moderator: req.user._id,
              details: `Kullanıcı ${user.username}'a özel izin verildi: ${permission.name}`,
            });
          }
        } else {
          // İzni kaldır
          if (membership.permissions.includes(permissionId)) {
            membership.permissions = membership.permissions.filter(
              (p) => p.toString() !== permissionId.toString(),
            );
            await membership.save();

            // Moderasyon kaydı oluştur
            await ModLog.create({
              subreddit: subredditId,
              action: 'permission_revoked',
              targetType: 'user',
              targetId: userId,
              moderator: req.user._id,
              details: `Kullanıcı ${user.username}'dan özel izin kaldırıldı: ${permission.name}`,
            });
          }
        }
      }
    }
    // Site-çapında özel kullanıcı izni ise user.customPermissions'a ekle/çıkar
    else if (permission.scope === 'site') {
      user.customPermissions = user.customPermissions || [];

      if (granted) {
        // İzni ekle
        if (!user.customPermissions.includes(permissionId)) {
          user.customPermissions.push(permissionId);
          await user.save();
        }
      } else {
        // İzni kaldır
        if (user.customPermissions.includes(permissionId)) {
          user.customPermissions = user.customPermissions.filter(
            (p) => p.toString() !== permissionId.toString(),
          );
          await user.save();
        }
      }
    }

    res.status(200).json({
      success: true,
      message: granted
        ? 'İzin kullanıcıya başarıyla atandı'
        : 'İzin kullanıcıdan başarıyla kaldırıldı',
      data: {
        user: {
          _id: user._id,
          username: user.username,
        },
        permission: {
          _id: permission._id,
          name: permission.name,
          scope: permission.scope,
        },
        granted,
      },
    });
  } catch (error) {
    console.error('Assign user permission error:', error);
    res.status(500).json({
      success: false,
      message: 'Kullanıcıya izin atanırken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * @desc    Rol izinlerini düzenle
 * @route   POST /api/roles/:roleId/permissions
 * @access  Private/Admin
 */
const manageRolePermissions = async (req, res) => {
  try {
    const { roleId } = req.params;
    const { permissionIds, action } = req.body;

    // Yetki kontrolü
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Bu işlem için admin yetkileri gerekiyor',
      });
    }

    if (!mongoose.Types.ObjectId.isValid(roleId)) {
      return res.status(400).json({
        success: false,
        message: 'Geçersiz rol ID formatı',
      });
    }

    if (!permissionIds || !Array.isArray(permissionIds)) {
      return res.status(400).json({
        success: false,
        message: "İzin ID'leri bir dizi olarak belirtilmelidir",
      });
    }

    if (!action || !['add', 'remove', 'set'].includes(action)) {
      return res.status(400).json({
        success: false,
        message: 'Geçerli bir işlem belirtmelisiniz: add, remove, veya set',
      });
    }

    // Geçersiz ID'leri filtrele
    const validPermissionIds = permissionIds.filter((id) => mongoose.Types.ObjectId.isValid(id));

    // Rol ve izinlerin varlığını kontrol et
    const role = await Role.findById(roleId);
    if (!role) {
      return res.status(404).json({
        success: false,
        message: 'Rol bulunamadı',
      });
    }

    // İzinlerin varlığını kontrol et
    const existingPermissions = await Permission.find({
      _id: { $in: validPermissionIds },
    });

    if (existingPermissions.length !== validPermissionIds.length) {
      return res.status(400).json({
        success: false,
        message: 'Bazı izinler bulunamadı',
      });
    }

    // İşlemi gerçekleştir
    let updatedRole;

    if (action === 'add') {
      updatedRole = await Role.findByIdAndUpdate(
        roleId,
        { $addToSet: { permissions: { $each: validPermissionIds } } },
        { new: true },
      );
    } else if (action === 'remove') {
      updatedRole = await Role.findByIdAndUpdate(
        roleId,
        { $pull: { permissions: { $in: validPermissionIds } } },
        { new: true },
      );
    } else if (action === 'set') {
      updatedRole = await Role.findByIdAndUpdate(
        roleId,
        { $set: { permissions: validPermissionIds } },
        { new: true },
      );
    }

    // İzin adlarını getir
    const permissionNames = existingPermissions.map((p) => p.name);

    res.status(200).json({
      success: true,
      message: `Rol izinleri başarıyla ${action === 'add' ? 'eklendi' : action === 'remove' ? 'kaldırıldı' : 'güncellendi'}`,
      data: {
        role: {
          _id: updatedRole._id,
          name: updatedRole.name,
          permissions: updatedRole.permissions,
        },
        affectedPermissions: permissionNames,
      },
    });
  } catch (error) {
    console.error('Manage role permissions error:', error);
    res.status(500).json({
      success: false,
      message: 'Rol izinleri düzenlenirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * @desc    Bir kaynağın erişim kontrollerini getir
 * @route   GET /api/permissions/resource/:resourceType
 * @access  Private/Admin
 */
const getResourcePermissions = async (req, res) => {
  try {
    const { resourceType } = req.params;

    // Yetki kontrolü
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Bu bilgilere erişmek için admin yetkileri gerekiyor',
      });
    }

    // Geçerli kaynak tipi kontrolü
    const validResources = ['post', 'comment', 'subreddit', 'user', 'media', 'message'];
    if (!validResources.includes(resourceType)) {
      return res.status(400).json({
        success: false,
        message: `Geçersiz kaynak tipi. Geçerli tipler: ${validResources.join(', ')}`,
      });
    }

    // Kaynak için izinleri getir
    const permissions = await Permission.find({
      resource: resourceType,
      scope: 'site',
    }).sort({ action: 1 });

    // İzinleri gruplara ayır (rol bazlı)
    const rolePermissionMap = {};

    for (const permission of permissions) {
      if (permission.defaultRoles && permission.defaultRoles.length > 0) {
        for (const roleName of permission.defaultRoles) {
          if (!rolePermissionMap[roleName]) {
            rolePermissionMap[roleName] = [];
          }
          rolePermissionMap[roleName].push({
            _id: permission._id,
            name: permission.name,
            action: permission.action,
            description: permission.description,
          });
        }
      }
    }

    res.status(200).json({
      success: true,
      count: permissions.length,
      data: {
        resource: resourceType,
        permissions,
        rolePermissions: rolePermissionMap,
      },
    });
  } catch (error) {
    console.error('Get resource permissions error:', error);
    res.status(500).json({
      success: false,
      message: 'Kaynak izinleri getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * @desc    Toplu izin yönetimi
 * @route   POST /api/permissions/batch
 * @access  Private/Admin
 */
const batchPermissionOperation = async (req, res) => {
  try {
    const { operation, permissions, defaultRoles, targetRoles, isActive } = req.body;

    // Yetki kontrolü
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Bu işlem için admin yetkileri gerekiyor',
      });
    }

    if (!operation || !['activate', 'deactivate', 'update_roles', 'delete'].includes(operation)) {
      return res.status(400).json({
        success: false,
        message:
          'Geçerli bir işlem belirtmelisiniz: activate, deactivate, update_roles, veya delete',
      });
    }

    if (!permissions || !Array.isArray(permissions) || permissions.length === 0) {
      return res.status(400).json({
        success: false,
        message: "İşlem için en az bir izin ID'si gereklidir",
      });
    }

    // Geçersiz ID'leri filtrele
    const validPermissionIds = permissions.filter((id) => mongoose.Types.ObjectId.isValid(id));

    // İzinleri bul
    const foundPermissions = await Permission.find({
      _id: { $in: validPermissionIds },
    });

    if (foundPermissions.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Belirtilen izinler bulunamadı',
      });
    }

    let result;
    let updatedCount = 0;
    let message = '';

    // İşlemi gerçekleştir
    switch (operation) {
      case 'activate':
        result = await Permission.updateMany(
          { _id: { $in: validPermissionIds } },
          { $set: { isActive: true } },
        );
        updatedCount = result.modifiedCount;
        message = `${updatedCount} izin başarıyla aktifleştirildi`;
        break;

      case 'deactivate':
        result = await Permission.updateMany(
          { _id: { $in: validPermissionIds } },
          { $set: { isActive: false } },
        );
        updatedCount = result.modifiedCount;
        message = `${updatedCount} izin başarıyla deaktifleştirildi`;
        break;

      case 'update_roles':
        if (!defaultRoles || !Array.isArray(defaultRoles)) {
          return res.status(400).json({
            success: false,
            message: 'Varsayılan roller bir dizi olarak belirtilmelidir',
          });
        }

        result = await Permission.updateMany(
          { _id: { $in: validPermissionIds } },
          { $set: { defaultRoles } },
        );
        updatedCount = result.modifiedCount;
        message = `${updatedCount} izin için varsayılan roller güncellendi`;

        // İzinleri rollere ekle/çıkar
        if (targetRoles && Array.isArray(targetRoles) && targetRoles.length > 0) {
          // Önce rolleri bul
          const roles = await Role.find({ name: { $in: targetRoles } });

          if (roles.length > 0) {
            for (const role of roles) {
              await Role.updateOne(
                { _id: role._id },
                { $addToSet: { permissions: { $each: validPermissionIds } } },
              );
            }
            message += ` ve ${roles.length} role atandı`;
          }
        }
        break;

      case 'delete':
        // Önce rollerdeki referansları temizle
        const permissionIdsToDelete = foundPermissions.map((p) => p._id);
        await Role.updateMany(
          { permissions: { $in: permissionIdsToDelete } },
          { $pull: { permissions: { $in: permissionIdsToDelete } } },
        );

        // Sonra izinleri sil
        result = await Permission.deleteMany({ _id: { $in: validPermissionIds } });
        updatedCount = result.deletedCount;
        message = `${updatedCount} izin başarıyla silindi`;
        break;
    }

    res.status(200).json({
      success: true,
      message,
      data: {
        operation,
        affectedCount: updatedCount,
        permissions: foundPermissions.map((p) => ({
          _id: p._id,
          name: p.name,
          scope: p.scope,
          resource: p.resource,
          action: p.action,
        })),
      },
    });
  } catch (error) {
    console.error('Batch permission operation error:', error);
    res.status(500).json({
      success: false,
      message: 'Toplu izin işlemi gerçekleştirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * @desc    Yeni kullanıcılar için varsayılan izinler oluştur
 * @route   POST /api/permissions/defaults
 * @access  Private/Admin
 */
const setupDefaultPermissions = async (req, res) => {
  try {
    // Yetki kontrolü
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Bu işlem için admin yetkileri gerekiyor',
      });
    }

    // Temel rolleri bul
    const adminRole = await Role.findOne({ name: 'admin' });
    const moderatorRole = await Role.findOne({ name: 'moderator' });
    const userRole = await Role.findOne({ name: 'user' });

    if (!adminRole || !moderatorRole || !userRole) {
      return res.status(404).json({
        success: false,
        message: 'Temel roller (admin, moderator, user) bulunamadı. Önce rolleri oluşturun.',
      });
    }

    // Varsayılan izinleri tanımla
    const defaultPermissions = [
      // Post izinleri
      {
        name: 'Gönderi Oluşturma',
        description: 'Kullanıcı yeni gönderi oluşturabilir',
        type: 'core',
        scope: 'site',
        resource: 'post',
        action: 'create',
        defaultRoles: ['user', 'moderator', 'admin'],
      },
      {
        name: 'Gönderi Okuma',
        description: 'Kullanıcı gönderileri görüntüleyebilir',
        type: 'core',
        scope: 'site',
        resource: 'post',
        action: 'read',
        defaultRoles: ['visitor', 'user', 'moderator', 'admin'],
      },
      {
        name: 'Kendi Gönderisini Düzenleme',
        description: 'Kullanıcı kendi gönderilerini düzenleyebilir',
        type: 'core',
        scope: 'site',
        resource: 'post',
        action: 'update_own',
        defaultRoles: ['user', 'moderator', 'admin'],
      },
      {
        name: 'Tüm Gönderileri Düzenleme',
        description: 'Kullanıcı tüm gönderileri düzenleyebilir',
        type: 'core',
        scope: 'site',
        resource: 'post',
        action: 'update_any',
        defaultRoles: ['admin'],
      },
      {
        name: 'Kendi Gönderisini Silme',
        description: 'Kullanıcı kendi gönderilerini silebilir',
        type: 'core',
        scope: 'site',
        resource: 'post',
        action: 'delete_own',
        defaultRoles: ['user', 'moderator', 'admin'],
      },
      {
        name: 'Tüm Gönderileri Silme',
        description: 'Kullanıcı tüm gönderileri silebilir',
        type: 'core',
        scope: 'site',
        resource: 'post',
        action: 'delete_any',
        defaultRoles: ['admin'],
      },

      // Yorum izinleri
      {
        name: 'Yorum Oluşturma',
        description: 'Kullanıcı yorum yapabilir',
        type: 'core',
        scope: 'site',
        resource: 'comment',
        action: 'create',
        defaultRoles: ['user', 'moderator', 'admin'],
      },
      {
        name: 'Yorum Okuma',
        description: 'Kullanıcı yorumları görüntüleyebilir',
        type: 'core',
        scope: 'site',
        resource: 'comment',
        action: 'read',
        defaultRoles: ['visitor', 'user', 'moderator', 'admin'],
      },
      {
        name: 'Kendi Yorumunu Düzenleme',
        description: 'Kullanıcı kendi yorumlarını düzenleyebilir',
        type: 'core',
        scope: 'site',
        resource: 'comment',
        action: 'update_own',
        defaultRoles: ['user', 'moderator', 'admin'],
      },
      {
        name: 'Tüm Yorumları Düzenleme',
        description: 'Kullanıcı tüm yorumları düzenleyebilir',
        type: 'core',
        scope: 'site',
        resource: 'comment',
        action: 'update_any',
        defaultRoles: ['admin'],
      },
      {
        name: 'Kendi Yorumunu Silme',
        description: 'Kullanıcı kendi yorumlarını silebilir',
        type: 'core',
        scope: 'site',
        resource: 'comment',
        action: 'delete_own',
        defaultRoles: ['user', 'moderator', 'admin'],
      },
      {
        name: 'Tüm Yorumları Silme',
        description: 'Kullanıcı tüm yorumları silebilir',
        type: 'core',
        scope: 'site',
        resource: 'comment',
        action: 'delete_any',
        defaultRoles: ['admin'],
      },

      // Subreddit izinleri
      {
        name: 'Subreddit Oluşturma',
        description: 'Kullanıcı yeni subreddit oluşturabilir',
        type: 'core',
        scope: 'site',
        resource: 'subreddit',
        action: 'create',
        defaultRoles: ['user', 'moderator', 'admin'],
      },
      {
        name: 'Subreddit Okuma',
        description: "Kullanıcı subreddit'leri görüntüleyebilir",
        type: 'core',
        scope: 'site',
        resource: 'subreddit',
        action: 'read',
        defaultRoles: ['visitor', 'user', 'moderator', 'admin'],
      },
      {
        name: "Kendi Subreddit'ini Düzenleme",
        description: "Kullanıcı kurduğu subreddit'leri düzenleyebilir",
        type: 'core',
        scope: 'site',
        resource: 'subreddit',
        action: 'update_own',
        defaultRoles: ['user', 'moderator', 'admin'],
      },
      {
        name: "Tüm Subreddit'leri Düzenleme",
        description: "Kullanıcı tüm subreddit'leri düzenleyebilir",
        type: 'core',
        scope: 'site',
        resource: 'subreddit',
        action: 'update_any',
        defaultRoles: ['admin'],
      },

      // Kullanıcı izinleri
      {
        name: 'Kullanıcı Profili Görüntüleme',
        description: 'Kullanıcı profilleri görüntülenebilir',
        type: 'core',
        scope: 'site',
        resource: 'user',
        action: 'read',
        defaultRoles: ['visitor', 'user', 'moderator', 'admin'],
      },
      {
        name: 'Kendi Profilini Düzenleme',
        description: 'Kullanıcı kendi profilini düzenleyebilir',
        type: 'core',
        scope: 'site',
        resource: 'user',
        action: 'update_own',
        defaultRoles: ['user', 'moderator', 'admin'],
      },
      {
        name: 'Tüm Profilleri Düzenleme',
        description: 'Kullanıcı tüm profilleri düzenleyebilir',
        type: 'core',
        scope: 'site',
        resource: 'user',
        action: 'update_any',
        defaultRoles: ['admin'],
      },

      // Medya izinleri
      {
        name: 'Medya Yükleme',
        description: 'Kullanıcı medya yükleyebilir',
        type: 'core',
        scope: 'site',
        resource: 'media',
        action: 'create',
        defaultRoles: ['user', 'moderator', 'admin'],
      },
      {
        name: 'Medya Görüntüleme',
        description: 'Kullanıcı medya görüntüleyebilir',
        type: 'core',
        scope: 'site',
        resource: 'media',
        action: 'read',
        defaultRoles: ['visitor', 'user', 'moderator', 'admin'],
      },
      {
        name: 'Kendi Medyasını Yönetme',
        description: 'Kullanıcı kendi yüklediği medyayı yönetebilir',
        type: 'core',
        scope: 'site',
        resource: 'media',
        action: 'manage_own',
        defaultRoles: ['user', 'moderator', 'admin'],
      },
      {
        name: 'Tüm Medyaları Yönetme',
        description: 'Kullanıcı tüm medyaları yönetebilir',
        type: 'core',
        scope: 'site',
        resource: 'media',
        action: 'manage_any',
        defaultRoles: ['admin'],
      },
    ];

    let createdCount = 0;
    let updatedCount = 0;

    // İzinleri ekle - varsa güncelle, yoksa oluştur
    for (const permDef of defaultPermissions) {
      // Aynı isimde ve kapsamda izin var mı kontrol et
      let permission = await Permission.findOne({
        name: permDef.name,
        scope: permDef.scope,
      });

      if (permission) {
        // İzin varsa güncelle
        permission.description = permDef.description;
        permission.defaultRoles = permDef.defaultRoles;
        permission.type = permDef.type;
        permission.resource = permDef.resource;
        permission.action = permDef.action;
        permission.updatedAt = Date.now();
        permission.updatedBy = req.user._id;

        await permission.save();
        updatedCount++;
      } else {
        // İzin yoksa oluştur
        permission = await Permission.create({
          ...permDef,
          createdBy: req.user._id,
        });
        createdCount++;
      }

      // İzni ilgili rollere ekle
      for (const roleName of permDef.defaultRoles) {
        if (roleName === 'admin') {
          await Role.updateOne(
            { _id: adminRole._id },
            { $addToSet: { permissions: permission._id } },
          );
        } else if (roleName === 'moderator') {
          await Role.updateOne(
            { _id: moderatorRole._id },
            { $addToSet: { permissions: permission._id } },
          );
        } else if (roleName === 'user') {
          await Role.updateOne(
            { _id: userRole._id },
            { $addToSet: { permissions: permission._id } },
          );
        }
      }
    }

    res.status(200).json({
      success: true,
      message: `Varsayılan izinler başarıyla oluşturuldu: ${createdCount} yeni izin, ${updatedCount} güncellenen izin`,
      data: {
        totalSetup: defaultPermissions.length,
        created: createdCount,
        updated: updatedCount,
      },
    });
  } catch (error) {
    console.error('Setup default permissions error:', error);
    res.status(500).json({
      success: false,
      message: 'Varsayılan izinler oluşturulurken bir hata oluştu',
      error: error.message,
    });
  }
};

module.exports = {
  getPermissionById,
  getAllPermissions,
  createPermission,
  updatePermission,
  deletePermission,
  checkUserPermissions,
  getSubredditPermissions,
  manageSubredditPermission,
  assignUserPermission,
  manageRolePermissions,
  getResourcePermissions,
  batchPermissionOperation,
  setupDefaultPermissions,
};
