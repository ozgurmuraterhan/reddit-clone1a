require('dotenv').config(); // .env dosyasını yükle
const express = require('express');
const mongoose = require('mongoose');
const passport = require('passport');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const cors = require('cors');
const helmet = require('helmet');
const configPassport = require('./config/passport');

const app = express();

// MongoDB bağlantısı
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  user: process.env.MONGODB_USER,
  pass: process.env.MONGODB_PASSWORD
})
.then(() => {
  console.log('MongoDB bağlantısı başarılı');
})
.catch(err => {
  console.error('MongoDB bağlantı hatası:', err.message);
  process.exit(1);
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? process.env.APP_URL : '*',
  credentials: true
}));
app.use(helmet());

// Session yapılandırması
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGODB_URI,
    ttl: process.env.SESSION_EXPIRE / 1000 // TTL in seconds
  }),
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: parseInt(process.env.SESSION_EXPIRE) || 86400000 // 1 gün
  }
}));

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

// Routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const subredditRoutes = require('./routes/subreddits');
const postRoutes = require('./routes/posts');
const commentRoutes = require('./routes/comments');

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/subreddits', subredditRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/comments', commentRoutes);

// Global hata yakalama
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: 'Sunucu hatası',
    error: process.env.NODE_ENV === 'development' ? err.message : 'Bir hata oluştu'
  });
});

// Server başlatma
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server ${PORT} portunda çalışıyor`);
});
