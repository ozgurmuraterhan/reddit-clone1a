require('dotenv').config(); // .env dosyasını yükle
const express = require('express');
const mongoose = require('mongoose');
const passport = require('passport');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const cors = require('cors');
const helmet = require('helmet');
const configPassport = require('./config/passport');
const fs = require('fs');
const path = require('path');
const morgan = require('morgan');
const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss-clean');
const hpp = require('hpp');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');

// Uygulama oluştur
const app = express();

// MongoDB bağlantısı
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('MongoDB bağlantısı başarılı');
  })
  .catch((err) => {
    console.error('MongoDB bağlantı hatası:', err.message);
    process.exit(1);
  });

// Dev logging middleware - morgan
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// Cookie parser
app.use(cookieParser());

// Temel Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Güvenlik Middleware
app.use(mongoSanitize());
app.use(xss());
app.use(hpp());

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 100,
  message: 'Çok fazla istek gönderdiniz, lütfen biraz bekleyin.',
});
app.use('/api/', apiLimiter);

app.use(
  cors({
    origin: process.env.NODE_ENV === 'production' ? process.env.FRONTEND_URL : '*',
    credentials: true,
  }),
);
app.use(helmet());

// Session yapılandırması
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: process.env.MONGODB_URI,
      ttl: process.env.SESSION_EXPIRE / 1000, // TTL in seconds
    }),
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      maxAge: parseInt(process.env.SESSION_EXPIRE, 10) || 86400000 * 365, // 365 gün
    },
  }),
);

// Global hata yakalama
app.use((err, req, res, next) => {
  console.error(err.stack);

  const statusCode = err.statusCode || 500;
  const message = err.message || 'Sunucu hatası';

  res.status(statusCode).json({
    success: false,
    error: message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
  });
});

// İşlenmemiş Promise ret durumlarını yakala
process.on('unhandledRejection', (err, promise) => {
  console.error(`Error: ${err.message}`);
});
// Passport initialize
app.use(passport.initialize());
app.use(passport.session());
configPassport(); // Passport stratejileri yapılandır
// CSRF token oluşturma
app.use((req, res, next) => {
  if (!req.session.csrfToken) {
    req.session.csrfToken = require('crypto').randomBytes(64).toString('hex');
  }
  next();
});

// Kaldırın ve yerine şu kodu ekleyin:
// Route dosyalarını doğrudan import et
const authRoutes = require('./routes/authRoutes');
const usersRoutes = require('./routes/usersRoutes');
const postRoutes = require('./routes/postRoutes');

// Route'ları tanımla
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/posts', postRoutes);

// Server başlatma
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server ${PORT} portunda çalışıyor (${process.env.NODE_ENV || 'development'} modu)`);
});

module.exports = app;
