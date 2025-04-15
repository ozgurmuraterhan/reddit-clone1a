// İçe aktarma bölümünü düzelt
const User = require('./User');
const Permission = require('./Permission');
const Role = require('./Role');
const UserRoleAssignment = require('./UserRoleAssignment');
const Subreddit = require('./Subreddit');
const SubredditMembership = require('./SubredditMembership');
const SubredditRule = require('./SubredditRule');
const SubredditSettings = require('./SubredditSettings');
const Post = require('./Post');
const Comment = require('./Comment');
const Vote = require('./Vote');
const Flair = require('./Flair');
const Notification = require('./Notification');
const ModLog = require('./ModLog');
const Award = require('./Award');
const AwardInstance = require('./AwardInstance');
const ChatRoom = require('./ChatRoom');
const ChatMessage = require('./ChatMessage');
const Report = require('./Report');
const UserSettings = require('./UserSettings');
const Poll = require('./Poll');
const PollOption = require('./PollOption');
const PollVote = require('./PollVote');
const EditHistory = require('./EditHistory');
const UserPremium = require('./UserPremium');
const Transaction = require('./Transaction');
const TwoFactorAuth = require('./TwoFactorAuth');
const Statistics = require('./Statistics');
const ContentFilter = require('./ContentFilter');
const Tag = require('./Tag');
const TaggedItem = require('./TaggedItem');
const RateLimit = require('./RateLimit');
const ArchivePolicy = require('./ArchivePolicy');
const SEOMetadata = require('./SEOMetadata');
const MediaAsset = require('./MediaAsset');
const UserOnlineStatus = require('./UserOnlineStatus');

// Dışa aktarma bölümünü düzelt
module.exports = {
  User,
  Role,
  Permission,
  UserRoleAssignment,
  Subreddit,
  SubredditSettings,
  SubredditRule,
  SubredditMembership,
  Post,
  Comment,
  Vote,
  Flair,
  Poll,
  PollOption,
  PollVote,
  Notification,
  UserSettings,
  EditHistory,
  Report,
  ChatRoom,
  ChatMessage,
  Award,
  AwardInstance,
  UserPremium,
  Transaction,
  ModLog,
  TwoFactorAuth,
  Statistics,
  ContentFilter,
  Tag,
  TaggedItem,
  RateLimit,
  ArchivePolicy,
  SEOMetadata,
  MediaAsset,
  UserOnlineStatus
};
