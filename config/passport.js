const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const JwtStrategy = require('passport-jwt').Strategy;
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const FacebookStrategy = require('passport-facebook').Strategy;
const ExtractJwt = require('passport-jwt').ExtractJwt;
const bcrypt = require('bcrypt');
const { User, Role, Permission, UserRoleAssignment } = require('../models');

// JWT seçenekleri
const jwtOptions = {
  jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
  secretOrKey: process.env.JWT_SECRET
};

module.exports = () => {
  // Local Strategy (Email/Password)
  passport.use(
    new LocalStrategy(
      {
        usernameField: 'email',
        passwordField: 'password'
      },
      async (email, password, done) => {
        try {
          const user = await User.findOne({ email }).select('+password');

          if (!user) {
            return done(null, false, { message: 'Kullanıcı bulunamadı' });
          }

          if (user.accountStatus !== 'active') {
            return done(null, false, { message: 'Hesap aktif değil' });
          }

          const isMatch = await bcrypt.compare(password, user.password);

          if (!isMatch) {
            return done(null, false, { message: 'Hatalı şifre' });
          }

          user.lastLogin = Date.now();
          await user.save();

          return done(null, user);
        } catch (error) {
          return done(error);
        }
      }
    )
  );

  // JWT Strategy
  passport.use(
    new JwtStrategy(jwtOptions, async (jwtPayload, done) => {
      try {
        const user = await User.findById(jwtPayload.id);

        if (!user) {
          return done(null, false);
        }

        if (user.accountStatus !== 'active') {
          return done(null, false);
        }

        user.lastActive = Date.now();
        await user.save();

        return done(null, user);
      } catch (error) {
        return done(error, false);
      }
    })
  );

  // Google OAuth Strategy
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: process.env.GOOGLE_CALLBACK_URL,
        profileFields: ['id', 'displayName', 'photos', 'email']
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          // Google hesabının email bilgisini al
          const email = profile.emails && profile.emails[0] ? profile.emails[0].value : null;

          if (!email) {
            return done(new Error('Google hesabından email bilgisi alınamadı'), null);
          }

          // Kullanıcıyı kontrol et
          let user = await User.findOne({ email });

          // Kullanıcı yoksa oluştur
          if (!user) {
            // Kullanıcı adı oluştur (Google displayName'den)
            const baseUsername = profile.displayName
              .toLowerCase()
              .replace(/\s+/g, '_')
              .replace(/[^a-z0-9_-]/g, '');

            // Benzersiz kullanıcı adı oluştur
            let username = baseUsername;
            let count = 1;
            while (await User.findOne({ username })) {
              username = `${baseUsername}_${count}`;
              count++;
            }

            // Yeni kullanıcı oluştur
            user = new User({
              username,
              email,
              password: await bcrypt.hash(require('crypto').randomBytes(16).toString('hex'), 10),
              profilePicture: profile.photos && profile.photos[0] ? profile.photos[0].value : 'default-profile.png',
              emailVerified: true,
              accountStatus: 'active',
              authProvider: 'google',
              authProviderId: profile.id
            });

            await user.save();

            // Kullanıcı ayarlarını oluştur
            const UserSettings = require('../models/UserSettings');
            const userSettings = new UserSettings({
              user: user._id
            });

            await userSettings.save();
          } else if (!user.authProviderId) {
            // Mevcut hesabı Google ile bağla
            user.authProvider = 'google';
            user.authProviderId = profile.id;
            user.emailVerified = true;

            if (user.accountStatus === 'pending_verification') {
              user.accountStatus = 'active';
            }

            await user.save();
          }

          return done(null, user);
        } catch (error) {
          return done(error, null);
        }
      }
    )
  );

  // Facebook OAuth Strategy
  passport.use(
    new FacebookStrategy(
      {
        clientID: process.env.FACEBOOK_APP_ID,
        clientSecret: process.env.FACEBOOK_APP_SECRET,
        callbackURL: process.env.FACEBOOK_CALLBACK_URL,
        profileFields: ['id', 'displayName', 'photos', 'email']
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          // Facebook hesabının email bilgisini al
          const email = profile.emails && profile.emails[0] ? profile.emails[0].value : null;

          if (!email) {
            return done(new Error('Facebook hesabından email bilgisi alınamadı'), null);
          }

          // Kullanıcıyı kontrol et
          let user = await User.findOne({ email });

          // Kullanıcı yoksa oluştur
          if (!user) {
            // Kullanıcı adı oluştur
            const baseUsername = profile.displayName
              .toLowerCase()
              .replace(/\s+/g, '_')
              .replace(/[^a-z0-9_-]/g, '');

            // Benzersiz kullanıcı adı oluştur
            let username = baseUsername;
            let count = 1;
            while (await User.findOne({ username })) {
              username = `${baseUsername}_${count}`;
              count++;
            }

            // Yeni kullanıcı oluştur
            user = new User({
              username,
              email,
              password: await bcrypt.hash(require('crypto').randomBytes(16).toString('hex'), 10),
              profilePicture: profile.photos && profile.photos[0] ? profile.photos[0].value : 'default-profile.png',
              emailVerified: true,
              accountStatus: 'active',
              authProvider: 'facebook',
              authProviderId: profile.id
            });

            await user.save();

            // Kullanıcı ayarlarını oluştur
            const UserSettings = require('../models/UserSettings');
            const userSettings = new UserSettings({
              user: user._id
            });

            await userSettings.save();
          } else if (!user.authProviderId) {
            // Mevcut hesabı Facebook ile bağla
            user.authProvider = 'facebook';
            user.authProviderId = profile.id;
            user.emailVerified = true;

            if (user.accountStatus === 'pending_verification') {
              user.accountStatus = 'active';
            }

            await user.save();
          }

          return done(null, user);
        } catch (error) {
          return done(error, null);
        }
      }
    )
  );

  // Session için serialize/deserialize
  passport.serializeUser((user, done) => {
    done(null, user.id);
  });

  passport.deserializeUser(async (id, done) => {
    try {
      const user = await User.findById(id);
      done(null, user);
    } catch (error) {
      done(error, null);
    }
  });
};
