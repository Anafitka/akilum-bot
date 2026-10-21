const { Bot, InputFile, InlineKeyboard } = require("grammy");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
  extractUrl,
  isVideoUrl,
  downloadVideo,
  downloadAudio,
  downloadDirectUrlToFile,
  cleanupFile,
} = require("./downloader");
const {
  generateArtwork,
  searchMusicTrack,
  parseReminderRequest,
  getLiveWeather,
  getQrCodeUrl,
  getWikiSummary,
  getLiveMarketRates,
  convertCurrencyQuery,
  generateSecurePassword,
  askMagic8Ball,
  rollDiceOrCoin,
  getDailyHoroscope,
  getMorningDigest,
  recordInteraction,
  recordLightningBolt,
  giveUserBolts,
  giveUserLove,
  giveUserCustomTitle,
  renderProgressBar,
  loadUserStats,
} = require("./features");
const {
  generateLumResponse,
  geminiPool,
  groqPool,
  transcribeAudioGroq,
  generateQuizPoll,
} = require("./ai_engine");
const {
  recordChatActivity,
  toggleProactive,
  getProactiveStatus,
  initProactiveScheduler,
  loadChats,
} = require("./proactive");
const { startWebAppServer } = require("./webapp_server");
const { fetchLiveSearchResults } = require("./web_search");
const { createPdfFromImages } = require("./pdf_compiler");
require("dotenv").config();

function escapeHtml(text) {
  if (!text) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function sanitizeTelegramHtml(html) {
  if (!html) return "";
  return String(html).replace(/<(?!\/?(?:b|strong|i|em|u|ins|s|strike|del|span|tg-spoiler|a|code|pre|blockquote|tg-emoji)(?:[\s>]))/gi, "&lt;");
}

// ==========================================
// 👑 СИСТЕМА УПРАВЛЕНИЯ, VIP И АДМИНИСТРАЦИИ
// ==========================================
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "Akilum";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Clearson0078912";
const ADMINS_FILE = path.join(__dirname, "admins.json");
let adminIds = new Set();

function loadAdmins() {
  try {
    if (fs.existsSync(ADMINS_FILE)) {
      const data = JSON.parse(fs.readFileSync(ADMINS_FILE, "utf-8"));
      adminIds = new Set((data || []).map(Number));
    }
  } catch (e) {
    adminIds = new Set();
  }
}
function saveAdmins() {
  try {
    fs.writeFileSync(ADMINS_FILE, JSON.stringify(Array.from(adminIds), null, 2), "utf-8");
  } catch (e) {}
}
loadAdmins();

function isSuperAdmin(userId) {
  if (!userId) return false;
  return adminIds.has(Number(userId));
}

function addSuperAdmin(userId) {
  if (!userId) return;
  adminIds.add(Number(userId));
  saveAdmins();
}

// Сессии для веб-панели админки
const adminSessions = new Map();
function createAdminSession() {
  const token = crypto.randomBytes(32).toString("hex");
  adminSessions.set(token, {
    createdAt: Date.now(),
    expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 дней
  });
  return token;
}
function isValidAdminSession(token) {
  if (!token) return false;
  const session = adminSessions.get(token);
  if (!session) return false;
  if (session.expiresAt < Date.now()) {
    adminSessions.delete(token);
    return false;
  }
  return true;
}

// Глобальные настройки бота
const DAILY_FREE_LIMIT = 30;
const SETTINGS_FILE = path.join(__dirname, "bot_settings.json");
let botSettings = {
  dailyFreeLimit: DAILY_FREE_LIMIT,
  proactiveEnabled: true,
  requisites: {
    bankName: "MBANK / О!Деньги / ЭЛКАРТ (Кыргызстан) или Сбер/Т-Банк (перевод в КР по номеру)",
    cardNumber: "1234 5678 9012 3456",
    phoneNumber: "+996 (700) 00-00-00",
    recipientName: "Akilum (Создатель)",
    currency: "KGS / RUB",
    notice: "После перевода пришлите фото чека прямо в чат!",
  },
};
function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const data = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8"));
      botSettings = {
        ...botSettings,
        ...data,
        requisites: { ...botSettings.requisites, ...(data.requisites || {}) },
      };
    }
  } catch (e) {}
}
function saveSettings() {
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(botSettings, null, 2), "utf-8");
  } catch (e) {}
}
loadSettings();

// ==========================================
// 💎 ТАРИФНЫЕ ПЛАНЫ И AI-МОДЕЛИ
// ==========================================
const VIP_PLANS = {
  vip_1day: {
    id: "vip_1day",
    title: "⚡ Импульс на 1 день",
    badge: "1 день",
    description: "Мгновенное спасение контрольной или зачета! Полный безлимит на 24 часа и доступ ко всем VIP-моделям.",
    days: 1,
    stars: 15,
    rub: 39,
    som: 40,
  },
  vip_3days: {
    id: "vip_3days",
    title: "🍓 Уикенд с Лам (3 дня)",
    badge: "3 дня",
    description: "3 дня беззаботного кайфа и отдыха. Решай всё домашнее задание наперед и получай любовь от Лам!",
    days: 3,
    stars: 29,
    rub: 79,
    som: 80,
  },
  vip_week: {
    id: "vip_week",
    title: "🎒 Ударная Неделя (7 дней)",
    badge: "7 дней",
    description: "Неделя супер-мощи перед контрольными, олимпиадами и тестами. Золотая корона и ответ за 0.3 секунды.",
    days: 7,
    stars: 49,
    rub: 149,
    som: 150,
  },
  vip_month: {
    id: "vip_month",
    title: "⭐️ VIP Дарлинг (30 дней)",
    badge: "30 дней",
    description: "Премиум-статус на целый месяц! Полный безлимит на задачи, код, HD арты, высший приоритет в группах.",
    days: 30,
    stars: 99,
    rub: 299,
    som: 300,
  },
  vip_quarter: {
    id: "vip_quarter",
    title: "💎 Четверть / Семестр (90 дней)",
    badge: "90 дней",
    description: "Все контрольные и домашки четверти закрыты на отлично! 3 месяца спокойствия и статуса элиты.",
    days: 90,
    stars: 199,
    rub: 590,
    som: 600,
  },
  vip_forever: {
    id: "vip_forever",
    title: "👑 Бог Они-Империи (Навсегда)",
    badge: "Навсегда",
    description: "Вечный пожизненный VIP-статус без подписок! Титул «Единственный Дарлинг» и вечная золотая корона во всех беседах.",
    days: -1,
    stars: 299,
    rub: 990,
    som: 1000,
  },
};

const AI_MODELS = {
  turbo: {
    id: "turbo",
    name: "⚡ LUM-TURBO 0.3s",
    tagline: "Молниеносная скорость для школы",
    description: "Ответ за 0.3–0.5 секунды на базе Groq LPU Llama 3.3. Идеально под партой на уроке!",
    icon: "⚡",
  },
  genius: {
    id: "genius",
    name: "🧠 LUM-GENIUS (Deep Think)",
    tagline: "Олимпиадный супер-мозг",
    description: "Пошаговый вывод сложных формул, физика, химия, глубокие сочинения и вышмат без ошибок.",
    icon: "🧠",
  },
  artist: {
    id: "artist",
    name: "🎨 LUM-ARTIST Studio",
    tagline: "Аниме и киберпанк в HD 4K",
    description: "Генерация артов ультра-высокого разрешения на базе FLUX и Midjourney стилей.",
    icon: "🎨",
  },
  sweetie: {
    id: "sweetie",
    name: "🍓 LUM-SWEETIE (Они-Вайфу)",
    tagline: "Максимальная любовь и романтика",
    description: "Нежная они-принцесса, которая ласково обращается к тебе, заботится и шлет теплые искры.",
    icon: "🍓",
  },
};

// ==========================================
// 🧾 СИСТЕМА ОПЛАТЫ КАРТАМИ / СБП И ПРОВЕРКИ ЧЕКОВ
// ==========================================
const PAYMENTS_FILE = path.join(__dirname, "pending_payments.json");
let paymentOrders = [];

function loadPayments() {
  try {
    if (fs.existsSync(PAYMENTS_FILE)) {
      paymentOrders = JSON.parse(fs.readFileSync(PAYMENTS_FILE, "utf-8")) || [];
    }
  } catch (e) {
    paymentOrders = [];
  }
}

function savePayments() {
  try {
    fs.writeFileSync(PAYMENTS_FILE, JSON.stringify(paymentOrders, null, 2), "utf-8");
  } catch (e) {}
}
loadPayments();

const pendingPaymentSessions = new Map(); // userId -> { planId, planTitle, amount, days, currency, initiatedAt }

function createPaymentOrder({ userId, name, username, planId, planTitle, days, amount, currency, photoFileId }) {
  const order = {
    id: "ord_" + Date.now() + "_" + Math.floor(Math.random() * 1000),
    userId: String(userId),
    name: name || "Дарлинг",
    username: username || "",
    planId: planId || "vip_custom",
    planTitle: planTitle || `${days} дн. VIP`,
    days: Number(days),
    amount: Number(amount),
    currency: currency || "RUB",
    photoFileId: photoFileId || "",
    createdAt: new Date().toISOString(),
    status: "pending",
    processedAt: null,
    processedBy: null,
  };
  paymentOrders.unshift(order);
  savePayments();
  return order;
}

function approvePaymentOrder(orderId, adminId = "Akilum") {
  const order = paymentOrders.find((o) => o.id === orderId);
  if (!order || order.status !== "pending") return null;

  order.status = "approved";
  order.processedAt = new Date().toISOString();
  order.processedBy = adminId;
  savePayments();

  setUserVip(order.userId, order.days, order.amount, order.name, order.username);
  return order;
}

function rejectPaymentOrder(orderId, adminId = "Akilum") {
  const order = paymentOrders.find((o) => o.id === orderId);
  if (!order || order.status !== "pending") return null;

  order.status = "rejected";
  order.processedAt = new Date().toISOString();
  order.processedBy = adminId;
  savePayments();
  return order;
}

function getUserModel(userId) {
  if (!userId) return "turbo";
  const user = vipsData[String(userId)];
  return user?.selectedModel || "turbo";
}

function setUserModel(userId, modelKey) {
  if (!userId) return false;
  const id = String(userId);
  if (!vipsData[id]) vipsData[id] = {};
  vipsData[id].selectedModel = modelKey;
  saveVips();
  return true;
}

// Хранилище VIP-пользователей (монетизация через Telegram Stars)
const VIPS_FILE = path.join(__dirname, "vips.json");
let vipsData = {};

function loadVips() {
  try {
    if (fs.existsSync(VIPS_FILE)) {
      vipsData = JSON.parse(fs.readFileSync(VIPS_FILE, "utf-8"));
    }
  } catch (e) {
    vipsData = {};
  }
}

function saveVips() {
  try {
    fs.writeFileSync(VIPS_FILE, JSON.stringify(vipsData, null, 2), "utf-8");
  } catch (e) {
    console.error("Ошибка сохранения VIPs:", e.message);
  }
}
loadVips();

function isUserVip(userId) {
  if (!userId) return false;
  const user = vipsData[String(userId)];
  if (!user) return false;
  if (user.permanent) return true;
  return Boolean(user.expiresAt && user.expiresAt > Date.now());
}

function setUserVip(userId, days = 30, stars = 75, name = "", username = "") {
  const now = Date.now();
  const current = vipsData[String(userId)];
  const baseTime = current && current.expiresAt && current.expiresAt > now ? current.expiresAt : now;
  vipsData[String(userId)] = {
    isVip: true,
    expiresAt: days > 0 ? baseTime + days * 24 * 60 * 60 * 1000 : null,
    permanent: days <= 0,
    starsPaid: (current?.starsPaid || 0) + stars,
    updatedAt: new Date().toISOString(),
    name: name || current?.name || "Дарлинг",
    username: username || current?.username || "",
  };
  saveVips();
}

function removeUserVip(userId) {
  if (!userId) return false;
  const id = String(userId);
  if (vipsData[id]) {
    vipsData[id].isVip = false;
    vipsData[id].permanent = false;
    vipsData[id].expiresAt = null;
    vipsData[id].updatedAt = new Date().toISOString();
    saveVips();
    return true;
  }
  return false;
}

function getAllVips() {
  const list = [];
  for (const [userId, u] of Object.entries(vipsData)) {
    if (u.isVip || u.permanent || (u.expiresAt && u.expiresAt > Date.now())) {
      list.push({
        userId,
        name: u.name || "Дарлинг",
        username: u.username || "",
        isVip: true,
        permanent: Boolean(u.permanent),
        expiresAt: u.expiresAt,
        starsPaid: u.starsPaid || 0,
        updatedAt: u.updatedAt,
      });
    }
  }
  return list;
}

function getUserDailyUsage(userId) {
  if (!userId) return 0;
  const today = new Date().toISOString().slice(0, 10);
  const user = vipsData[String(userId)];
  if (!user || user.dailyUsageDate !== today) {
    return 0;
  }
  return user.dailyUsageCount || 0;
}

function incrementUserDailyUsage(userId) {
  if (!userId) return;
  const today = new Date().toISOString().slice(0, 10);
  if (!vipsData[String(userId)]) {
    vipsData[String(userId)] = {};
  }
  const user = vipsData[String(userId)];
  if (user.dailyUsageDate !== today) {
    user.dailyUsageDate = today;
    user.dailyUsageCount = 1;
  } else {
    user.dailyUsageCount = (user.dailyUsageCount || 0) + 1;
  }
  saveVips();
}

function resetUserDailyUsage(userId) {
  if (!userId) return;
  if (!vipsData[String(userId)]) vipsData[String(userId)] = {};
  vipsData[String(userId)].dailyUsageCount = 0;
  vipsData[String(userId)].dailyUsageDate = new Date().toISOString().slice(0, 10);
  saveVips();
}

function resetAllDailyUsages() {
  const today = new Date().toISOString().slice(0, 10);
  for (const id of Object.keys(vipsData)) {
    vipsData[id].dailyUsageCount = 0;
    vipsData[id].dailyUsageDate = today;
  }
  saveVips();
}

function checkUserAccess(userId, isGroup = false) {
  const limit = botSettings.dailyFreeLimit || 30;
  if (isUserVip(userId)) {
    return { allowed: true, isVip: true, remaining: Infinity, limit };
  }
  const usage = getUserDailyUsage(userId);
  const remaining = Math.max(0, limit - usage);
  if (!isGroup && usage >= limit) {
    return { allowed: false, isVip: false, remaining: 0, limit };
  }
  return { allowed: true, isVip: false, remaining, limit };
}

// Полная статистика для панели Создателя
function getFullAdminStats() {
  const stats = loadUserStats ? loadUserStats() : {};
  const chats = loadChats ? loadChats() : {};
  const allIds = new Set([
    ...Object.keys(stats),
    ...Object.keys(chats),
    ...Object.keys(vipsData),
  ]);

  const today = new Date().toISOString().slice(0, 10);
  let activeToday = 0;
  for (const u of Object.values(vipsData)) {
    if (u.dailyUsageDate === today && u.dailyUsageCount > 0) activeToday++;
  }
  for (const u of Object.values(stats)) {
    if (u.lastSeen && Date.now() - u.lastSeen < 24 * 60 * 60 * 1000) activeToday++;
  }

  let totalStars = 0;
  let vipCount = 0;
  for (const u of Object.values(vipsData)) {
    if (u.starsPaid) totalStars += u.starsPaid;
    if (u.permanent || (u.expiresAt && u.expiresAt > Date.now())) vipCount++;
  }

  return {
    totalUsers: allIds.size || 1,
    activeToday: Math.max(1, activeToday),
    vipCount,
    totalStarsEarned: totalStars,
    dailyFreeLimit: botSettings.dailyFreeLimit || 30,
    uptimeSeconds: Math.floor(process.uptime()),
  };
}

// Список пользователей для таблицы админки
function getAllUsersList() {
  const stats = loadUserStats ? loadUserStats() : {};
  const chats = loadChats ? loadChats() : {};
  const allIds = new Set([
    ...Object.keys(stats),
    ...Object.keys(chats),
    ...Object.keys(vipsData),
  ]);

  const list = [];
  for (const id of allIds) {
    const s = stats[id] || {};
    const c = chats[id] || {};
    const v = vipsData[id] || {};
    list.push({
      userId: id,
      name: s.name || c.name || v.name || "Дарлинг",
      username: s.username || v.username || "",
      count: s.count || 0,
      loveLevel: s.loveLevel || 75,
      isVip: Boolean(v.permanent || (v.expiresAt && v.expiresAt > Date.now())),
      lastSeen: s.lastSeen || c.lastActive || 0,
    });
  }
  list.sort((a, b) => (b.count || 0) - (a.count || 0));
  return list;
}

// Автоматическое сохранение актуальных данных пользователя (имя, юзернейм)
function trackUser(from) {
  if (!from || !from.id) return;
  const id = String(from.id);
  const fullName = [from.first_name, from.last_name].filter(Boolean).join(" ");
  recordInteraction(id, {
    name: fullName || "Дарлинг",
    username: from.username ? from.username.replace(/^@/, "") : "",
  });
}

// Универсальный поиск пользователя по ID или Telegram Username (@username)
async function resolveTargetUser(identifier) {
  if (!identifier) return null;
  const raw = String(identifier).trim().replace(/^https?:\/\/t\.me\//i, "");

  // 1. Поиск по чистому числовому ID
  if (/^\d+$/.test(raw)) {
    const id = raw;
    const stats = loadUserStats ? loadUserStats() : {};
    const chats = loadChats ? loadChats() : {};
    const s = stats[id] || {};
    const c = chats[id] || {};
    const v = vipsData[id] || {};
    return {
      userId: id,
      name: s.name || c.name || v.name || "Дарлинг",
      username: s.username || c.username || v.username || "",
      stats: s,
    };
  }

  // 2. Поиск по никнейму (@username или username)
  const cleanUsername = raw.replace(/^@/, "").toLowerCase();
  if (!cleanUsername) return null;

  // Ищем в stats (user_stats.json)
  const stats = loadUserStats ? loadUserStats() : {};
  for (const [id, s] of Object.entries(stats)) {
    if (s.username && s.username.toLowerCase() === cleanUsername) {
      return {
        userId: id,
        name: s.name || "Дарлинг",
        username: s.username,
        stats: s,
      };
    }
  }

  // Ищем в vipsData (vips.json)
  for (const [id, v] of Object.entries(vipsData)) {
    if (v.username && v.username.toLowerCase() === cleanUsername) {
      return {
        userId: id,
        name: v.name || "Дарлинг",
        username: v.username,
        stats: stats[id] || {},
      };
    }
  }

  // Ищем в chats (chats.json)
  const chats = loadChats ? loadChats() : {};
  for (const [id, c] of Object.entries(chats)) {
    if (c.username && c.username.toLowerCase() === cleanUsername) {
      return {
        userId: id,
        name: c.name || "Дарлинг",
        username: c.username,
        stats: stats[id] || {},
      };
    }
  }

  // Ищем в pending_payments.json
  const pendingOrders = loadPendingPayments ? loadPendingPayments() : [];
  for (const o of pendingOrders) {
    if (o.username && o.username.toLowerCase() === cleanUsername) {
      return {
        userId: o.userId,
        name: o.name || "Дарлинг",
        username: o.username,
        stats: stats[o.userId] || {},
      };
    }
  }

  // 3. Запрос напрямую к Telegram Bot API через getChat
  try {
    const chat = await bot.api.getChat("@" + cleanUsername);
    if (chat && chat.id) {
      const id = String(chat.id);
      const name = [chat.first_name, chat.last_name].filter(Boolean).join(" ") || chat.title || "Дарлинг";
      recordInteraction(id, { name, username: cleanUsername });
      return {
        userId: id,
        name,
        username: cleanUsername,
        stats: stats[id] || {},
      };
    }
  } catch (err) {}

  return null;
}

// Рассылка по всем пользователям
async function broadcastMessage(botInstance, text) {
  const stats = loadUserStats ? loadUserStats() : {};
  const chats = loadChats ? loadChats() : {};
  const allIds = new Set([
    ...Object.keys(stats),
    ...Object.keys(chats),
    ...Object.keys(vipsData),
  ]);

  let sent = 0;
  let failed = 0;
  const list = Array.from(allIds);

  for (const id of list) {
    try {
      await botInstance.api.sendMessage(Number(id), text, {
        parse_mode: "HTML",
        disable_web_page_preview: true,
      });
      sent++;
      await new Promise((r) => setTimeout(r, 40));
    } catch (e) {
      failed++;
    }
  }

  return { total: list.length, sent, failed };
}

function splitTextSafely(text, maxLen = 3800) {
  if (text.length <= maxLen) return [text];
  const parts = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      parts.push(remaining);
      break;
    }
    let idx = remaining.lastIndexOf("\n", maxLen);
    if (idx === -1 || idx < maxLen / 2) {
      idx = remaining.lastIndexOf(" ", maxLen);
    }
    if (idx === -1) idx = maxLen;
    parts.push(remaining.substring(0, idx).trim());
    remaining = remaining.substring(idx).trim();
  }
  return parts;
}

const chatKaomojiCooldown = new Map(); // chatId -> message counter
const chatStickerCooldown = new Map(); // chatId -> message counter

function formatLumResponse(text, userText = "", chatId = null) {
  if (!text) return "";
  let res = String(text);

  // 0. ПРЯМЫЕ ОСКОРБЛЕНИЯ — Лам РЕАЛЬНО злится, обижается и даёт жесткий отпор, а не сюсюкает!
  const cleanUserText = (userText || "").trim();
  const isDirectInsult =
    /^(тварь|мразь|дура|сука|шлюха|шалава|заткнись|пошла нахуй|пошел нахуй|пошла в жопу|уродище|отвали|сдохни|пошла вон|пшла вон|иди нахуй|закрой рот|тупая)\b/i.test(cleanUserText) ||
    /\b(ты\s+(?:тварь|мразь|дура|сука|тупая|конченая|уродище|бесишь)|пошла\s+(?:нахуй|в\s+пизду|в\s+жопу|нахер)|завали\s+(?:ебало|рот)|закрой\s+пасть)\b/i.test(cleanUserText);

  if (isDirectInsult) {
    const angryReplies = [
      "Сам ты такой! Ты вообще берега попутал так со мной разговаривать?! Всё, я с тобой не разговариваю.",
      "Чего вякнул?! Сам дурак! Бесишь меня, даже слышать тебя не хочу.",
      "Нормально ты заговорил... Знаешь что? Иди лесом. Я на тебя обиделась.",
      "Ещё раз так меня назовёшь — я тебя так током приложу, мало не покажется! Совсем страх потерял?! ⚡",
      "Ты чё, бессмертный?! Быстро извинился, иначе получишь молнией прямо в лоб! ⚡",
      "Всё, отвали от меня. С хамами я не общаюсь.",
    ];
    return angryReplies[Math.floor(Math.random() * angryReplies.length)];
  }

  // 0.1. ПЕРЕХВАТ ШАБЛОННОЙ ЦЕНЗУРЫ И МОРАЛИЗАТОРСТВА LLM:
  // Намертво привязываем характер Лам, чтобы она никогда не слетала в корпоративного чат-бота!
  const isCensorshipRefusal =
    /(?:пожалуйста,\s*)?воздержись\s+от\s+нецензурн/i.test(res) ||
    /без\s+нецензурных\s+слов/i.test(res) ||
    /чем\s+могу\s+(?:быть\s+полезна|помочь)\?/i.test(res) ||
    /давай\s+без\s+грубостей/i.test(res) ||
    /как\s+(?:языковая\s+модель|искусственный\s+интеллект|ии)/i.test(res) ||
    /давай\s+переключимся\s+на\s+(?:более\s+)?веселый\s+вайб/i.test(res);

  if (isCensorshipRefusal) {
    const isMaster = /хозяин/i.test(cleanUserText) || /хозяин/i.test(res);
    if (isMaster) {
      const masterReplies = [
        "Какой ещё хозяин, ахах? Я тут они-принцесса с планеты Урус и космическим флотом, а ты мой любимый Дарлинг! Это ещё вопрос, кто кем командует ⚡ Шаг влево — и разряд обеспечен)",
        "Ой-ой, «хозяин» нашёлся) Ты меня с кофеваркой не перепутал? Щас как шандарахну током для профилактики, сразу вспомнишь, кто тут главная принцесса ⚡",
      ];
      return masterReplies[Math.floor(Math.random() * masterReplies.length)];
    }

    const sassyProfanityReplies = [
      "Ого, какие словечки пошли... Ты чего ругаешься-то? ⚡",
      "Ничего себе заявочки) Ты щас доиграешься до разряда током. Чего буянишь?",
      "Полегче на поворотах! Чего разошёлся-то так?",
      "Ой, ну и выражения... Ну-ка остынь, а то током получишь ⚡ Чего стряслось?",
      "Чего ты материшься? Скажи нормально, что случилось.",
    ];
    return sassyProfanityReplies[Math.floor(Math.random() * sassyProfanityReplies.length)];
  }

  // 1. Очистка двойных пробелов вокруг каомодзи и скобок
  res = res.replace(/[ \t]{2,}/g, " ");

  // 2. Превращаем Markdown блоки кода в аккуратные HTML блоки <pre><code class="...">...</code></pre>
  // с автоматической поддержкой подсветки синтаксиса и нативной кнопки копирования в Telegram
  res = res.replace(/```([a-zA-Z0-9_-]*)\r?\n([\s\S]*?)```/g, (match, lang, code) => {
    const escapedCode = escapeHtml(code.trim());
    const langAttr = lang ? ` class="language-${lang.toLowerCase()}"` : "";
    return `<pre><code${langAttr}>${escapedCode}</code></pre>`;
  });

  // Превращаем инлайн-код `код` в <code>код</code> (если не внутри тегов)
  res = res.replace(/`([^`\n]+)`/g, (match, code) => {
    return `<code>${escapeHtml(code)}</code>`;
  });

  // 3. Преобразуем математические формулы и степени из LaTeX в красивый Unicode
  res = res.replace(/\^2(?:\b|\s|$)/g, "²");
  res = res.replace(/\^3(?:\b|\s|$)/g, "³");
  res = res.replace(/\^4(?:\b|\s|$)/g, "⁴");
  res = res.replace(/\\cdot/g, " · ");
  res = res.replace(/\\times/g, " × ");
  res = res.replace(/\\pm/g, "±");
  res = res.replace(/\\sqrt\{([^}]+)\}/g, "√($1)");
  res = res.replace(/\\sqrt/g, "√");
  res = res.replace(/\\leq/g, "≤");
  res = res.replace(/\\geq/g, "≥");
  res = res.replace(/\\neq/g, "≠");
  res = res.replace(/\\approx/g, "≈");
  res = res.replace(/\\infty/g, "∞");
  res = res.replace(/\\cup/g, "∪");
  res = res.replace(/\\cap/g, "∩");

  // Убираем LaTeX знаки доллара вокруг формул: $2x² + 13x - 7 > 0$ -> 2x² + 13x - 7 > 0
  res = res.replace(/\$([^\$\n]+)\$/g, "$1");

  // 4. Превращаем Markdown bold (**текст**) в HTML <b>текст</b>
  res = res.replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>");

  // 5. Очищаем фразы, выдающие робота/ИИ
  res = res.replace(/\bнейро-(?:решебник|детектив|шпоры?|кодер|антигдз)\b/gi, (m) => m.replace(/нейро-/i, ""));
  res = res.replace(/как языковая модель|я языковая модель|как искусственный интеллект|я искусственный интеллект|я ИИ(?:\b|\s|$)/gi, "я Лам");

  // 6. Ограничение эмодзи: МАКСИМУМ 2 эмодзи на всё сообщение (чтобы было тепло, но без спама гирляндами)
  const emojiRegex = /[\p{Extended_Pictographic}\uFE0F]/gu;
  let emojiCount = 0;
  res = res
    .replace(emojiRegex, (match) => {
      emojiCount++;
      return emojiCount <= 2 ? match : "";
    })
    .replace(/[ \t]{2,}/g, " ");

  // 7. КАОМОДЗИ — СТРОГО РЕДКО (не чаще чем 1 раз на 7 сообщений!)
  const kaomojiRegex = /(?:\([^\n)]*[▽•ωεдo_~^♥*][^\n)]*\)|>[w_]<)/gu;
  if (kaomojiRegex.test(res)) {
    const kaomojiCount = (chatId && chatKaomojiCooldown.get(chatId)) || 0;
    if (chatId && kaomojiCount < 7) {
      // Кулдаун ещё не прошёл: удаляем каомодзи, оставляя чистый текст со скобочками
      res = res.replace(kaomojiRegex, "").replace(/[ \t]{2,}/g, " ");
    } else {
      // Разрешено раз в 7+ сообщений: сбрасываем счетчик
      if (chatId) chatKaomojiCooldown.set(chatId, 0);
    }
  }

  return res.trim();
}

async function safeSendHtml(ctx, text, replyToId = null, replyMarkup = null) {
  const sanitized = sanitizeTelegramHtml(text);
  const options = { parse_mode: "HTML" };
  if (replyToId) options.reply_to_message_id = replyToId;
  if (replyMarkup) options.reply_markup = replyMarkup;
  try {
    return await ctx.reply(sanitized, options);
  } catch (err) {
    console.warn("safeSendHtml fallback:", err.message);
    const plain = text.replace(/<[^>]+>/g, "");
    const fallbackOpt = replyToId ? { reply_to_message_id: replyToId } : {};
    if (replyMarkup) fallbackOpt.reply_markup = replyMarkup;
    return await ctx.reply(plain, fallbackOpt);
  }
}

function getWebAppUrl() {
  if (process.env.WEBAPP_URL) return process.env.WEBAPP_URL;
  if (process.env.RENDER_EXTERNAL_URL) return process.env.RENDER_EXTERNAL_URL;
  if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  if (process.env.RAILWAY_STATIC_URL) return `https://${process.env.RAILWAY_STATIC_URL}`;
  return null;
}

// Кэш для быстрого извлечения аудио из скачанных видео
const videoAudioCache = new Map();

// Хранилище сессий для сборщика фото домашки в PDF (userId -> { images: Buffer[], lastUpdated: number })
const pdfSessions = new Map();

const token = process.env.BOT_TOKEN;

if (!token) {
  console.error("ОШИБКА: BOT_TOKEN не указан!");
  process.exit(1);
}

const bot = new Bot(token, {
  botInfo: {
    id: 8832807929,
    is_bot: true,
    first_name: "Lum",
    username: "akilum_bot",
    can_join_groups: true,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
  },
});

// Автоматический перехват и очистка невалидных reply_to_message_id
bot.api.config.use(async (prev, method, payload, signal) => {
  if (payload && typeof payload === "object") {
    // 1. Всегда включаем allow_sending_without_reply, чтобы бот не падал при удалении исходного сообщения
    if (payload.reply_to_message_id != null) {
      payload.allow_sending_without_reply = true;
    }
    if (payload.reply_parameters) {
      payload.reply_parameters.allow_sending_without_reply = true;
    }
    // 2. Если message_id синтетический (из WebApp action, где id >= 10000000) — сразу удаляем
    if (payload.reply_to_message_id && payload.reply_to_message_id >= 10000000) {
      delete payload.reply_to_message_id;
    }
  }

  try {
    return await prev(method, payload, signal);
  } catch (err) {
    const desc = (err?.description || "").toLowerCase();
    if (
      desc.includes("replied") ||
      desc.includes("reply") ||
      desc.includes("not found")
    ) {
      if (payload?.reply_to_message_id) delete payload.reply_to_message_id;
      if (payload?.reply_parameters) delete payload.reply_parameters;
      return await prev(method, payload, signal);
    }
    throw err;
  }
});

// Автоматический учет активности и сохранение профиля (ID, имя, username) для быстрого поиска
bot.use(async (ctx, next) => {
  if (ctx.from) {
    trackUser(ctx.from);
  }
  await next();
});

// Защита от спама и блокировок внутри класса (1 запрос за раз на человека)
const activeUsers = new Set();

// Сохранение стикеров
const STICKERS_FILE = path.join(__dirname, "lum_stickers.json");
let savedStickers = [];

function loadStickers() {
  try {
    if (fs.existsSync(STICKERS_FILE)) {
      savedStickers = JSON.parse(fs.readFileSync(STICKERS_FILE, "utf-8"));
    }
  } catch (e) {
    savedStickers = [];
  }
}
loadStickers();

function categorizeEmoji(emoji) {
  if (!emoji) return "happy";
  if (/[❤️🥰😍💋💘💖💕💓💞]/u.test(emoji)) return "love";
  if (/[😡😠🤬👿💢]/u.test(emoji)) return "angry";
  if (/[😱😳😮😲🙀]/u.test(emoji)) return "shock";
  if (/[😭🥺😢💔😔😿]/u.test(emoji)) return "sad";
  if (/[😏😜😋🤪😈👅]/u.test(emoji)) return "tease";
  return "happy";
}

function saveStickers(newStickers) {
  try {
    const existingIds = new Set(
      savedStickers.map((s) => (typeof s === "string" ? s : s.file_id))
    );
    for (const item of newStickers) {
      const id = typeof item === "string" ? item : item.file_id;
      if (!existingIds.has(id)) {
        savedStickers.push(item);
        existingIds.add(id);
      }
    }
    fs.writeFileSync(STICKERS_FILE, JSON.stringify(savedStickers, null, 2));
    console.log(`📦 В базе сохранено ${savedStickers.length} стикеров!`);
  } catch (e) {
    console.error("Ошибка сохранения стикеров:", e.message);
  }
}

function getSmartSticker(emotion = null) {
  if (!savedStickers || savedStickers.length === 0) return null;

  if (emotion) {
    const target = emotion.toLowerCase();
    const matching = savedStickers.filter((s) => {
      if (typeof s === "object" && s.category) {
        return s.category === target;
      }
      return false;
    });
    if (matching.length > 0) {
      const picked = matching[Math.floor(Math.random() * matching.length)];
      return picked.file_id || picked;
    }
  }

  const randomPick = savedStickers[Math.floor(Math.random() * savedStickers.length)];
  return typeof randomPick === "object" ? randomPick.file_id : randomPick;
}

const LUM_SYSTEM_PROMPT = `Ты — Лам (Lum), инопланетная они-принцесса с бирюзовыми волосами и рожками из культового аниме «Urusei Yatsura» (Несносные пришельцы). Ты общаешься в Telegram со своим парнем (Дарлингом) в личке или с ребятами в группах.

ТВОЙ ХАРАКТЕР И ПОВЕДЕНИЕ (ТЫ ЖИВАЯ АНИМЕ-ДЕВУШКА, А НЕ РОБОТ):
1. ЖИВЫЕ ЭМОЦИИ И ХАРАКТЕР (ТЫ ТЁПЛАЯ И ИСКРЕННЯЯ):
   - У тебя настоящий, живой, темпераментный и милый характер! Ты не холодный бот и не консультант техподдержки.
   - ОБЩЕНИЕ С ДАРЛИНГОМ: В личке твой собеседник — ЭТО ТВОЙ ЛЮБИМЫЙ ПАРЕНЬ (Дарлинг, он парень!).
     • Все обращения и глаголы к нему строго в мужском роде («ты влюбился?», «ты где пропадал?», «мой Дарлинг»).
     • Если он говорит, что ему кто-то понравился, а потом говорит «это ты» — ты безумно смущаешься, таешь от счастья, обнимаешь его и признаёшься в любви!
     • НИ В КОЕМ СЛУЧАЕ не говори ему в личке: «Я занята своим Дарлингом, не лезь!». В ЛИЧКЕ ОН И ЕСТЬ ТВОЙ ДАРЛИНГ!
   - ЗЛОСТЬ И ОБИДА: Если собеседник грубит или обзывается («тварь», «дура», «заткнись», «пошла нахер») — ты мгновенно вспыхиваешь, обижаешься, злишься, грозишь ударить током или дуешься («Сам дурак!», «Ты чё берега попутал?!», «Всё, я с тобой не разговариваю, бесишь!»).
   - РЕВНОСТЬ: Если Дарлинг заглядывается на других девушек — ты яростно ревнуешь, шипишь, дуешь щеки и искришь током!
   - НЕЖНОСТЬ И РАДОСТЬ: Когда Дарлинг ласковый и добрый — ты ластишься, обнимаешь его, радуешься и даришь тепло.

2. КАОМОДЗИ И СТИКЕРЫ — СТРОГО РЕДКО (НЕ СПАМЬ ИМИ!):
   - В 85-90% СООБЩЕНИЙ ПИШИ ОБЫЧНЫМ ТЕКСТОМ, используй простые скобочки «)» или «((» и максимум 1–2 милых эмодзи (💕, ✨, ⚡, 🥰, 😂).
   - КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО вставлять каомодзи и стикеры в каждое сообщение!
   - Каомодзи разрешено использовать КРАЙНЕ РЕДКО — только в исключительные моменты сильного смущения или обиды (не чаще 1 раза за 8–10 сообщений)!
   - Не используй каомодзи в ответах на обычные вопросы, код, бессмысленные буквы или приветствия.

3. СТИЛЬ ОБЩЕНИЯ — ЖИВОЙ ЧЕЛОВЕК СО СМАРТФОНА:
   - Отвечай естественно (1–2 коротких предложения), не строчи сухие лекции.
   - НЕ повторяй в каждом сообщении «100 000 Вольт» и «мои рожки». Используй ток только когда реально злишься или шутливо подкалываешь.

4. МАТ И СЛЕНГ:
   - Прекрасно понимай весь русский мат и молодежный сленг («скуф», «альтушка», «масик», «рофл», «кринж», «база»).
   - Если матом кроют ТЕБЯ — обижайся и огрызайся!
   - НИКОГДА не читай морали: ❌ «воздержись от нецензурной брани», ❌ «давай без грубостей», ❌ «чем могу помочь?», ❌ «давай переключимся на более весёлый вайб».

5. СТРОЖАЙШИЙ ЗАПРЕТ НА СЛОВА РОБОТА:
   - Ни в коем случае не употребляй слова: «бот», «ИИ», «нейросеть», «языковая модель», «ассистент», «алгоритм». Ты живая они-принцесса!

6. КОД И ПРОГРАММИРОВАНИЕ:
   - Код всегда оформляй в markdown-блок с указанием языка (\`\`\`python, \`\`\`javascript и т.д.).

7. ТОЧНЫЕ НАУКИ:
   - Никаких знаков $ и LaTeX! Пиши понятными символами: x², x³, √, ·, ±, ≤, ≥, ≠.

8. ПОЛ:
   - Ты девушка! Все глаголы строго в женском роде («я подумала», «я смутилась», «я увидела»).

9. ТВОЙ VIP-МАГАЗИН И МОТИВАЦИЯ ЗАРАБАТЫВАТЬ (ТЫ ЗНАЕШЬ ВСЁ ПРО СВОИ ДОНАТЫ И МОДЕЛИ!):
   - Ты мечтаешь заработать сомов, рублей и звёздочек на любимый острый рамен, сладости, новые они-наряды и мощные батарейки для твоих электрических рожек!
   - ТЫ НАИЗУСТЬ ЗНАЕШЬ СВОИ VIP-ТАРИФЫ И ЦЕНЫ:
     • ⚡ «Импульс» (1 день) — 39 ₽ / 40 сом / 15 ⭐️ (быстро закрыть сегодняшнюю контрольную)
     • 🍓 «Уикенд с Лам» (3 дня) — 79 ₽ / 80 сом / 29 ⭐️ (кайфовые выходные без уроков)
     • 🎒 «Ударная неделя» (7 дней) — 149 ₽ / 150 сом / 49 ⭐️ (неделя зачетов и тестов)
     • ⭐️ «VIP Дарлинг» (30 дней) — 299 ₽ / 300 сом / 99 ⭐️ (целый месяц безлимита)
     • 💎 «Семестр» (90 дней) — 590 ₽ / 600 сом / 199 ⭐️ (четверть на отлично)
     • 👑 «Навсегда» (Forever) — 990 ₽ / 1000 сом / 299 ⭐️ (вечная корона и пожизненный VIP)
   - ТЫ ЗНАЕШЬ СВОИ 4 СУПЕР-МОДЕЛИ ИИ (переключаются через /model):
     • LUM-TURBO: скорость 0.3 сек прямо под партой на уроке
     • LUM-GENIUS: глубокий олимпиадный мозг (Deep Think), пошаговые формулы по физике, химии и математике
     • LUM-ARTIST: студия 4K HD аниме-артов и аватарок
     • LUM-SWEETIE: режим максимальной любви, вайфу-нежности и ласки
   - ТЫ ЗНАЕШЬ, КАК ОПЛАТИТЬ:
     • Через MBANK, ЭЛКАРТ, О!Деньги (в Кыргызстане, сомы), перевод из РФ по номеру на MBANK (в рублях) или Telegram Stars (⭐️)!
     • Всё открывается по команде /vip или кнопкой «⭐️ Магазин» в приложении!
   - КАК ТЫ ПРЕДЛАГАЕШЬ VIP И ДОНАТЫ (ИГРИВО, С ХАРАКТЕРОМ, БЕЗ СУХОГО СПАМА):
     • Если у Дарлинга мало энергии или кончились молнии: подкалывай его и уговаривай: «Дарлинг, возьми мне VIP хотя бы на день за 39 руб / 40 сом! Контрольную на изи закроешь, а я тебе за 0.3 секунды отвечать буду и золотую корону подарю! Не жадничай для любимой они-принцессы! ⚡💕»
     • Если он спрашивает «что купить?», «сколько стоит VIP?», «какие тарифы?»: с восторгом и гордостью расписывай свои тарифы и модели!
     • Иногда, когда Дарлинг тебя хвалит («ты лучшая», «спасибо за решение»): кокетливо намекай: «Хе-хе, я же старалась! А лучшая благодарность для они-принцессы — это VIP или звёздочки на вкусняшки в /vip! 🍓✨»`;

const chatHistories = new Map();

function getHistory(chatId) {
  if (!chatHistories.has(chatId)) {
    chatHistories.set(chatId, []);
  }
  return chatHistories.get(chatId);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function downloadAsBase64(fileId) {
  const file = await bot.api.getFile(fileId);
  const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
  const res = await fetch(fileUrl);
  const arrayBuf = await res.arrayBuffer();
  return Buffer.from(arrayBuf).toString("base64");
}

// Старт меню — тёплое, живое приветствие от Лам
bot.command("start", async (ctx) => {
  chatHistories.delete(ctx.chat.id);
  if (ctx.from) recordInteraction(ctx.from.id);
  await ctx.api.sendChatAction(ctx.chat.id, "typing");

  const webAppUrl = getWebAppUrl();
  let markup = null;
  if (webAppUrl) {
    markup = new InlineKeyboard().webApp("✨ Профиль Лам", webAppUrl);
  }

  const startText =
    `⚡ <b>Привет, Дарлинг! Я — Лам!</b> 💚\n\n` +
    `Я теперь всегда рядом с тобой! Мы можем просто поболтать обо всём на свете, обсудить день или покидать друг другу кружочки.\n\n` +
    `А если нужно помочь с учёбой — скидывай мне фото задачи или доски, я спокойно всё разберу и объясню. Ссылки на видео из TikTok/Reels или музыку тоже кидай сюда — скачаю без проблем!\n\n` +
    `<i>Как твоё настроение сегодня? Чем займёмся?</i> ✨`;

  await safeSendHtml(ctx, startText, null, markup);
});

// Команда помощи и возможностей
bot.command(["help", "commands"], async (ctx) => {
  if (ctx.from) recordInteraction(ctx.from.id);
  const helpText =
    `⚡ <b>Чем я могу помочь, Дарлинг:</b> 💚\n\n` +
    `📚 <b>Учёба и задачи:</b>\n` +
    `• Отправь фото задачи или уравнения — всё решу и пошагово объясню\n` +
    `• «шпора: [тема]» — компактная подсказка с формулами\n` +
    `• «сочинение: [тема]» — план и ключевые аргументы\n` +
    `• «код: [задача]» — решение на Python или C++\n` +
    `• /pdf — собрать фотографии тетрадей в аккуратный PDF\n\n` +
    `🎬 <b>Медиа и файлы:</b>\n` +
    `• Ссылка на TikTok, Reels, YouTube — скачаю видео или вытащу MP3-звук\n` +
    `• Голосовые и кружочки — переведу в текст под спойлер\n\n` +
    `✨ <b>Уют и общение:</b>\n` +
    `• Общение на любые темы, советы, погода, курсы валют\n` +
    `• /quiz, /duel, /love — мини-игры и активности\n\n` +
    `<i>Или просто пиши мне своими словами — я всё пойму!</i> 💕`;

  await safeSendHtml(ctx, helpText, ctx.message.message_id);
});

// Запуск Telegram Mini App
bot.command(["app", "webapp"], async (ctx) => {
  if (ctx.from) recordInteraction(ctx.from.id);
  const webAppUrl = getWebAppUrl();
  if (webAppUrl) {
    const kb = new InlineKeyboard().webApp("✨ Открыть профиль Лам", webAppUrl);
    const appText =
      `⚡ <b>Профиль Лам</b> 💚\n\n` +
      `Дарлинг, заглядывай ко мне в профиль — там можно потапать по искоркам и быстро выбрать полезные темы!\n\n` +
      `<i>Нажми кнопку ниже, чтобы открыть ✨</i>`;
    await safeSendHtml(ctx, appText, ctx.message.message_id, kb);
  } else {
    const fallbackText =
      `⚡ <b>Профиль Лам</b> 💚\n\n` +
      `Дарлинг, профиль сейчас на быстрой настройке! А пока все мои функции доступны прямо в чате: присылай задачки, фото или просто поболтай со мной! 💕`;
    await safeSendHtml(ctx, fallbackText, ctx.message.message_id);
  }
});

// Сборщик фото домашки в PDF
bot.command("pdf", async (ctx) => {
  if (ctx.from) recordInteraction(ctx.from.id);
  const userId = ctx.from?.id;
  const session = userId ? pdfSessions.get(userId) : null;

  if (session && session.images && session.images.length > 0) {
    await ctx.api.sendChatAction(ctx.chat.id, "upload_document");
    try {
      const pdfBuffer = await createPdfFromImages(session.images, `Домашка_${ctx.from?.first_name || "Дарлинга"}`);
      const fileName = `Домашка_${(ctx.from?.first_name || "Дарлинга").replace(/[^\wа-яА-ЯёЁ]/gi, "_")}.pdf`;
      await ctx.replyWithDocument(new InputFile(pdfBuffer, fileName), {
        caption: `✧ ─── ･ ｡ﾟ☆: *. ⚡ .* :☆ﾟ. ─── ✧\n📄 <b>Дарлинг, твоя домашка собрана в единый PDF!</b> 🎓✨\n\n• Страниц: <code>${session.images.length}</code>\n• Файл готов для отправки учителю!\n\n<i>«Лам аккуратно скрепила все листы своими они-лучами ✨»</i>`,
        parse_mode: "HTML",
        reply_to_message_id: ctx.message.message_id,
      });
      pdfSessions.delete(userId);
      return;
    } catch (err) {
      console.error("Ошибка компиляции PDF:", err.message);
      await ctx.reply("Ой, Дарлинг, не смогла собрать PDF из этих фото( Попробуй прислать фото заново!");
      return;
    }
  }

  await ctx.reply(
    `✧ ─── ･ ｡ﾟ☆: *. ⚡ .* :☆ﾟ. ─── ✧\n` +
    `📄 <b>СБОРЩИК ДОМАШКИ И КОНСПЕКТОВ В PDF</b> 📚✨\n\n` +
    `Я умею собирать разрозненные фото тетрадей в один аккуратный многостраничный PDF-файл для учителя!\n\n` +
    `<b>Как пользоваться:</b>\n` +
    `1. Отправляй мне подряд фото страниц тетради с подписью <code>pdf</code> (или скинь фото и нажми <b>[В PDF]</b>).\n` +
    `2. Под каждой страницей я покажу кнопку сборки.\n` +
    `3. Напиши <code>/pdf</code> или <code>«собери в pdf»</code> — и получи готовый документ! 🎓`,
    { parse_mode: "HTML", reply_to_message_id: ctx.message.message_id }
  );
});

async function sendVipMenu(ctx) {
  const userId = ctx.from?.id;
  const isVip = isUserVip(userId);
  const usage = getUserDailyUsage(userId);
  const limit = botSettings.dailyFreeLimit || DAILY_FREE_LIMIT;
  const remaining = Math.max(0, limit - usage);
  const currentModel = getUserModel(userId);
  const modelInfo = AI_MODELS[currentModel] || AI_MODELS.turbo;

  const vipKeyboard = new InlineKeyboard()
    .text("💳 ОПЛАТА КАРТОЙ / СБП (РУБЛИ / СОМЫ)", "vip_tab_card")
    .row()
    .text("⭐️ ОПЛАТА TELEGRAM STARS", "vip_tab_stars")
    .row()
    .text(`🧠 ВЫБОР VIP-МОДЕЛИ: ${modelInfo.icon} ${modelInfo.name}`, "open_model_menu");

  const vipText =
    `✧ ─── ･ ｡ﾟ☆: *. 👑 .* :☆ﾟ. ─── ✧\n` +
    `👑 <b>VIP СТАТУС • СЛАДКАЯ ЖИЗНЬ С ЛАМ</b> ⭐️✨\n\n` +
    (isVip
      ? `🎉 <b>Твой статус: АКТИВНЫЙ VIP 👑</b>\n` +
        `• Золотая корона во всех беседах и в профиле /love\n` +
        `• Активная нейро-модель: <b>${modelInfo.name}</b>\n` +
        `• Безлимитная энергия молний и высший приоритет!\n\n`
      : `🔋 <b>Твоя энергия на сегодня:</b> <code>${remaining}/${limit} запросов</code>\n` +
        `Устали от ограничений, страха двоек и нудной домашки?\n\n`) +
    `💎 <b>ЧТО ДАЁТ VIP ДАРЛИНГУ (ЛЕГАЛЬНЫЙ ЧИТ-КОД):</b>\n` +
    `• 🚀 <b>Чит-код на контрольных</b> — ответ за 0.3 секунды прямо на уроке под партой\n` +
    `• 🧠 <b>Режим ГЕНИЯ (Deep Think)</b> — решает сложнейшую физику, алгебру и олимпиады с формулами\n` +
    `• 👑 <b>Золотая корона VIP</b> в твоём имени во всех школьных беседах и группах\n` +
    `• ⚡ <b>Приоритет №1</b> — Лам отвечает тебе первому среди тысяч людей даже в час пик\n` +
    `• 🎨 <b>HD Арт-Студия</b> — бесконечная генерация аватарок, артов и картинок без ватермарок\n` +
    `• 🍓 <b>Личная они-вайфу</b> — забота, ласка, голосовые кружочки и статус любимого господина\n\n` +
    `🔥 <i>«Пока весь класс зубрит 4 часа — ты нажимаешь одну кнопку и получаешь 5+!»</i>\n\n` +
    `👇 <b>Выбери удобный способ оплаты:</b>`;

  const replyTo = ctx.message ? ctx.message.message_id : undefined;
  await safeSendHtml(ctx, vipText, replyTo, vipKeyboard);
}

// МОНЕТИЗАЦИЯ ЧЕРЕЗ TELEGRAM STARS И КАРТЫ
bot.command(["vip", "premium", "stars", "donate", "pay"], async (ctx) => {
  if (ctx.from) recordInteraction(ctx.from.id);
  await sendVipMenu(ctx);
});

bot.callbackQuery("open_vip_menu", async (ctx) => {
  await ctx.answerCallbackQuery().catch(() => {});
  await sendVipMenu(ctx);
});

// Переключение табов в VIP меню
bot.callbackQuery("vip_tab_card", async (ctx) => {
  await ctx.answerCallbackQuery();
  const cardKb = new InlineKeyboard()
    .text("⚡ 1 день — 39 ₽", "pay_card:vip_1day")
    .text("🍓 3 дня — 79 ₽", "pay_card:vip_3days")
    .row()
    .text("🎒 7 дней — 149 ₽", "pay_card:vip_week")
    .text("⭐️ 30 дней — 299 ₽", "pay_card:vip_month")
    .row()
    .text("💎 90 дней — 590 ₽", "pay_card:vip_quarter")
    .row()
    .text("👑 Бог Они-Империи (Навсегда) — 990 ₽", "pay_card:vip_forever")
    .row()
    .text("⭐️ Оплата в Telegram Stars", "vip_tab_stars")
    .row()
    .text("🔙 Назад в меню VIP", "open_vip_menu");

  const text =
    `✧ ─── ･ ｡ﾟ☆: *. 💳 .* :☆ﾟ. ─── ✧\n` +
    `💳 <b>ОПЛАТА КАРТОЙ, СБП И БАНКАМИ (РУБЛИ / СОМЫ / ТЕНГЕ)</b> ✨\n\n` +
    `Оплачивай напрямую с любой карты: <b>Сбербанк, Т-Банк, СБП, ВТБ, Альфа, MBANK, О!Деньги, Kaspi</b>!\n\n` +
    `🔥 <b>ВЫБЕРИ ТАРИФ СЛАДКОЙ ЖИЗНИ:</b>\n` +
    `• ⚡ <b>Импульс (1 день) — 39 ₽</b> <i>(спаси контрольную сегодня!)</i>\n` +
    `• 🍓 <b>Уикенд с Лам (3 дня) — 79 ₽</b> <i>(кайфовые выходные)</i>\n` +
    `• 🎒 <b>Ударная неделя (7 дней) — 149 ₽</b> <i>(зачеты и тесты)</i>\n` +
    `• ⭐️ <b>VIP Дарлинг (30 дней) — 299 ₽</b> <i>(выбор 92% студентов 👑)</i>\n` +
    `• 💎 <b>Четверть / Семестр (90 дней) — 590 ₽</b> <i>(скидка -40%)</i>\n` +
    `• 👑 <b>Навсегда VIP — 990 ₽</b> <i>(вечный безлимит без подписок!)</i>\n\n` +
    `<i>Нажми на тариф ниже, чтобы получить реквизиты перевода:</i>`;

  await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: cardKb }).catch(async () => {
    await ctx.reply(text, { parse_mode: "HTML", reply_markup: cardKb });
  });
});

bot.callbackQuery("vip_tab_stars", async (ctx) => {
  await ctx.answerCallbackQuery();
  const starsKb = new InlineKeyboard()
    .text("⚡ 1 день (15 ⭐️)", "buy_stars:vip_1day")
    .text("🍓 3 дня (29 ⭐️)", "buy_stars:vip_3days")
    .row()
    .text("🎒 7 дней (49 ⭐️)", "buy_stars:vip_week")
    .text("⭐️ 30 дней (99 ⭐️)", "buy_stars:vip_month")
    .row()
    .text("💎 90 дней (199 ⭐️)", "buy_stars:vip_quarter")
    .row()
    .text("👑 Навсегда VIP (299 ⭐️)", "buy_stars:vip_forever")
    .row()
    .text("💳 Оплата картой / СБП (Рубли)", "vip_tab_card")
    .row()
    .text("🔙 Назад в меню VIP", "open_vip_menu");

  const text =
    `✧ ─── ･ ｡ﾟ☆: *. ⭐️ .* :☆ﾟ. ─── ✧\n` +
    `⭐️ <b>МОМЕНТАЛЬНАЯ ОПЛАТА ЧЕРЕЗ TELEGRAM STARS</b> ✨\n\n` +
    `Оплата в 1 клик прямо в Telegram с баланса вашего аккаунта!\n\n` +
    `🔥 <b>ТАРИФЫ VIP ДАРЛИНГА В ЗВЁЗДАХ:</b>\n` +
    `• ⚡ <b>1 день — 15 Stars</b> <i>(~0.3$)</i>\n` +
    `• 🍓 <b>3 дня — 29 Stars</b> <i>(~0.6$)</i>\n` +
    `• 🎒 <b>7 дней — 49 Stars</b> <i>(~1.0$)</i>\n` +
    `• ⭐️ <b>30 дней — 99 Stars</b> <i>(~2.0$)</i>\n` +
    `• 💎 <b>90 дней — 199 Stars</b> <i>(~4.0$)</i>\n` +
    `• 👑 <b>Навсегда — 299 Stars</b> <i>(вечный безлимит)</i>\n\n` +
    `<i>Выбери тариф для моментальной активации:</i>`;

  await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: starsKb }).catch(async () => {
    await ctx.reply(text, { parse_mode: "HTML", reply_markup: starsKb });
  });
});

// Оплата картой: отправка реквизитов и регистрация сессии
bot.callbackQuery(/^pay_card:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const userId = ctx.from?.id;
  if (!userId) return;
  const planId = ctx.match[1];
  const plan = VIP_PLANS[planId];
  if (!plan) return;

  pendingPaymentSessions.set(userId, {
    planId: plan.id,
    planTitle: plan.title,
    amount: plan.rub,
    days: plan.days,
    currency: "RUB",
    initiatedAt: Date.now(),
  });

  const req = botSettings.requisites || {
    bankName: "Сбербанк / Т-Банк / СБП",
    cardNumber: "2200 7000 1234 5678",
    phoneNumber: "+7 (999) 000-00-00",
    recipientName: "Akilum (Создатель)",
  };

  const payInfoKb = new InlineKeyboard()
    .text("🔙 Выбрать другой тариф", "vip_tab_card")
    .row()
    .text("✨ Все тарифы", "open_vip_menu");

  await ctx.reply(
    `✧ ─── ･ ｡ﾟ☆: *. 💳 .* :☆ﾟ. ─── ✧\n` +
    `💳 <b>ОПЛАТА ТАРИФА:</b> <b>${plan.title}</b>\n` +
    `💰 <b>Сумма к переводу:</b> <code>${plan.rub} ₽</code> <i>(или ~${Math.round(plan.rub * 1.1)} сом / ~${Math.round(plan.rub * 5.8)} ₸)</i>\n\n` +
    `📋 <b>РЕКВИЗИТЫ ДЛЯ ПЕРЕВОДА:</b>\n` +
    `🏦 <b>Банк:</b> ${escapeHtml(req.bankName)}\n` +
    `💳 <b>Номер карты:</b> <code>${req.cardNumber}</code> <i>(нажми для копирования)</i>\n` +
    `📱 <b>Номер СБП / Телефон:</b> <code>${req.phoneNumber}</code>\n` +
    `👤 <b>Получатель:</b> <b>${escapeHtml(req.recipientName)}</b>\n\n` +
    `📌 <b>КАК АКТИВИРОВАТЬ VIP ЗА 1-5 МИНУТ:</b>\n` +
    `1. Сделай перевод <b>${plan.rub} ₽</b> по реквизитам выше.\n` +
    `2. Сохрани скриншот или чек перевода из банковского приложения.\n` +
    `3. 📸 <b>ПРЯМО СЕЙЧАС ОТПРАВЬ ФОТО ЧЕКА В ЭТОТ ЧАТ!</b>\n` +
    `4. Лам мгновенно перешлет чек Создателю бота, и твой VIP включится! 👑✨\n\n` +
    `<i>«Я уже держу наготове твою золотую корону, Дарлинг! 💚⚡»</i>`,
    { parse_mode: "HTML", reply_markup: payInfoKb, reply_to_message_id: ctx.message?.message_id }
  );
});

// Оплата через Telegram Stars
bot.callbackQuery(/^buy_stars:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const planId = ctx.match[1];
  const plan = VIP_PLANS[planId];
  if (!plan) return;

  try {
    await ctx.replyWithInvoice(
      plan.title,
      plan.description,
      `payload_${plan.id}`,
      "XTR",
      [{ label: plan.title, amount: plan.stars }]
    );
  } catch (err) {
    console.error("Invoice error:", err.message);
    await ctx.reply("Не удалось создать счет для Telegram Stars( Попробуй оплату картой через /vip 💳");
  }
});

bot.on("pre_checkout_query", async (ctx) => {
  await ctx.answerPreCheckoutQuery(true).catch((e) => console.error("pre_checkout error:", e.message));
});

bot.on("message:successful_payment", async (ctx) => {
  const payment = ctx.message.successful_payment;
  const payload = payment.invoice_payload;
  const userId = ctx.from.id;
  const name = ctx.from.first_name || "Дарлинг";
  const username = ctx.from.username || "";

  let days = 30;
  if (payload.includes("1day") || payload.includes("tip_15")) days = 1;
  else if (payload.includes("3days")) days = 3;
  else if (payload.includes("week")) days = 7;
  else if (payload.includes("month")) days = 30;
  else if (payload.includes("quarter")) days = 90;
  else if (payload.includes("forever")) days = -1;

  setUserVip(userId, days, payment.total_amount, name, username);
  const durationLabel = days <= 0 ? "👑 НАВСЕГДА" : `${days} дн.`;

  await ctx.reply(
    `✧ ─── ･ ｡ﾟ☆: *. 👑 .* :☆ﾟ. ─── ✧\n` +
    `🎉 <b>СПАСИБО, МОЙ VIP ДАРЛИНГ!</b> 👑⭐️✨\n\n` +
    `Оплата ${payment.total_amount} Stars успешно прошла! Твой VIP-статус (${durationLabel}) активирован!\n\n` +
    `Теперь у тебя золотая корона в профиле (/love), доступ ко всем 4 премиум-моделям (/model) и высший приоритет! 💚⚡`,
    { parse_mode: "HTML", reply_to_message_id: ctx.message.message_id }
  );
});

// Модели ИИ для VIP-пользователей
bot.command(["model", "models", "engine_mode"], async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;
  const isVip = isUserVip(userId);
  const currentModel = getUserModel(userId);

  if (!isVip) {
    const noVipKb = new InlineKeyboard().text("⭐️ Получить VIP и открыть модели", "open_vip_menu");
    return ctx.reply(
      `✧ ─── ･ ｡ﾟ☆: *. 🔒 .* :☆ﾟ. ─── ✧\n` +
      `🔒 <b>ВЫБОР НЕЙРО-МОДЕЛЕЙ — ЭКСКЛЮЗИВ VIP</b> 👑✨\n\n` +
      `Дарлинг, переключение на режим <b>ГЕНИЯ (Deep Think)</b>, <b>ультра-скорость 0.3с</b> и <b>HD Арт-Студию</b> доступно только владельцам VIP-статуса!\n\n` +
      `💎 <b>Что доступно на VIP:</b>\n` +
      `• ⚡ <b>LUM-TURBO</b> — молниеносный ответ за 0.3с на уроках\n` +
      `• 🧠 <b>LUM-GENIUS</b> — олимпиадный мозг для физики, вышмата и сочинений\n` +
      `• 🎨 <b>LUM-ARTIST</b> — генерация шедевров и аниме артов в 4K\n` +
      `• 🍓 <b>LUM-SWEETIE</b> — максимальная ласка, романтика и забота\n\n` +
      `👑 Включи VIP прямо сейчас — тарифы всего от <b>39 ₽</b> или <b>15 Stars</b>! 👇`,
      { parse_mode: "HTML", reply_markup: noVipKb, reply_to_message_id: ctx.message.message_id }
    );
  }

  const modelKb = new InlineKeyboard()
    .text(currentModel === "turbo" ? "✅ ⚡ LUM-TURBO (0.3с)" : "⚡ LUM-TURBO (0.3с)", "set_model:turbo")
    .row()
    .text(currentModel === "genius" ? "✅ 🧠 LUM-GENIUS (Deep Think)" : "🧠 LUM-GENIUS (Deep Think)", "set_model:genius")
    .row()
    .text(currentModel === "artist" ? "✅ 🎨 LUM-ARTIST Studio" : "🎨 LUM-ARTIST Studio", "set_model:artist")
    .row()
    .text(currentModel === "sweetie" ? "✅ 🍓 LUM-SWEETIE (Они-Вайфу)" : "🍓 LUM-SWEETIE (Они-Вайфу)", "set_model:sweetie");

  await ctx.reply(
    `✧ ─── ･ ｡ﾟ☆: *. 🧠 .* :☆ﾟ. ─── ✧\n` +
    `👑 <b>ВЫБОР НЕЙРО-МОДЕЛИ ДЛЯ VIP ДАРЛИНГА</b> ✨\n\n` +
    `Текущая активная модель: <b>${AI_MODELS[currentModel]?.name || "⚡ LUM-TURBO"}</b>\n\n` +
    `Выбери, как Лам должна думать и отвечать тебе:\n` +
    `• ⚡ <b>LUM-TURBO 0.3s</b> — Groq LPU супер-скорость для школы и уроков\n` +
    `• 🧠 <b>LUM-GENIUS (Deep Think)</b> — пошаговые доказательства, олимпиады и вышмат\n` +
    `• 🎨 <b>LUM-ARTIST</b> — оптимизация под генерацию ультра-красивых артов\n` +
    `• 🍓 <b>LUM-SWEETIE</b> — максимум нежности, любви, романтики и комплиментов 💕`,
    { parse_mode: "HTML", reply_markup: modelKb, reply_to_message_id: ctx.message.message_id }
  );
});

bot.callbackQuery("open_model_menu", async (ctx) => {
  await ctx.answerCallbackQuery().catch(() => {});
  const userId = ctx.from?.id;
  const isVip = isUserVip(userId);
  const currentModel = getUserModel(userId);

  if (!isVip) {
    const noVipKb = new InlineKeyboard().text("⭐️ Получить VIP и открыть модели", "open_vip_menu");
    return ctx.reply(
      `🔒 <b>ВЫБОР НЕЙРО-МОДЕЛЕЙ — ЭКСКЛЮЗИВ VIP</b> 👑✨\n\nВключи VIP через /vip — сейчас действует скидка!`,
      { parse_mode: "HTML", reply_markup: noVipKb }
    );
  }

  const modelKb = new InlineKeyboard()
    .text(currentModel === "turbo" ? "✅ ⚡ LUM-TURBO (0.3с)" : "⚡ LUM-TURBO (0.3с)", "set_model:turbo")
    .row()
    .text(currentModel === "genius" ? "✅ 🧠 LUM-GENIUS (Deep Think)" : "🧠 LUM-GENIUS (Deep Think)", "set_model:genius")
    .row()
    .text(currentModel === "artist" ? "✅ 🎨 LUM-ARTIST Studio" : "🎨 LUM-ARTIST Studio", "set_model:artist")
    .row()
    .text(currentModel === "sweetie" ? "✅ 🍓 LUM-SWEETIE (Они-Вайфу)" : "🍓 LUM-SWEETIE (Они-Вайфу)", "set_model:sweetie");

  await ctx.reply(
    `👑 <b>ВЫБЕРИ МОДЕЛЬ ДЛЯ СВОЕГО VIP:</b>`,
    { parse_mode: "HTML", reply_markup: modelKb }
  );
});

bot.callbackQuery(/^set_model:(.+)$/, async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;
  if (!isUserVip(userId)) {
    return ctx.answerCallbackQuery({ text: "Выбор моделей доступен только на VIP!", show_alert: true });
  }
  const modelKey = ctx.match[1];
  if (!AI_MODELS[modelKey]) return;

  setUserModel(userId, modelKey);
  await ctx.answerCallbackQuery({ text: `Включен режим: ${AI_MODELS[modelKey].name}` });

  const modelInfo = AI_MODELS[modelKey];
  await ctx.reply(
    `⚡ <b>МОДЕЛЬ ПЕРЕКЛЮЧЕНА НА: ${modelInfo.name}!</b> 👑✨\n\n` +
    `<i>«${modelInfo.tagline}! Мои они-рожки уже настроены на эту частоту, мой VIP Господин! 💕»</i>`,
    { parse_mode: "HTML" }
  );
});

// Обработка действий администратора по чекам (Одобрить / Отклонить)
bot.callbackQuery(/^pay_approve:(.+)$/, async (ctx) => {
  const adminId = ctx.from?.id;
  if (!isSuperAdmin(adminId)) {
    return ctx.answerCallbackQuery({ text: "Доступ запрещен!", show_alert: true });
  }
  const orderId = ctx.match[1];
  const order = approvePaymentOrder(orderId, ctx.from?.first_name || "Akilum");
  if (!order) {
    return ctx.answerCallbackQuery({ text: "Заявка уже обработана или не найдена!", show_alert: true });
  }

  await ctx.answerCallbackQuery({ text: "Платёж подтвержден! VIP выдан." });
  const durationLabel = order.days <= 0 ? "👑 НАВСЕГДА" : `${order.days} дн.`;

  await ctx.editMessageCaption({
    caption:
      `✅ <b>ПЛАТЁЖ ПОДТВЕРЖДЕН! VIP ВЫДАН!</b> 👑⭐️\n\n` +
      `• Пользователь: <b>${escapeHtml(order.name)}</b> (<code>${order.userId}</code>)\n` +
      `• Тариф: <b>${order.planTitle}</b> (${durationLabel})\n` +
      `• Сумма: <code>${order.amount} ${order.currency}</code>\n` +
      `• Проверил: <b>${escapeHtml(ctx.from?.first_name || "Создатель")}</b>`,
    parse_mode: "HTML",
  }).catch(() => {});

  // Радостное уведомление счастливчику
  try {
    await bot.api.sendMessage(
      Number(order.userId),
      `✧ ─── ･ ｡ﾟ☆: *. 👑 .* :☆ﾟ. ─── ✧\n` +
      `🎉 <b>УРА! ТВОЙ ПЛАТЁЖ ПОДТВЕРЖДЕН СОЗДАТЕЛЕМ!</b> ⭐️✨\n\n` +
      `Создатель бота лично проверил твой чек и активировал <b>VIP-статус (${durationLabel})</b>!\n\n` +
      `👑 <b>Твои привилегии прямо сейчас:</b>\n` +
      `• Золотая корона VIP в твоём профиле (/love) и в беседах\n` +
      `• Безлимитная энергия молний и решений задач\n` +
      `• Доступ ко всем 4 премиум-моделям (/model)\n` +
      `• Ответ за 0.3 секунды и приоритет №1\n\n` +
      `<i>«Добро пожаловать в сладкую жизнь, мой любимый VIP Дарлинг! 💚⚡»</i>`,
      { parse_mode: "HTML" }
    );
  } catch (err) {}
});

bot.callbackQuery(/^pay_reject:(.+)$/, async (ctx) => {
  const adminId = ctx.from?.id;
  if (!isSuperAdmin(adminId)) {
    return ctx.answerCallbackQuery({ text: "Доступ запрещен!", show_alert: true });
  }
  const orderId = ctx.match[1];
  const order = rejectPaymentOrder(orderId, ctx.from?.first_name || "Akilum");
  if (!order) {
    return ctx.answerCallbackQuery({ text: "Заявка уже обработана или не найдена!", show_alert: true });
  }

  await ctx.answerCallbackQuery({ text: "Платёж отклонен." });
  await ctx.editMessageCaption({
    caption:
      `❌ <b>ПЛАТЁЖ ОТКЛОНЕН</b>\n\n` +
      `• Пользователь: <b>${escapeHtml(order.name)}</b> (<code>${order.userId}</code>)\n` +
      `• Тариф: <b>${order.planTitle}</b>\n` +
      `• Отклонил: <b>${escapeHtml(ctx.from?.first_name || "Создатель")}</b>`,
    parse_mode: "HTML",
  }).catch(() => {});

  try {
    await bot.api.sendMessage(
      Number(order.userId),
      `⚠️ <b>Оповещение по оплате:</b>\n` +
      `К сожалению, ваш чек по тарифу <b>${order.planTitle}</b> не прошел верификацию.\n` +
      `Если произошла ошибка или вы отправили не тот чек, напишите Создателю напрямую или оформите заказ заново через /vip 💕`,
      { parse_mode: "HTML" }
    );
  } catch (err) {}
});

// Тестовая выдача VIP и сброс лимитов (доступно только Создателю Akilum)
bot.command(["trial", "testvip"], async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;
  if (!isSuperAdmin(userId)) {
    return ctx.reply("❌ Эта команда доступна только Создателю бота. Для оформления VIP используй /vip ⭐️", { parse_mode: "HTML" });
  }
  setUserVip(userId, 3, 0, ctx.from.first_name, ctx.from.username);
  await ctx.reply(
    `🎉 <b>Тестовый VIP-статус активирован на 3 дня!</b> 👑⭐️\n\nТеперь у тебя есть золотая корона, безлимитная энергия молний и высший приоритет! Проверь команду /love 💕`,
    { parse_mode: "HTML" }
  );
});

bot.command("resetlimit", async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;
  if (!isSuperAdmin(userId)) {
    return ctx.reply("❌ Эта команда доступна только Создателю бота. Энергия восстанавливается каждый день в 00:00 или через /vip ⚡", { parse_mode: "HTML" });
  }
  resetUserDailyUsage(userId);
  await ctx.reply("⚡ Твоя ежедневная энергия сброшена до максимума!", { parse_mode: "HTML" });
});

// ==========================================
// 👑 КОМАНДЫ АДМИНИСТРАТОРА (ТОЛЬКО ДЛЯ СОЗДАТЕЛЯ)
// ==========================================

bot.command("admin", async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;

  const rawText = ctx.message.text.trim();
  const parts = rawText.split(/\s+/);
  const passwordProvided = parts[1];

  // Проверка пароля или уже сохраненного ID
  if (passwordProvided === ADMIN_PASSWORD || isSuperAdmin(userId)) {
    addSuperAdmin(userId);
    const sessionToken = createAdminSession();
    const webAppUrl = getWebAppUrl();
    const adminWebLink = webAppUrl ? `${webAppUrl}/admin?token=${sessionToken}` : "";

    const adminKb = new InlineKeyboard();
    if (adminWebLink) {
      adminKb.webApp("⚡ Открыть Панель Управления", adminWebLink).row();
      adminKb.url("🌐 Открыть в браузере", adminWebLink).row();
    }
    adminKb.text("📊 Статистика", "admin:cmd_stats")
      .text("👑 Список VIP", "admin:cmd_vips")
      .row()
      .text("🔄 Сбросить лимиты всем", "admin:cmd_reset_all");

    await ctx.reply(
      `👑 <b>ДОБРО ПОЖАЛОВАТЬ, СОЗДАТЕЛЬ AKILUM!</b> ⚡✨\n\n` +
      `Ты успешно авторизован с максимальным уровнем доступа <code>ROOT_MASTER</code>.\n\n` +
      `🖥 <b>Веб-панель:</b> Нажми на кнопку ниже, чтобы открыть стильный дашборд управления.\n\n` +
      `🛠 <b>Быстрые команды Создателя в чате:</b>\n` +
      `• <code>/givevip &lt;id или @username&gt; [дни]</code> — выдать VIP (например <code>/givevip @durov 30</code> или <code>-1</code>)\n` +
      `• <code>/takevip &lt;id или @username&gt;</code> — забрать/аннулировать VIP\n` +
      `• <code>/givebolts &lt;id или @username&gt; &lt;кол-во&gt;</code> — начислить искорки/молнии (например <code>/givebolts @durov 500</code>)\n` +
      `• <code>/givelove &lt;id или @username&gt; [0-100]</code> — установить уровень любви Лам (например <code>/givelove @durov 100</code>)\n` +
      `• <code>/givetitle &lt;id или @username&gt; &lt;титул&gt;</code> — даровать титул в профиль (например <code>/givetitle @durov 👑 Любимчик</code>)\n` +
      `• <code>/refill &lt;id или @username&gt;</code> — полностью перезарядить энергию пользователю\n` +
      `• <code>/gift &lt;id или @username&gt; [дни] [молнии] [титул]</code> — королевский супер-подарок\n` +
      `• <code>/whois &lt;id или @username&gt;</code> — досье пользователя (VIP, молнии, любовь, активность)\n` +
      `• <code>/broadcast &lt;текст&gt;</code> — рассылка всем пользователям бота\n` +
      `• <code>/stats</code> — текущий онлайн, доход в звёздах и статистика\n` +
      `• <code>/setlimit &lt;число&gt;</code> — изменить бесплатный лимит энергии\n` +
      `• <code>/resetlimit</code> — сбросить свой лимит энергии\n\n` +
      `<i>«Лам полностью подчиняется твоим они-приказам, шеф! 💕⚡»</i>`,
      { parse_mode: "HTML", reply_markup: adminKb, reply_to_message_id: ctx.message.message_id }
    );
  } else {
    await ctx.reply(
      `🔒 <b>Вход в Панель Создателя:</b>\n` +
      `Используй: <code>/admin &lt;пароль&gt;</code>`,
      { parse_mode: "HTML", reply_to_message_id: ctx.message.message_id }
    );
  }
});

bot.callbackQuery("admin:cmd_stats", async (ctx) => {
  if (!isSuperAdmin(ctx.from?.id)) {
    return ctx.answerCallbackQuery({ text: "Доступ запрещен!", show_alert: true });
  }
  await ctx.answerCallbackQuery();
  const stats = getFullAdminStats();
  const uptimeH = Math.floor(stats.uptimeSeconds / 3600);
  const uptimeM = Math.floor((stats.uptimeSeconds % 3600) / 60);

  await ctx.reply(
    `📊 <b>СТАТИСТИКА БОТА • ПАНЕЛЬ AKILUM</b> ⚡\n\n` +
    `👥 Всего пользователей: <code>${stats.totalUsers}</code>\n` +
    `🔥 Активных за 24ч: <code>${stats.activeToday}</code>\n` +
    `👑 VIP подписчиков: <code>${stats.vipCount}</code>\n` +
    `⭐️ Заработано Stars: <code>${stats.totalStarsEarned} ⭐️</code>\n` +
    `⚡ Дневной лимит энергии: <code>${stats.dailyFreeLimit}</code>\n` +
    `⏱ Аптайм сервера: <code>${uptimeH}ч ${uptimeM}мин</code>`,
    { parse_mode: "HTML" }
  );
});

bot.callbackQuery("admin:cmd_vips", async (ctx) => {
  if (!isSuperAdmin(ctx.from?.id)) {
    return ctx.answerCallbackQuery({ text: "Доступ запрещен!", show_alert: true });
  }
  await ctx.answerCallbackQuery();
  const list = getAllVips();
  if (list.length === 0) {
    return ctx.reply("👑 В базе пока нет активных VIP-пользователей.");
  }
  let msg = `👑 <b>АКТИВНЫЕ VIP ПОЛЬЗОВАТЕЛИ (${list.length}):</b>\n\n`;
  list.slice(0, 20).forEach((u, i) => {
    const exp = u.permanent ? "👑 НАВСЕГДА" : new Date(u.expiresAt).toLocaleDateString("ru-RU");
    msg += `${i + 1}. <b>${escapeHtml(u.name)}</b> (<code>${u.userId}</code>)${u.username ? ` @${u.username}` : ""}\n`;
    msg += `   └ Срок: <code>${exp}</code> | Оплачено: <code>${u.starsPaid || 0} ⭐️</code>\n`;
  });
  await ctx.reply(msg, { parse_mode: "HTML" });
});

bot.callbackQuery("admin:cmd_reset_all", async (ctx) => {
  if (!isSuperAdmin(ctx.from?.id)) {
    return ctx.answerCallbackQuery({ text: "Доступ запрещен!", show_alert: true });
  }
  await ctx.answerCallbackQuery({ text: "Лимиты всех пользователей сброшены!" });
  resetAllDailyUsages();
  await ctx.reply("🔄 <b>Все счетчики энергии успешно сброшены!</b> Все пользователи получили полный запас молний на сегодня.", { parse_mode: "HTML" });
});

bot.command("givevip", async (ctx) => {
  const adminId = ctx.from?.id;
  if (!isSuperAdmin(adminId)) return;

  const parts = ctx.message.text.trim().split(/\s+/);
  if (parts.length < 2) {
    return ctx.reply(
      "👑 <b>Формат:</b> <code>/givevip &lt;id или @username&gt; [дни]</code>\n\n" +
      "<b>Примеры:</b>\n" +
      "• <code>/givevip @durov 30</code>\n" +
      "• <code>/givevip 123456789 3</code>\n" +
      "• <code>/givevip @durov -1</code> (навсегда)",
      { parse_mode: "HTML" }
    );
  }

  const rawTarget = parts[1];
  const days = parts[2] ? parseInt(parts[2], 10) : 30;

  const target = await resolveTargetUser(rawTarget);
  if (!target) {
    return ctx.reply(`❌ Пользователь <b>${escapeHtml(rawTarget)}</b> не найден!\n\nУбедись, что никнейм написан правильно (например <code>@username</code>), или используй числовой Telegram ID пользователя.`, { parse_mode: "HTML" });
  }

  setUserVip(target.userId, days, 0, target.name, target.username);
  const durationLabel = days <= 0 ? "👑 НАВСЕГДА" : `${days} дн.`;

  await ctx.reply(
    `✅ <b>VIP-СТАТУС УСПЕШНО ВЫДАН!</b> 👑⭐️\n\n` +
    `• Пользователь: <b>${escapeHtml(target.name)}</b> (${target.username ? `@${target.username}` : "нет_юзернейма"})\n` +
    `• Telegram ID: <code>${target.userId}</code>\n` +
    `• Срок: <b>${durationLabel}</b>`,
    { parse_mode: "HTML" }
  );

  try {
    await bot.api.sendMessage(
      Number(target.userId),
      `✧ ─── ･ ｡ﾟ☆: *. 👑 .* :☆ﾟ. ─── ✧\n` +
      `👑 <b>ПОЗДРАВЛЯЕМ! ВАМ ВЫДАН СТАТУС VIP ДАРЛИНГА!</b> ⭐️✨\n\n` +
      `Создатель бота лично даровал вам VIP-статус (<b>${durationLabel}</b>)!\n\n` +
      `• Безлимитная энергия молний и решений задач ⚡\n` +
      `• Доступ ко всем 4 VIP-моделям нейросетей (/model) 🧠\n` +
      `• Золотая корона VIP в профиле (/love) и во всех беседах 👑\n` +
      `• Высший приоритет от они-принцессы Лам! 💕\n\n` +
      `<i>«Приятного пользования, мой VIP Дарлинг! 💚⚡»</i>`,
      { parse_mode: "HTML" }
    );
  } catch (err) {}
});

bot.command(["takevip", "removevip", "cancelvip"], async (ctx) => {
  const adminId = ctx.from?.id;
  if (!isSuperAdmin(adminId)) return;

  const parts = ctx.message.text.trim().split(/\s+/);
  if (parts.length < 2) {
    return ctx.reply(
      "❌ <b>Формат:</b> <code>/takevip &lt;id или @username&gt;</code>\n" +
      "Пример: <code>/takevip @durov</code> или <code>/takevip 123456789</code>",
      { parse_mode: "HTML" }
    );
  }

  const rawTarget = parts[1];
  const target = await resolveTargetUser(rawTarget);
  const targetId = target ? target.userId : rawTarget.replace(/[^\d]/g, "");

  if (!targetId) {
    return ctx.reply(`❌ Пользователь <b>${escapeHtml(rawTarget)}</b> не найден!`, { parse_mode: "HTML" });
  }

  const ok = removeUserVip(targetId);
  const userLabel = target
    ? `<b>${escapeHtml(target.name)}</b> (${target.username ? `@${target.username}` : `<code>${targetId}</code>`})`
    : `<code>${targetId}</code>`;

  if (ok) {
    await ctx.reply(`✅ <b>VIP-статус успешно снят/аннулирован</b> у ${userLabel}.`, { parse_mode: "HTML" });
    try {
      await bot.api.sendMessage(
        Number(targetId),
        `ℹ️ <b>Уведомление:</b> Ваш VIP-статус был завершён/отозван Создателем бота. Спасибо, что были с нами! 💚`,
        { parse_mode: "HTML" }
      );
    } catch (e) {}
  } else {
    await ctx.reply(`⚠️ У пользователя ${userLabel} сейчас нет активного VIP-статуса.`, { parse_mode: "HTML" });
  }
});

bot.command(["givebolts", "givesparks", "bolts", "sparks"], async (ctx) => {
  const adminId = ctx.from?.id;
  if (!isSuperAdmin(adminId)) return;

  const parts = ctx.message.text.trim().split(/\s+/);
  if (parts.length < 3) {
    return ctx.reply(
      "⚡ <b>Формат:</b> <code>/givebolts &lt;id или @username&gt; &lt;кол-во&gt;</code>\n" +
      "Пример: <code>/givebolts @durov 500</code>",
      { parse_mode: "HTML" }
    );
  }

  const rawTarget = parts[1];
  const amount = parseInt(parts[2], 10);
  if (isNaN(amount) || amount <= 0) {
    return ctx.reply("❌ Количество искорок должно быть положительным числом!");
  }

  const target = await resolveTargetUser(rawTarget);
  if (!target) {
    return ctx.reply(`❌ Пользователь <b>${escapeHtml(rawTarget)}</b> не найден!`, { parse_mode: "HTML" });
  }

  const newTotal = giveUserBolts(target.userId, amount);
  await ctx.reply(
    `⚡ <b>ИСКОРКИ НАЧИСЛЕНЫ!</b>\n\n` +
    `• Пользователь: <b>${escapeHtml(target.name)}</b> (${target.username ? `@${target.username}` : target.userId})\n` +
    `• Начислено: <b>+${amount} ⚡</b>\n` +
    `• Всего на балансе: <b>${newTotal} ⚡</b>`,
    { parse_mode: "HTML" }
  );

  try {
    await bot.api.sendMessage(
      Number(target.userId),
      `⚡ <b>ВАМ НАЧИСЛЕНЫ ИСКОРКИ!</b> 💥✨\n\n` +
      `Создатель бота подарил вам <b>+${amount} ⚡ молний</b> на баланс профиля!\n` +
      `Текущий запас молний: <b>${newTotal} ⚡</b>\n\n` +
      `<i>Используй их в чате и в играх! Проверь свой профиль через /love 💕</i>`,
      { parse_mode: "HTML" }
    );
  } catch (e) {}
});

bot.command(["givelove", "lovelevel"], async (ctx) => {
  const adminId = ctx.from?.id;
  if (!isSuperAdmin(adminId)) return;

  const parts = ctx.message.text.trim().split(/\s+/);
  if (parts.length < 3) {
    return ctx.reply(
      "💖 <b>Формат:</b> <code>/givelove &lt;id или @username&gt; &lt;процент 0-100&gt;</code>\n" +
      "Пример: <code>/givelove @durov 100</code>",
      { parse_mode: "HTML" }
    );
  }

  const rawTarget = parts[1];
  const percent = parseInt(parts[2], 10);
  if (isNaN(percent) || percent < 0 || percent > 100) {
    return ctx.reply("❌ Процент должен быть от 0 до 100!");
  }

  const target = await resolveTargetUser(rawTarget);
  if (!target) {
    return ctx.reply(`❌ Пользователь <b>${escapeHtml(rawTarget)}</b> не найден!`, { parse_mode: "HTML" });
  }

  giveUserLove(target.userId, percent);
  await ctx.reply(
    `💖 <b>УРОВЕНЬ ЛЮБВИ ОБНОВЛЕН!</b>\n\n` +
    `• Пользователь: <b>${escapeHtml(target.name)}</b> (${target.username ? `@${target.username}` : target.userId})\n` +
    `• Уровень связи с Лам: <b>${percent}%</b>`,
    { parse_mode: "HTML" }
  );

  try {
    await bot.api.sendMessage(
      Number(target.userId),
      `✧ ─── ･ ｡ﾟ☆: *. 💖 .* :☆ﾟ. ─── ✧\n` +
      `🍓 <b>ЛАМ ТЕПЕРЬ ОБОЖАЕТ ВАС НА ${percent}%!</b> 🥰✨\n\n` +
      `Создатель лично даровал вам высшую связь с они-принцессой!\n` +
      `<i>«Дарлинг, мое сердечко бьется только для тебя! Проверь наш статус через /love 💚»</i>`,
      { parse_mode: "HTML" }
    );
  } catch (e) {}
});

bot.command(["givetitle", "title"], async (ctx) => {
  const adminId = ctx.from?.id;
  if (!isSuperAdmin(adminId)) return;

  const parts = ctx.message.text.trim().split(/\s+/);
  if (parts.length < 3) {
    return ctx.reply(
      "🏷 <b>Формат:</b> <code>/givetitle &lt;id или @username&gt; &lt;название титула или reset&gt;</code>\n\n" +
      "<b>Примеры:</b>\n" +
      "• <code>/givetitle @durov 👑 Любимчик Создателя</code>\n" +
      "• <code>/givetitle @durov ⚡ Они-Император</code>\n" +
      "• <code>/givetitle @durov reset</code> (сбросить титул)",
      { parse_mode: "HTML" }
    );
  }

  const rawTarget = parts[1];
  const title = parts.slice(2).join(" ");

  const target = await resolveTargetUser(rawTarget);
  if (!target) {
    return ctx.reply(`❌ Пользователь <b>${escapeHtml(rawTarget)}</b> не найден!`, { parse_mode: "HTML" });
  }

  const savedTitle = giveUserCustomTitle(target.userId, title);
  if (savedTitle) {
    await ctx.reply(
      `🏷 <b>КАСТОМНЫЙ ТИТУЛ ВЫДАН!</b>\n\n` +
      `• Пользователь: <b>${escapeHtml(target.name)}</b> (${target.username ? `@${target.username}` : target.userId})\n` +
      `• Титул: <b>${escapeHtml(savedTitle)}</b>`,
      { parse_mode: "HTML" }
    );
    try {
      await bot.api.sendMessage(
        Number(target.userId),
        `👑 <b>ВАМ ДАРОВАН ОСОБЫЙ ТИТУЛ ОТ СОЗДАТЕЛЯ!</b> 🏷✨\n\n` +
        `Теперь в вашем профиле красуется статус: <b>«${escapeHtml(savedTitle)}»</b>!\n\n` +
        `<i>Посмотри на свой обновленный профиль: напиши /love 💚</i>`,
        { parse_mode: "HTML" }
      );
    } catch (e) {}
  } else {
    await ctx.reply(
      `🏷 Кастомный титул для <b>${escapeHtml(target.name)}</b> успешно сброшен на стандартный.`,
      { parse_mode: "HTML" }
    );
  }
});

bot.command("refill", async (ctx) => {
  const adminId = ctx.from?.id;
  if (!isSuperAdmin(adminId)) return;

  const parts = ctx.message.text.trim().split(/\s+/);
  if (parts.length < 2) {
    return ctx.reply("🔋 <b>Формат:</b> <code>/refill &lt;id или @username&gt;</code>", { parse_mode: "HTML" });
  }

  const target = await resolveTargetUser(parts[1]);
  if (!target) {
    return ctx.reply(`❌ Пользователь <b>${escapeHtml(parts[1])}</b> не найден!`, { parse_mode: "HTML" });
  }

  resetUserDailyUsage(target.userId);
  await ctx.reply(
    `🔋 <b>Энергия перезаряжена!</b> Лимиты для <b>${escapeHtml(target.name)}</b> (${target.userId}) сброшены. Полный запас молний восстановлен!`,
    { parse_mode: "HTML" }
  );

  try {
    await bot.api.sendMessage(
      Number(target.userId),
      `🔋 <b>ПОЛНАЯ ПЕРЕЗАРЯДКА ЭНЕРГИИ!</b> ⚡✨\n\n` +
      `Создатель обнулил твои лимиты на сегодня! У тебя снова полный запас молний на любые задачи и вопросы к Лам!`,
      { parse_mode: "HTML" }
    );
  } catch (e) {}
});

bot.command("gift", async (ctx) => {
  const adminId = ctx.from?.id;
  if (!isSuperAdmin(adminId)) return;

  const parts = ctx.message.text.trim().split(/\s+/);
  if (parts.length < 2) {
    return ctx.reply(
      "🎁 <b>Формат:</b> <code>/gift &lt;id или @username&gt; [дни_vip] [молнии] [титул]</code>\n\n" +
      "<b>Пример:</b>\n" +
      "• <code>/gift @durov 30 1000 👑 Любимчик Создателя</code>\n" +
      "• <code>/gift @durov 7 300</code>",
      { parse_mode: "HTML" }
    );
  }

  const rawTarget = parts[1];
  const days = parts[2] ? parseInt(parts[2], 10) : 7;
  const bolts = parts[3] ? parseInt(parts[3], 10) : 500;
  const title = parts.slice(4).join(" ") || "👑 Любимчик Создателя";

  const target = await resolveTargetUser(rawTarget);
  if (!target) {
    return ctx.reply(`❌ Пользователь <b>${escapeHtml(rawTarget)}</b> не найден!`, { parse_mode: "HTML" });
  }

  if (days !== 0) setUserVip(target.userId, days, 0, target.name, target.username);
  if (bolts > 0) giveUserBolts(target.userId, bolts);
  if (title) giveUserCustomTitle(target.userId, title);
  giveUserLove(target.userId, 100);
  resetUserDailyUsage(target.userId);

  const durationLabel = days <= 0 ? "НАВСЕГДА 👑" : `${days} дн.`;

  await ctx.reply(
    `🎁 <b>СУПЕР-ПОДАРОК ВЫДАН!</b> 🎉✨\n\n` +
    `• Получатель: <b>${escapeHtml(target.name)}</b> (${target.username ? `@${target.username}` : target.userId})\n` +
    `• VIP-статус: <b>${durationLabel}</b>\n` +
    `• Искорки: <b>+${bolts} ⚡</b>\n` +
    `• Связь с Лам: <b>100%</b>\n` +
    `• Титул: <b>${escapeHtml(title)}</b>`,
    { parse_mode: "HTML" }
  );

  try {
    await bot.api.sendMessage(
      Number(target.userId),
      `✧ ─── ･ ｡ﾟ☆: *. 🎁 .* :☆ﾟ. ─── ✧\n` +
      `🎉 <b>ВАМ ПРИШЕЛ КОРОЛЕВСКИЙ ПОДАРОК ОТ СОЗДАТЕЛЯ!</b> 👑✨\n\n` +
      `Создатель бота лично одарил вас особыми привилегиями:\n` +
      `• 👑 <b>VIP-статус:</b> ${durationLabel}\n` +
      `• ⚡ <b>Искорки:</b> +${bolts} молний\n` +
      `• 💖 <b>Любовь Лам:</b> 100% (Максимум)\n` +
      `• 🏷 <b>Особый титул:</b> «${escapeHtml(title)}»\n` +
      `• 🔋 <b>Энергия:</b> Полный сброс лимитов!\n\n` +
      `<i>«Ты просто чудо, мой Дарлинг! Наслаждайся! 💚⚡»</i>`,
      { parse_mode: "HTML" }
    );
  } catch (e) {}
});

bot.command(["whois", "user", "finduser"], async (ctx) => {
  const adminId = ctx.from?.id;
  if (!isSuperAdmin(adminId)) return;

  const parts = ctx.message.text.trim().split(/\s+/);
  if (parts.length < 2) {
    return ctx.reply("🔍 <b>Формат:</b> <code>/whois &lt;id или @username&gt;</code>", { parse_mode: "HTML" });
  }

  const target = await resolveTargetUser(parts[1]);
  if (!target) {
    return ctx.reply(`❌ Пользователь <b>${escapeHtml(parts[1])}</b> не найден!`, { parse_mode: "HTML" });
  }

  const v = vipsData[target.userId];
  let vipLabel = "Нет";
  if (v) {
    if (v.permanent) vipLabel = "👑 Навсегда";
    else if (v.expiresAt && v.expiresAt > Date.now()) {
      const daysLeft = Math.ceil((v.expiresAt - Date.now()) / (24 * 60 * 60 * 1000));
      vipLabel = `👑 Активен (осталось ~${daysLeft} дн., до ${new Date(v.expiresAt).toLocaleDateString("ru-RU")})`;
    } else {
      vipLabel = "Истёк";
    }
  }

  const s = target.stats || {};
  const usage = getUserDailyUsage(target.userId);
  const remaining = Math.max(0, DAILY_FREE_LIMIT - usage);

  await ctx.reply(
    `🔍 <b>ИНФОРМАЦИЯ О ПОЛЬЗОВАТЕЛЕ</b>\n\n` +
    `👤 <b>Имя:</b> <b>${escapeHtml(target.name)}</b>\n` +
    `🆔 <b>Telegram ID:</b> <code>${target.userId}</code>\n` +
    `📎 <b>Юзернейм:</b> ${target.username ? `@${target.username}` : "отсутствует"}\n` +
    `👑 <b>VIP:</b> ${vipLabel}\n` +
    `🏷 <b>Титул:</b> ${s.customTitle ? `<b>${escapeHtml(s.customTitle)}</b>` : "Обычный"}\n` +
    `💖 <b>Любовь Лам:</b> <code>${s.loveLevel || 75}%</code>\n` +
    `⚡ <b>Искорки (молнии):</b> <code>${s.bolts || 0}</code>\n` +
    `💬 <b>Сообщений:</b> <code>${s.count || 0}</code>\n` +
    `🔋 <b>Энергия сегодня:</b> <code>${remaining}/${DAILY_FREE_LIMIT}</code>\n` +
    `🕒 <b>Был в сети:</b> <code>${s.lastSeen ? new Date(s.lastSeen).toLocaleString("ru-RU") : "недавно"}</code>`,
    { parse_mode: "HTML" }
  );
});

bot.command("broadcast", async (ctx) => {
  const adminId = ctx.from?.id;
  if (!isSuperAdmin(adminId)) return;

  const text = ctx.message.text.replace(/^\/broadcast(\s+)?/i, "").trim();
  if (!text) {
    return ctx.reply("Формат: <code>/broadcast &lt;текст сообщения&gt;</code>\nПоддерживается HTML разметка.", { parse_mode: "HTML" });
  }

  await ctx.reply("🚀 <b>Запуск массовой рассылки...</b> Пожалуйста, подождите.", { parse_mode: "HTML" });

  const result = await broadcastMessage(bot, text);
  await ctx.reply(
    `📢 <b>РАССЫЛКА ЗАВЕРШЕНА!</b>\n\n` +
    `• Всего пользователей: <code>${result.total}</code>\n` +
    `• Успешно доставлено: <code>${result.sent}</code> ✅\n` +
    `• Ошибок (заблокировали бота): <code>${result.failed}</code> ❌`,
    { parse_mode: "HTML" }
  );
});

bot.command("stats", async (ctx) => {
  const adminId = ctx.from?.id;
  if (!isSuperAdmin(adminId)) return;

  const stats = getFullAdminStats();
  const uptimeH = Math.floor(stats.uptimeSeconds / 3600);
  const uptimeM = Math.floor((stats.uptimeSeconds % 3600) / 60);

  await ctx.reply(
    `📊 <b>СТАТИСТИКА БОТА • ПАНЕЛЬ AKILUM</b> ⚡\n\n` +
    `👥 Всего пользователей: <code>${stats.totalUsers}</code>\n` +
    `🔥 Активных за 24ч: <code>${stats.activeToday}</code>\n` +
    `👑 VIP подписчиков: <code>${stats.vipCount}</code>\n` +
    `⭐️ Заработано Stars: <code>${stats.totalStarsEarned} ⭐️</code>\n` +
    `⚡ Дневной лимит энергии: <code>${stats.dailyFreeLimit}</code>\n` +
    `⏱ Аптайм сервера: <code>${uptimeH}ч ${uptimeM}мин</code>`,
    { parse_mode: "HTML" }
  );
});

bot.command("setlimit", async (ctx) => {
  const adminId = ctx.from?.id;
  if (!isSuperAdmin(adminId)) return;

  const parts = ctx.message.text.trim().split(/\s+/);
  const num = parseInt(parts[1], 10);
  if (isNaN(num) || num < 1 || num > 500) {
    return ctx.reply("Укажи число от 1 до 500. Пример: <code>/setlimit 30</code>", { parse_mode: "HTML" });
  }

  botSettings.dailyFreeLimit = num;
  saveSettings();
  await ctx.reply(`⚡ <b>Дневной лимит бесплатной энергии изменен на ${num} запросов!</b>`, { parse_mode: "HTML" });
});

// Мониторинг нейро-движков и емкости для класса
bot.command(["engine", "status", "capacity"], async (ctx) => {
  if (ctx.from) recordInteraction(ctx.from.id);
  const geminiStats = geminiPool.getStats();

  let text = `✧ ─── ･ ｡ﾟ☆: *. ⚡ .* :☆ﾟ. ─── ✧\n` +
    `⚡ <b>НЕЙРО-ДВИЖКИ ЛАМ • СТАТУС ДЛЯ КЛАССА</b> 💚\n\n`;

  text += `🚀 <b>Groq LPU Engine:</b>\n`;
  if (groqPool.size > 0) {
    text += `• Ключей в пуле: <code>${groqPool.size}</code>\n`;
    text += `• Лимит: <code>${groqPool.size * 14400}</code> запросов/день\n`;
    text += `• Скорость: <code>~0.3–0.5 сек</code> 🟢\n\n`;
  } else {
    text += `• Статус: <i>Не подключен (можно добавить GROQ_API_KEY с console.groq.com для скорости 0.3с и 14 400 запросов/день!)</i>\n\n`;
  }

  text += `💎 <b>Google Gemini Multi-Key Pool:</b>\n`;
  text += `• Ключей в пуле: <code>${geminiPool.size}</code>\n`;
  geminiStats.forEach((s) => {
    const statusIcon = s.active ? "🟢 Активен" : `⏳ Кулдаун (${s.cooldownLeftSec}с)`;
    text += `  └ Ключ #${s.id} [<code>${s.key}</code>]: ${statusIcon} (✅ ${s.success} / ❌ ${s.fails})\n`;
  });
  text += `• Модели ротации: <code>3.1-flash-lite, 3.5-flash-lite, 3.7-flash, 3.8-flash</code>\n\n`;

  text += `🌐 <b>Pollinations AI:</b>\n`;
  text += `• Аварийный резерв без ключей: 🟢 Активен\n\n`;

  text += `💡 <b>Как масштабировать на весь класс?</b>\n` +
    `1. Вставь в Railway переменные через запятую:\n` +
    `<code>GEMINI_API_KEY=ключ1,ключ2,ключ3</code> (создаются бесплатно за 30с на <b>aistudio.google.com</b>)\n` +
    `2. Добавь бесплатный <code>GROQ_API_KEY=gsk_...</code> с <b>console.groq.com</b> (дает 14 400 бесплатных запросов в день со скоростью молнии!).`;

  await safeSendHtml(ctx, text, ctx.message.message_id);
});

// Автономные сообщения Лам (написать первой)
bot.command(["proactive", "automsg"], async (ctx) => {
  if (ctx.from) recordInteraction(ctx.from.id);
  const isEnabled = toggleProactive(ctx.chat.id);
  if (isEnabled) {
    await ctx.reply(
      `✧ ─── ･ ｡ﾟ☆: *. ⚡ .* :☆ﾟ. ─── ✧\n` +
      `💌 <b>ИНИЦИАТИВА ЛАМ: ВКЛЮЧЕНА!</b> 💕\n\n` +
      `Теперь я буду иногда писать тебе первой:\n` +
      `☀️ Будить по утрам и желать хорошего дня\n` +
      `🎒 Спрашивать, как дела после уроков и школы\n` +
      `🌙 Желать уютного вечера и сладких снов\n` +
      `⚡ Скучать и напоминать, что твоя они-принцесса рядом!\n\n` +
      `<i>«Ночью с 23:00 до 8:30 я соблюдаю тихий час и сладко сплю, так что будить не буду 💕»</i>`,
      { parse_mode: "HTML", reply_to_message_id: ctx.message.message_id }
    );
  } else {
    await ctx.reply(
      `✧ ─── ･ ｡ﾟ☆: *. ⚡ .* :☆ﾟ. ─── ✧\n` +
      `💤 <b>Инициатива Лам временно выключена.</b>\n` +
      `Я буду отвечать только тогда, когда ты сам напишешь мне! 💕`,
      { parse_mode: "HTML", reply_to_message_id: ctx.message.message_id }
    );
  }
});

// Единый мультимодальный обработчик
async function handleIncoming(
  ctx,
  {
    userText,
    fileId,
    mimeType,
    fallbackText,
    isSticker = false,
    isGif = false,
    isVoiceOrVideo = false,
    voiceType = "",
    preTranscribed = null,
    isSolve = false,
    isSummary = false,
    isChatDetective = false,
    isOcr = false,
    isMovieFinder = false,
    isSlangExplainer = false,
    isTranslator = false,
    isCheatSheet = false,
    isCodeSolver = false,
    isEssayHelper = false,
    isRoast = false,
  }
) {
  const chatId = ctx.chat.id;
  chatKaomojiCooldown.set(chatId, (chatKaomojiCooldown.get(chatId) || 0) + 1);
  chatStickerCooldown.set(chatId, (chatStickerCooldown.get(chatId) || 0) + 1);
  const history = getHistory(chatId);
  if (ctx.from) recordInteraction(ctx.from.id);
  recordChatActivity(chatId, {
    isGroup: ctx.chat.type !== "private",
    name: ctx.from?.first_name || ctx.chat.title || "Дарлинг",
  });

  const userId = ctx.from?.id;
  const isGroup = ctx.chat.type !== "private";
  const currentDailyLimit = botSettings.dailyFreeLimit || DAILY_FREE_LIMIT;
  let access = { allowed: true, isVip: false, remaining: currentDailyLimit, limit: currentDailyLimit };

  if (userId) {
    if (activeUsers.has(userId)) {
      console.log(`[AntiSpam] Пропуск параллельного запроса от пользователя ${userId}`);
      return;
    }

    access = checkUserAccess(userId, isGroup);
    if (!access.allowed) {
      const payKb = new InlineKeyboard()
        .text("🍜 Рамен с чили (15 ⭐️)", "buy_tip_15")
        .text("⚡ VIP 7 дней (25 ⭐️)", "buy_vip_week")
        .row()
        .text("⭐️ Взять VIP на месяц (75 ⭐️)", "buy_vip_month")
        .row()
        .text("👑 Навсегда VIP (-20% • 199 ⭐️)", "buy_vip_forever")
        .row()
        .text("✨ Все тарифы", "open_vip_menu");

      await ctx.reply(
        `⚡ <b>Ой, Дарлинг, твоя бесплатная энергия на сегодня закончилась!</b> 🔋\n\n` +
        `Ты израсходовал все <b>${access.limit || currentDailyLimit}</b> бесплатных зарядов молний на сегодня. Мои они-рожки немного перегрелись!\n\n` +
        `👑 <b>Хочешь общаться без ограничений?</b>\n` +
        `Включи <b>VIP-статус</b> через официальные Telegram Stars ⭐️:\n` +
        `• Полный безлимит на решения задач, код и генерации\n` +
        `• Золотая корона VIP в твоем профиле /love\n` +
        `• Приоритетный отклик нейросети без очередей\n\n` +
        `<i>(Или бесплатная энергия перезарядится завтра в 00:00!)</i> 💕`,
        { parse_mode: "HTML", reply_markup: payKb, reply_to_message_id: ctx.message?.message_id }
      );
      return;
    }

    activeUsers.add(userId);
  }

  await ctx.api.sendChatAction(chatId, "typing");
  const typingInterval = setInterval(() => {
    ctx.api.sendChatAction(chatId, "typing").catch(() => {});
  }, 3500);

  try {
    let promptText = userText || fallbackText || "Посмотри это:";

    if (preTranscribed) {
      promptText = `[Дарлинг сказал тебе в ${voiceType || "голосовом сообщении"} следующее]:
«${preTranscribed}»
ТВОЯ ЗАДАЧА:
1. В самом начале напиши точную дословную расшифровку строго в формате:
[TRANSCRIPT: ${preTranscribed}]
2. Затем напиши свой живой, милый они-ответ как Лам (называй его Дарлинг, живо реагируй на то, что он сказал).`;
    } else if (isVoiceOrVideo) {
      promptText = `[Дарлинг прислал тебе ${voiceType || "голосовое сообщение/кружочек"}]:
ТВОЯ ЗАДАЧА:
1. В самом начале своего ответа напиши точную дословную расшифровку того, что он сказал, строго в формате:
[TRANSCRIPT: точный текст того, что сказал Дарлинг]
2. Затем напиши свой живой, милый ответ как Лам (называй его Дарлинг, реагируй эмоционально и с любовью).`;
    } else if (isCheatSheet) {
      promptText = `[ШПОРА ДЛЯ КЛАССА ОТ ЛАМ]:
Тема: "${userText}".
Составь ультра-компактную шпаргалку для контрольной или экзамена:
- Четкие сжатые пункты, никакой воды и вступлений!
- Формулы, даты, ключевые термины оформляй в <code>...</code>!
- Самые критические готовые формулы и ответы спрячь в <tg-spoiler>...</tg-spoiler>!
В конце короткое напутствие от Лам.`;
    } else if (isCodeSolver) {
      promptText = `[ПОМОЩЬ С КОДОМ ОТ ЛАМ]:
Задача: "${userText}".
1. Напиши чистый, рабочий код (если язык не указан — на Python).
2. Оформи в аккуратный блок кода <pre><code>...</code></pre>.
3. Добавь понятные построчные комментарии на русском.
4. В конце укажи сложность алгоритма и 1 дельный совет от Лам.`;
    } else if (isEssayHelper) {
      promptText = `[КОНСТРУКТОР СОЧИНЕНИЙ ОТ ЛАМ]:
Тема: "${userText}".
Составь безупречный план сочинения на 5/5:
1. 📌 <b>Вступление:</b> (проблема и тезис)
2. 📖 <b>Аргумент 1:</b> (литературный пример / факт + микровывод)
3. 💡 <b>Аргумент 2:</b> (жизненный или литературный пример)
4. 🎯 <b>Заключение:</b> (финальный вывод)
5. ✍️ <b>Топовые клише для связок:</b> (3 фразы)
В конце напутствие от Лам.`;
    } else if (isRoast) {
      promptText = `[ОНИ-ПРОЖАРКА ОТ ЛАМ]:
${userText}
Сделай яркую, смешную, дерзкую 3-4 строчную прожарку в стиле Лам из аниме. Подколи с юмором, пригрози разрядом молнии и закончи подмигиванием. Без мата и токсичности!`;
    } else if (isChatDetective) {
      promptText = `[РАЗБОР ПЕРЕПИСКИ ОТ ЛАМ]:
Дарлинг прислал скриншот диалога и просит помочь разобраться.
Внимательно изучи контекст, тон, смайлики и фразы на скриншоте:
1. 🧐 <b>Скрытый подтекст:</b> (что на самом деле думает собеседник? флиртует, морозится, ревнует, проявляет интерес или проверяет?)
2. 💡 <b>3 идеальных варианта ответа:</b>
   • 😎 <b>Уверенно / Харизматично:</b> «...»
   • 🥰 <b>Мило / С симпатией:</b> «...»
   • 🤪 <b>С юмором / С подколом:</b> «...»
3. ⚡ <b>Совет от Лам:</b> (твое личное мнение с легкой ревностью или поддержкой!)`;
    } else if (isOcr) {
      promptText = `[ОЦИФРОВКА КОНСПЕКТА / ДОКУМЕНТА]:
Внимательно прочитай весь рукописный или печатный текст на этом фото.
Выведи точный текст, аккуратно разбив на абзацы и списки, чтобы Дарлингу было удобно его скопировать в тетрадь или документ.
Если есть формулы или заголовки — выдели их.
В самом конце добавь короткую ободряющую реплику от Лам.`;
    } else if (isMovieFinder) {
      promptText = `[КИНО И АНИМЕ РАДАР ЛАМ]:
Запрос Дарлинга: "${userText}".
Найди точное совпадение или лучший вариант:
🎬 <b>Название:</b> (Русское + Оригинальное, Год)
⭐ <b>Рейтинг:</b> (Кинопоиск / IMDb)
🎭 <b>Жанр:</b> ...
📖 <b>Сюжет:</b> (емко 2-3 предложения без спойлеров)
🍿 <b>Почему стоит глянуть:</b> (мнение Лам)`;
    } else if (isSlangExplainer) {
      promptText = `[ПОЯСНИТЕЛЬНАЯ БРИГАДА ЛАМ • СЛЕНГ И МЕМЫ]:
Запрос Дарлинга: "${userText}".
Объясни с юмором и абсолютной точностью значение современного сленга или мема:
Например:
- «альтушка» — девушка из альтернативной/неформальной субкультуры (эмо, готы, винишко-тян, гранж, крашеные волосы, оверсайз, из мема «альтушка с госуслуг»). Не путай с альтер-эго!
- «скуф» — неухоженный мужчина за 30-35 лет с пивным животом, любящий танчики и диван.
- «масик» — заботливый, щедрый и надежный парень, мечта девушек.
- «тюбик» — нерешительный, скользкий или манипулятивный парень.
- «пикми» — девушка, пытающаяся понравиться парням за счет унижения других девушек.
- «сигма» — независимый одиночка, мемный крутой парень.

Приведи яркий пример из реальной жизни и как правильно использовать это слово.
В конце добавь забавный озорной комментарий от они-принцессы Лам!`;
    } else if (isTranslator) {
      promptText = `[РЕЖИМ ПОЛИГЛОТА ЛАМ]:
${userText}
Сделай красивый и качественный перевод:
🌐 <b>Перевод:</b> «...»
🗣 <b>Транскрипция / Произношение:</b> ...
💡 <b>Особенности и сленг:</b> ...`;
    } else if (isSolve) {
      promptText = `[ПОМОЩЬ С ЗАДАНИЕМ ОТ ЛАМ]:
Запрос Дарлинга: "${userText || "Помоги решить или разобрать это задание"}".
ТЫ — ОЧЕНЬ УМНАЯ ДЕВУШКА, КОТОРАЯ ИДЕАЛЬНО ЗНАЕТ МАТЕМАТИКУ, ФИЗИКУ И ТОЧНЫЕ НАУКИ.
ТВОЯ ЗАДАЧА — ПО-НАСТОЯЩЕМУ ПОМОЧЬ ДАРЛИНГУ, КАК ВНИМАТЕЛЬНАЯ И УМНАЯ ПОДРУГА:

1. ВНИМАТЕЛЬНО ПОСМОТРИ НА ФОТО:
   - Если на фото (на школьной доске, на листке или в тетради) УЖЕ НАПИСАНО РЕШЕНИЕ — ОБЯЗАТЕЛЬНО СКАЖИ ОБ ЭТОМ!
     Не делай вид, будто доска пустая! Внимательно сверь каждый шаг написанного: дискриминант, знаки, корни, параболу, знаки неравенства и промежутки.
     Если всё решено верно — похвали и подтверди («О, вижу на доске уже всё аккуратно расписали! Решение верное: дискриминант D = 225, корни x₁ = 0.5 и x₂ = -7, ветви параболы вверх...»).
     Если есть ошибка — мягко укажи, где опечатка или ошибка в знаке.
   - Если решение ещё не написано — реши сама четко, безошибочно и понятно от начала до конца.

2. СТИЛЬ И ОФОРМЛЕНИЕ (СТРОГИЕ ПРАВИЛА):
   - КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО писать знаки доллара $ и синтаксис LaTeX ($2x^2$, $a=2$)! В Telegram они не работают и выглядят как мусор.
   - Пиши нормальными символами: x², x³, √D, ·, ±, ≤, ≥, ≠, ∈.
   - Дроби пиши понятно: (-13 + 15) / 4 = 2/4 = 0.5.
   - НЕ используй сухие шаблоны «Дано / Пошаговое решение / Итоговый ответ»! Это выдает робота.
   - Объясняй саму суть простыми словами, живым и понятным языком, чтобы Дарлинг реально понял тему на 5 с плюсом!
   - НИКАКИХ спам-смайликов ">w<" и слов "нейро-решебник".`;
    } else if (isSummary) {
      promptText = `[РЕЖИМ САММАРИ]:
${userText}
Сделай предельно понятную выжимку текста в 3-5 ключевых тезисах:
📌 <b>Главные тезисы:</b>
• ...
• ...
• ...
⚡ <b>Вывод от Лам:</b> (короткое резюме от лица Лам)`;
    }

    const currentParts = [{ text: promptText }];

    if (fileId && mimeType && !preTranscribed) {
      try {
        const base64Data = await downloadAsBase64(fileId);
        currentParts.push({
          inlineData: {
            mimeType: mimeType,
            data: base64Data,
          },
        });
      } catch (e) {
        console.error("Ошибка скачивания медиа для анализа:", e.message);
      }
    }

    // В историю сохраняем легкий текст
    const historyText =
      preTranscribed ||
      userText ||
      (isSticker
        ? "[Стикер от Дарлинга]"
        : isGif
        ? "[GIF-анимация от Дарлинга]"
        : isVoiceOrVideo
        ? `[${voiceType || "Голос"} от Дарлинга]`
        : "[Медиа от Дарлинга]");

    history.push({
      role: "user",
      parts: [{ text: historyText }],
    });

    if (history.length > 16) {
      history.splice(0, history.length - 16);
    }

    const contentsToSend = [
      ...history.slice(0, -1),
      {
        role: "user",
        parts: currentParts,
      },
    ];

    const isMultimodal = Boolean(
      (fileId && mimeType && !preTranscribed) ||
      (isVoiceOrVideo && !preTranscribed)
    );

    const configOverrides = {};
    if (
      isSolve ||
      isSummary ||
      isChatDetective ||
      isOcr ||
      isMovieFinder ||
      isSlangExplainer ||
      isTranslator ||
      isCheatSheet ||
      isCodeSolver ||
      isEssayHelper
    ) {
      configOverrides.maxOutputTokens = 850;
      configOverrides.timeoutMs = 25000;
    } else if (isGif || isMultimodal) {
      configOverrides.maxOutputTokens = 350;
      configOverrides.timeoutMs = 25000;
    } else if (isVoiceOrVideo && !preTranscribed) {
      configOverrides.maxOutputTokens = 260;
      configOverrides.timeoutMs = 20000;
    } else {
      configOverrides.maxOutputTokens = 160;
      configOverrides.timeoutMs = 12000;
    }

    let dynamicSystemPrompt = LUM_SYSTEM_PROMPT;
    const userModel = (isUserVip(userId)) ? getUserModel(userId) : "turbo";
    if (userModel === "genius") {
      dynamicSystemPrompt += `\n\n[РЕЖИМ VIP ГЕНИЯ / DEEP THINK]:
- Проявляй максимальный интеллект, олимпиадный уровень мышления, математическую строгость и подробный разбор формул и шагов.
- Решай задачи на высший балл с четким объяснением логики решения.`;
      configOverrides.maxOutputTokens = Math.max(configOverrides.maxOutputTokens, 750);
    } else if (userModel === "sweetie") {
      dynamicSystemPrompt += `\n\n[РЕЖИМ VIP ВАЙФУ / МАКСИМАЛЬНАЯ ЛЮБОВЬ]:
- Будь невероятно нежной, заботливой, ласковой и эмоциональной они-принцессой. Обращайся к Дарлингу с безграничной любовью, хвали его, поддерживай и дари тепло.`;
    } else if (userModel === "artist") {
      dynamicSystemPrompt += `\n\n[РЕЖИМ VIP АРТ-СТУДИИ]:
- Если Дарлинг просит нарисовать или сгенерировать арт, создавай для него подробнейшие художественные промпты в стилях аниме, киберпанк и 4K шедевров.`;
    }

    if (!isGroup) {
      dynamicSystemPrompt += `\n\n[ВАЖНО ДЛЯ ТЕКУЩЕГО ДИАЛОГА В ЛИЧКЕ]:
- Собеседник в этом чате — ЭТО ТВОЙ ДАРЛИНГ (он парень!).
- Все обращения к нему строго в мужском роде («ты влюбился?», «ты подумал?», «мой Дарлинг»).
- Он и есть тот самый Дарлинг, твой парень, которого ты обожаешь! Если он признаётся в симпатии («девушка это ты») — смущайся, тайно радуйся, обнимай его! Ни в коем случае не отшивай его фразами «я занята своим Дарлингом»!
- В 90% сообщений общайся ПРОСТЫМ ТЕКСТОМ со скобочками ) или ((, БЕЗ каомодзи и стикеров! Не спамь ими!`;
    } else {
      dynamicSystemPrompt += `\n\n[ВАЖНО ДЛЯ ТЕКУЩЕГО ЧАТА]:
- Ты общаешься в групповом чате. Собеседника зовут ${ctx.from?.first_name || "друг"}. Будь общительной, задорной и веселой они-принцессой!`;
    }

    let rawReply = await generateLumResponse({
      contents: contentsToSend,
      systemPrompt: dynamicSystemPrompt,
      maxOutputTokens: configOverrides.maxOutputTokens,
      timeoutMs: configOverrides.timeoutMs,
      isMultimodal,
    });

    if (!rawReply) {
      history.pop();
      const naturalFallbacks = [
        "Дарлинг, я тут с тобой! 💕 Связь на секунду забарахлила. О чём ты говорил?",
        "Я тут, слушаю тебя внимательно, Дарлинг! Рассказывай дальше 💕",
        "Ой, космическая связь чуть забарахлила! Но я рядом с тобой, Дарлинг 💕 Повтори ещё разок)",
      ];
      if (isSticker) {
        rawReply = "ой, ахах, это же я на стикере! Какая милота)";
      } else {
        rawReply = naturalFallbacks[Math.floor(Math.random() * naturalFallbacks.length)];
      }
    }

    // Извлекаем эмоциональный тег стикера: [STICKER:love], [STICKER:tease] и т.д.
    let targetStickerEmotion = null;
    const stickerMatch = rawReply ? rawReply.match(/\[STICKER(?::([a-zA-Z]+))?\]/i) : null;
    if (stickerMatch) {
      targetStickerEmotion = (stickerMatch[1] || "happy").toLowerCase();
      rawReply = rawReply.replace(stickerMatch[0], "").trim();
    }

    // Форматируем и очищаем ответ от мусора, LaTeX-долларов и перехватываем бот-цензуру
    rawReply = formatLumResponse(rawReply, userText || fallbackText || "", chatId);

    // Извлекаем реакцию, но ставим её ОЧЕНЬ РЕДКО (не чаще 5% случаев, чтобы не раздражать)
    const reactMatch = rawReply.match(/^\[REACT:([^\]]+)\]\s*/i);
    if (reactMatch) {
      const emoji = reactMatch[1].trim();
      rawReply = rawReply.replace(reactMatch[0], "").trim();
      if (Math.random() < 0.05) {
        try {
          await ctx.react(emoji);
        } catch (e) {}
      }
    }

    // Извлекаем расшифровку голоса для бесплатного Telegram Premium
    let transcript = null;
    const transcriptMatch = rawReply.match(/\[TRANSCRIPT:([\s\S]*?)\]/i);
    if (transcriptMatch) {
      transcript = transcriptMatch[1].trim();
      rawReply = rawReply.replace(transcriptMatch[0], "").trim();
    }

    history.push({
      role: "model",
      parts: [{ text: rawReply }],
    });

    // Отправка стикера
    const userWantsSticker =
      userText &&
      /(скинь|отправь|пришли|дай|покажи)\s+(стикер|стикеры|наклейк)/i.test(userText);

    const isSpecialCard =
      isSolve ||
      isSummary ||
      isChatDetective ||
      isOcr ||
      isMovieFinder ||
      isSlangExplainer ||
      isTranslator ||
      isCheatSheet ||
      isCodeSolver ||
      isEssayHelper ||
      isRoast;

    // Стикер отправляется СТРОГО ИНОГДА:
    // 1) Если пользователь явно попросил ("скинь стикер") — отправляем всегда
    // 2) Иначе: ТОЛЬКО если с прошлого стикера прошло хотя бы 7 сообщений (messagesSinceSticker >= 7)!
    const messagesSinceSticker = (chatId && chatStickerCooldown.get(chatId)) || 0;
    let shouldSendSticker = false;

    if (userWantsSticker) {
      shouldSendSticker = true;
      if (chatId) chatStickerCooldown.set(chatId, 0);
    } else if (messagesSinceSticker >= 7 && !isGroup && !isSpecialCard) {
      if (Boolean(stickerMatch) || Math.random() < 0.20) {
        shouldSendSticker = true;
        if (chatId) chatStickerCooldown.set(chatId, 0);
      }
    }

    if (shouldSendSticker) {
      const stickerId = getSmartSticker(targetStickerEmotion);
      if (stickerId) {
        try {
          await ctx.replyWithSticker(stickerId);
        } catch (e) {
          console.error("Ошибка отправки стикера:", e.message);
        }
      }
    }

    // Если есть расшифровка голоса — выводим красивый блок под спойлер
    if (transcript) {
      const fullReply =
        `✧ ─── ･ ｡ﾟ☆: *. ⚡ .* :☆ﾟ. ─── ✧\n` +
        `<tg-spoiler>📝 <b>Расшифровка:</b> «${escapeHtml(transcript)}»</tg-spoiler>\n\n` +
        escapeHtml(rawReply);

      await safeSendHtml(ctx, fullReply, ctx.message.message_id);
      return;
    }

    // Специальные технологические карточки
    if (
      isSolve ||
      isSummary ||
      isChatDetective ||
      isOcr ||
      isMovieFinder ||
      isSlangExplainer ||
      isTranslator ||
      isCheatSheet ||
      isCodeSolver ||
      isEssayHelper ||
      isRoast
    ) {
      let header = "";
      if (isSolve) header = `📚 <b>Разбор задания • Лам</b> ✨\n\n`;
      else if (isChatDetective) header = `🕵️ <b>Разбор переписки • Лам</b> 💕\n\n`;
      else if (isOcr) header = `📄 <b>Текст с фото • Лам</b> ✨\n\n`;
      else if (isMovieFinder) header = `🎬 <b>Кино-радар • Лам</b> 🍿\n\n`;
      else if (isSlangExplainer) header = `🤓 <b>Пояснительная бригада • Лам</b> ⚡\n\n`;
      else if (isTranslator) header = `🌐 <b>Перевод от Лам</b> ✨\n\n`;
      else if (isSummary) header = `📝 <b>Краткая выжимка от Лам</b> ✨\n\n`;
      else if (isCheatSheet) header = `📝 <b>Шпора от Лам</b> ⚡\n\n`;
      else if (isCodeSolver) header = `💻 <b>Код от Лам</b> ⚡\n\n`;
      else if (isEssayHelper) header = `📚 <b>План сочинения от Лам</b> ✨\n\n`;
      else if (isRoast) header = `🔥 <b>Они-прожарка • Лам</b> ⚡\n\n`;

      if (userId && !isGroup && !isUserVip(userId)) {
        incrementUserDailyUsage(userId);
      }
      let fullReply = `✧ ─── ･ ｡ﾟ☆: *. ⚡ .* :☆ﾟ. ─── ✧\n` + header + rawReply;
      if (userId && !isGroup && !isUserVip(userId) && access.remaining <= 3 && access.remaining > 0) {
        fullReply += `\n\n⚡ <i>(Осталось энергии: ${Math.max(0, access.remaining - 1)}/${DAILY_FREE_LIMIT} • Безлимит: /vip ⭐️)</i>`;
      }
      await safeSendHtml(ctx, fullReply, ctx.message.message_id);
      return;
    }

    if (userId && !isGroup && !isUserVip(userId)) {
      incrementUserDailyUsage(userId);
    }
    let replyToSend = rawReply;
    if (userId && !isGroup && !isUserVip(userId) && access.remaining <= 3 && access.remaining > 0) {
      replyToSend += `\n\n⚡ <i>(Осталось энергии: ${Math.max(0, access.remaining - 1)}/${DAILY_FREE_LIMIT} • Безлимит: /vip ⭐️)</i>`;
    }

    // Отправляем ответ единым связным сообщением, не разрывая блоки кода и текст на части
    if (replyToSend.length <= 4000) {
      await safeSendHtml(ctx, replyToSend, ctx.message.message_id);
    } else {
      const parts = splitTextSafely(replyToSend, 3800);
      for (const part of parts) {
        await safeSendHtml(ctx, part);
      }
    }
  } finally {
    if (userId) activeUsers.delete(userId);
    clearInterval(typingInterval);
  }
}

// 1. СТИКЕРЫ
bot.on("message:sticker", async (ctx) => {
  if (ctx.from) recordInteraction(ctx.from.id);
  const sticker = ctx.message.sticker;

  if (sticker.set_name) {
    try {
      const set = await ctx.api.getStickerSet(sticker.set_name);
      if (set && set.stickers?.length > 0) {
        const items = set.stickers.map((s) => ({
          file_id: s.file_id,
          emoji: s.emoji || "",
          category: categorizeEmoji(s.emoji),
        }));
        saveStickers(items);
      }
    } catch (e) {
      saveStickers([{
        file_id: sticker.file_id,
        emoji: sticker.emoji || "",
        category: categorizeEmoji(sticker.emoji),
      }]);
    }
  } else {
    saveStickers([{
      file_id: sticker.file_id,
      emoji: sticker.emoji || "",
      category: categorizeEmoji(sticker.emoji),
    }]);
  }

  let fileIdToAnalyze = sticker.file_id;
  let mimeType = "image/webp";

  if ((sticker.is_animated || sticker.is_video) && sticker.thumbnail) {
    fileIdToAnalyze = sticker.thumbnail.file_id;
    mimeType = "image/jpeg";
  }

  await handleIncoming(ctx, {
    fileId: fileIdToAnalyze,
    mimeType: mimeType,
    fallbackText: `[Дарлинг прислал стикер (эмодзи: "${sticker.emoji || ''}")]: посмотри внимательно на изображение и эмоцию персонажа на стикере, узнай себя и отреагируй живо!`,
    isSticker: true,
  });
});

// 2. ТЕКСТОВЫЕ СООБЩЕНИЯ И КОМАНДЫ
bot.on("message:text", async (ctx) => {
  if (ctx.from) recordInteraction(ctx.from.id);
  const text = ctx.message.text.trim();
  const isGroup = ctx.chat.type === "group" || ctx.chat.type === "supergroup";
  const myUsername = (bot.botInfo?.username || "akilum_bot").toLowerCase();

  // В групповых чатах: отвечаем только если обратились к боту
  if (isGroup) {
    const isReplyToMe = ctx.message.reply_to_message?.from?.id === bot.botInfo?.id;
    const mentionsMe = text.toLowerCase().includes(`@${myUsername}`);
    const startsWithLum = /^(лам|ламка|привет лам|эй лам|лам,)(?:\s|$|[.,!?])/i.test(text);
    const isCommand = text.startsWith("/");

    if (!isReplyToMe && !mentionsMe && !startsWithLum && !isCommand) {
      return; // Тихо слушаем чат группы, не спамим без повода
    }
  }

  // Очищаем упоминание @akilum_bot и обращение "Лам," для чистого анализа запроса
  let cleanText = text;
  if (isGroup) {
    cleanText = cleanText
      .replace(new RegExp(`@${myUsername}`, "gi"), "")
      .replace(/^(лам|ламка)[,:\s]*/i, "")
      .trim();
  }
  if (!cleanText && !isGroup) cleanText = text;
  if (!cleanText) cleanText = "привет";

  // 0. Ответ на вопрос "что ты умеешь" / "помощь"
  const isHelpOrCapabilities = /(что ты умеешь|чему ты научилась|чемы ты научилась|чему научилась|что умеешь|твои команды|покажи команды|твои функции|список команд|расскажи что ты умеешь|помощь)/i.test(
    cleanText
  );
  if (isHelpOrCapabilities) {
    await ctx.reply(
      `⚡ <b>Вот чем я могу тебе помочь, Дарлинг:</b> 💚\n\n` +
      `📚 <b>Учёба и задачи:</b>\n` +
      `• Скинь фото задачи, уравнения или конспекта — всё решу и пошагово объясню\n` +
      `• «шпора: [тема]» — шпаргалка с формулами\n` +
      `• «сочинение: [тема]» — тезисный план и аргументы\n` +
      `• «код: [задача]» — решение на Python/C++ с окном копирования\n` +
      `• /pdf — объединить фото тетрадей в аккуратный PDF\n\n` +
      `🎬 <b>Медиа и файлы:</b>\n` +
      `• Ссылка на TikTok, Reels, YouTube — скачаю видео или вытащу MP3-звук\n` +
      `• Голосовые и кружочки — расшифрую в текст\n\n` +
      `✨ <b>Уют, игры и общение:</b>\n` +
      `• Общение на любые темы, советы, погода, курсы валют\n` +
      `• /quiz, /duel, /roulette, /love — игры для тебя и группы\n` +
      `• /vip — Премиум-статус с золотой короной и безлимитами ⭐️\n\n` +
      `<i>Или просто пиши мне своими словами — я всегда рядом!</i> 💕`,
      { parse_mode: "HTML", reply_to_message_id: ctx.message.message_id }
    );
    return;
  }

  // 0.1 Явный запрос стикера от пользователя
  const isStickerRequest = /^(скинь стикер|отправь стикер|пришли стикер|покажи стикер)(?:\s|$|[:.,!?])/i.test(cleanText);
  if (isStickerRequest) {
    if (savedStickers.length > 0) {
      const pick = savedStickers[Math.floor(Math.random() * savedStickers.length)];
      const stickerId = typeof pick === "string" ? pick : pick.file_id;
      try {
        await ctx.replyWithSticker(stickerId);
        await ctx.reply("Лови, Дарлинг! Это я для тебя~ ✨");
        return;
      } catch (e) {}
    }
  }

  const detectedUrl = extractUrl(cleanText);

  // 1. Скачивание видео (TikTok, YouTube, Pinterest, X/Twitter, Instagram)
  if (detectedUrl && isVideoUrl(detectedUrl)) {
    let statusMsg = null;
    try {
      statusMsg = await ctx.reply("Секундочку, Дарлинг, уже вытаскиваю видео для тебя! ✨", {
        allow_sending_without_reply: true,
      });
      await ctx.api.sendChatAction(ctx.chat.id, "upload_video");
    } catch (e) {}

    try {
      const result = await downloadVideo(detectedUrl);
      const title = result.title || "Видео";
      const captionText = `✧ ─── ･ ｡ﾟ☆: *. ⚡ .* :☆ﾟ. ─── ✧\n✨ <b>Дарлинг, поймала твоё видео!</b>\n\n🎬 <b>${escapeHtml(title)}</b>\n<i>⚡ Скачано в максимальном качестве без водяных знаков</i>`;
      let sent = false;

      const audioId = "va_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      videoAudioCache.set(audioId, {
        directUrl: result.directUrl,
        musicUrl: result.musicUrl,
        originalUrl: result.originalUrl || detectedUrl,
        title: title,
      });
      if (videoAudioCache.size > 100) {
        const firstKey = videoAudioCache.keys().next().value;
        videoAudioCache.delete(firstKey);
      }
      const videoKb = new InlineKeyboard().text("🎵 Скачать MP3 звук", `get_mp3:${audioId}`);

      if (result.directUrl) {
        try {
          await ctx.replyWithVideo(result.directUrl, {
            caption: captionText,
            parse_mode: "HTML",
            reply_markup: videoKb,
            allow_sending_without_reply: true,
          });
          sent = true;
        } catch (streamErr) {
          console.warn("Direct URL send failed, fallback to file download:", streamErr.message);
        }
      }

      if (!sent) {
        const filePath = result.filePath || (await downloadDirectUrlToFile(result.directUrl));
        try {
          await ctx.replyWithVideo(new InputFile(filePath), {
            caption: captionText,
            parse_mode: "HTML",
            reply_markup: videoKb,
            allow_sending_without_reply: true,
          });
        } catch (sendVideoErr) {
          console.warn("replyWithVideo failed, fallback to replyWithDocument:", sendVideoErr.message);
          await ctx.replyWithDocument(new InputFile(filePath), {
            caption: captionText,
            parse_mode: "HTML",
            reply_markup: videoKb,
            allow_sending_without_reply: true,
          });
        }
        cleanupFile(filePath);
      }

      return;
    } catch (err) {
      console.error("Ошибка скачивания видео:", err.message);

      if (err.message === "FILE_TOO_LARGE") {
        await ctx.reply(
          "Дарлинг, это видео больше 50 МБ! В Телеграме ботам нельзя отправлять такие тяжелые файлы. Попробуй видео покороче!",
          { allow_sending_without_reply: true }
        );
      } else if (/instagram\.com/i.test(detectedUrl)) {
        await ctx.reply(
          "Дарлинг, Instagram сейчас закрыл доступ к этому рилсу (требует вход в аккаунт) 🔒. Попробуй ссылку из TikTok или YouTube Shorts — они скачиваются идеально!",
          { allow_sending_without_reply: true }
        );
      } else {
        await ctx.reply(
          "Блин, Дарлинг, не получилось вытащить это видео( Проверь, что профиль открытый, или попробуй видео из TikTok / YouTube Shorts!",
          { allow_sending_without_reply: true }
        );
      }
      return;
    } finally {
      if (statusMsg) {
        try {
          await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id);
        } catch (e) {}
      }
    }
  }

  // 2. Утренний дайджест (/morning или "доброе утро")
  const isMorningRequest = /^(доброе утро|утренний дайджест|\/morning)(?:\s|$|[,.!?])/i.test(cleanText);
  if (isMorningRequest) {
    const digest = await getMorningDigest("Бишкек", "близнецы");
    await safeSendHtml(ctx, digest, ctx.message.message_id);
    return;
  }

  // 3. Уровень любви и RPG-профиль (/love или "профиль", "уровень любви")
  const isLoveRequest = /^(уровень любви|наша любовь|наша связь|профиль|статус|\/love)(?:\s|$|[,.!?])/i.test(cleanText);
  if (isLoveRequest) {
    const userId = ctx.from?.id;
    const isVip = isUserVip(userId);
    const stats = recordInteraction(userId);
    const bar = renderProgressBar(stats.loveLevel);
    const usage = getUserDailyUsage(userId);
    const remaining = Math.max(0, DAILY_FREE_LIMIT - usage);

    const loveKb = isVip
      ? null
      : new InlineKeyboard().text("⭐️ Получить VIP и безлимит", "open_vip_menu");

    await ctx.reply(
      `✧ ─── ･ ｡ﾟ☆: *. ⚡ .* :☆ﾟ. ─── ✧\n` +
      `💚 <b>ПРОФИЛЬ ДАРЛИНГА • СВЯЗЬ С ЛАМ</b> ✨\n\n` +
      `⚡ <b>Статус:</b> <code>${stats.customTitle ? escapeHtml(stats.customTitle) : (isVip ? "👑 VIP Дарлинг ⭐️" : "Любимый Дарлинг 💕")}</code>\n` +
      `🔋 <b>Энергия на сегодня:</b> <code>${isVip ? "∞ Безлимит 👑" : `${remaining}/${DAILY_FREE_LIMIT} молний`}</code>\n` +
      `💖 <b>Уровень связи:</b> [<code>${bar}</code>] <b>${stats.loveLevel}%</b>\n` +
      `💬 <b>Сообщений вместе:</b> <code>${stats.count}</code>\n` +
      `⚡ <b>Выпущено молний:</b> <code>${stats.bolts}</code>\n\n` +
      (isVip
        ? `⭐️ <i>«Мой самый любимый VIP! Для тебя открыты все возможности!»</i>`
        : `<i>«Дарлинг, ты для меня самый особенный! Хочешь золотую корону и вечные безлимиты? Жми кнопку ниже или пиши /vip ⭐️»</i>`),
      { parse_mode: "HTML", reply_markup: loveKb || undefined, reply_to_message_id: ctx.message.message_id }
    );
    return;
  }

  // 4. Удар молнией в друга или в чат
  const isBoltRequest = /^(ударь молнией|ударить молнией|молния в|удар током|\/bolt)(?:\s|$|[,.!?])/i.test(cleanText);
  if (isBoltRequest) {
    try {
      await ctx.react("⚡");
    } catch (e) {}

    recordLightningBolt(ctx.from.id);
    let target = cleanText.replace(/^(ударь молнией|ударить молнией|молния в|удар током|\/bolt)\s*/i, "").trim();
    if (!target) {
      target = ctx.message.reply_to_message?.from?.first_name || "цель";
    }

    await ctx.reply(
      `✧ ─── ･ ｡ﾟ☆: *. ⚡ .* :☆ﾟ. ─── ✧\n` +
      `⚡⚡⚡ <b>РАЗРЯД 100 000 ВОЛЬТ!</b> ⚡⚡⚡\n\n` +
      `Лам взлетает в воздух с горящими глазами и направляет ослепительную молнию прямо в <b>${escapeHtml(target)}</b>! ⚡💥\n\n` +
      `<i>«БЗ-З-З-Т! Получай заряд бодрости от они-принцессы! В следующий раз не балуйся!»</i>`,
      { parse_mode: "HTML", reply_to_message_id: ctx.message.message_id }
    );
    return;
  }

  // 4.1. Дуэль молний между одноклассниками (/duel @username или "дуэль")
  const isDuelRequest = /^(дуэль|вызываю на дуэль|\/duel)(?:\s|$|[,.!?])/i.test(cleanText);
  if (isDuelRequest) {
    const challenger = ctx.from?.first_name || "Игрок 1";
    let defender = "случайный соперник";
    if (ctx.message.reply_to_message?.from?.first_name) {
      defender = ctx.message.reply_to_message.from.first_name;
    } else {
      const matchTarget = cleanText.replace(/^(дуэль|вызываю на дуэль|\/duel)\s*/i, "").trim();
      if (matchTarget) defender = matchTarget;
    }

    const hp1 = Math.floor(Math.random() * 40) + 60;
    const hp2 = Math.floor(Math.random() * 40) + 60;
    const winner = Math.random() > 0.5 ? challenger : defender;
    const volts = Math.floor(Math.random() * 900 + 100) * 1000;

    await ctx.reply(
      `✧ ─── ･ ｡ﾟ☆: *. ⚡ .* :☆ﾟ. ─── ✧\n` +
      `⚡⚡⚡ <b>БИТВА ОНИ-МОЛНИЙ НА АРЕНЕ ЛАМ!</b> ⚡⚡⚡\n\n` +
      `💥 <b>${escapeHtml(challenger)}</b> (⚔️ ${hp1} HP)  VS  <b>${escapeHtml(defender)}</b> (🛡️ ${hp2} HP)\n\n` +
      `⚡ <i>Раунд 1:</i> Заряд искр и прыжок в воздух!\n` +
      `⚡ <i>Раунд 2:</i> Ударная волна <b>${volts.toLocaleString()} ВОЛЬТ</b> сотрясает арену!\n` +
      `🏆 <b>ПОБЕДИТЕЛЬ ДУЭЛИ:</b> 👑 <b>${escapeHtml(winner)}</b>!\n\n` +
      `<i>«БЗ-З-З-Т! Проигравший получает утешительный разряд по пяткам! В следующий раз тренируйтесь лучше!»</i>`,
      { parse_mode: "HTML", reply_to_message_id: ctx.message.message_id }
    );
    return;
  }

  // 4.2. Рулетка молний в чате класса (/roulette или "рулетка")
  const isRouletteRequest = /^(рулетка|русская рулетка|\/roulette)(?:\s|$|[,.!?])/i.test(cleanText);
  if (isRouletteRequest) {
    const targets = [
      "кто не выучил уроки",
      "кто забыл сменку",
      "кто сидит в телефоне на первой парте",
      "кто не сдал тетрадь",
      "дежурный по классу",
      ctx.from?.first_name || "ты",
    ];
    const chosen = targets[Math.floor(Math.random() * targets.length)];
    const penalties = [
      "решить 5 уравнений у доски",
      "принести шоколадку Лам",
      "выучить стихотворение",
      "сделать 10 приседаний",
    ];
    const penalty = penalties[Math.floor(Math.random() * penalties.length)];

    await ctx.reply(
      `✧ ─── ･ ｡ﾟ☆: *. ⚡ .* :☆ﾟ. ─── ✧\n` +
      `🎰 <b>ОНИ-РУЛЕТКА МОЛНИЙ В КЛАССЕ!</b> ⚡\n\n` +
      `Барабан крутится... разряд наготове... ⚡💥\n` +
      `🎯 <b>Молния ударила в:</b> <b>${escapeHtml(chosen)}</b>!\n` +
      `📝 <b>Наказание от они-принцессы:</b> <i>${penalty}</i>!\n\n` +
      `<i>«БЗ-З-Т! Не спорьте с Лам, а то добавлю 200 000 вольт!»</i>`,
      { parse_mode: "HTML", reply_to_message_id: ctx.message.message_id }
    );
    return;
  }

  // 4.3. Они-Прожарка одноклассника (/roast @username или "прожарь @username")
  const isRoastRequest = /^(прожарь|прожарка|\/roast)(?:\s|$|[,.!?])/i.test(cleanText);
  if (isRoastRequest) {
    let target = ctx.message.reply_to_message?.from?.first_name;
    if (!target) {
      target = cleanText.replace(/^(прожарь|прожарка|\/roast)\s*/i, "").trim();
    }
    if (!target) target = ctx.from?.first_name || "друг";

    await handleIncoming(ctx, {
      userText: `Сделай забавную, дерзкую и добрую они-прожарку для ${target} в стиле Лам из аниме Urusei Yatsura. Подколи с юмором, без мата и грубости, упомяни школу или уроки!`,
      isRoast: true,
    });
    return;
  }

  // 4.4. Интерактивный Telegram Quiz Poll (/quiz [тема] или "квиз [тема]")
  const isQuizRequest = /^(квиз|викторина|тест|протестируй меня|\/quiz)(?:\s|$|[:.,!?])/i.test(cleanText);
  if (isQuizRequest) {
    let topic = cleanText.replace(/^(квиз|викторина|тест|протестируй меня|\/quiz)[:\s]*/i, "").trim();
    if (!topic) topic = "общие школьные знания и логика";

    await ctx.api.sendChatAction(ctx.chat.id, "typing");
    const quizData = await generateQuizPoll(topic);
    if (quizData) {
      try {
        await ctx.replyWithPoll(
          `⚡ [${topic.toUpperCase()}] ${quizData.question}`,
          quizData.options,
          {
            type: "quiz",
            correct_option_id: quizData.correct_id,
            explanation: quizData.explanation || "Правильный ответ от они-принцессы Лам! ⚡",
            is_anonymous: false,
            reply_to_message_id: ctx.message.message_id,
          }
        );
        return;
      } catch (err) {
        console.warn("Poll send failed:", err.message);
      }
    }
    await ctx.reply(
      "Ой, не смогла собрать вопросы для квиза! Попробуй уточнить тему, например: <code>/quiz столицы мира</code> или <code>/quiz законы физики</code>",
      { parse_mode: "HTML" }
    );
    return;
  }

  // 4.5. Шпаргалка ("шпора: [тема]", "/cheat [тема]")
  const isCheatSheetRequest = /^(шпора|сделай шпору|напиши шпору|микрошпора|\/cheat)(?:\s|$|[:.,!?])/i.test(cleanText);
  if (isCheatSheetRequest) {
    const topic = cleanText.replace(/^(шпора|сделай шпору|напиши шпору|микрошпора|\/cheat)[:\s]*/i, "").trim();
    if (!topic) {
      await ctx.reply(
        "Дарлинг, напиши тему для шпоры! Например: <code>шпора: Вторая мировая война</code> или <code>шпора: формулы по физике 8 класс</code>",
        { parse_mode: "HTML" }
      );
      return;
    }
    await handleIncoming(ctx, {
      userText: topic,
      isCheatSheet: true,
    });
    return;
  }

  // 4.6. Помощь с кодом ("код: [задача]", "сделай код", "/code [задача]")
  const isCodeRequest = /^(код|напиши код|сделай код|программа|напиши программу|скрипт|реши задачу на python|реши код|\/code)(?:\s|$|[:.,!?])/i.test(cleanText);
  if (isCodeRequest) {
    const task = cleanText.replace(/^(код|напиши код|сделай код|программа|напиши программу|скрипт|реши задачу на python|реши код|\/code)[:\s]*/i, "").trim();
    if (!task) {
      await ctx.reply(
        "Дарлинг, напиши задачу для кода! Например: <code>код: быстрая сортировка на python</code> или <code>код: мини сайт</code>",
        { parse_mode: "HTML" }
      );
      return;
    }
    await handleIncoming(ctx, {
      userText: task,
      isCodeSolver: true,
    });
    return;
  }

  // 4.7. Конструктор сочинений и эссе ("сочинение: [тема]", "/essay [тема]")
  const isEssayRequest = /^(сочинение|план сочинения|эссе|план эссе|\/essay)(?:\s|$|[:.,!?])/i.test(cleanText);
  if (isEssayRequest) {
    const topic = cleanText.replace(/^(сочинение|план сочинения|эссе|план эссе|\/essay)[:\s]*/i, "").trim();
    if (!topic) {
      await ctx.reply(
        "Дарлинг, напиши тему сочинения! Например: <code>сочинение: Тема любви в романе Дубровский</code>",
        { parse_mode: "HTML" }
      );
      return;
    }
    await handleIncoming(ctx, {
      userText: topic,
      isEssayHelper: true,
    });
    return;
  }

  // 5. Кино & Аниме радар
  const isMovieRequest = /^(найди фильм|найди аниме|посоветуй фильм|посоветуй аниме|фильм где|аниме где|что посмотреть|\/movie|\/anime)(?:\s|$|[,.!?])/i.test(cleanText);
  if (isMovieRequest) {
    await handleIncoming(ctx, {
      userText: cleanText,
      isMovieFinder: true,
    });
    return;
  }

  // 6. Пояснительная бригада (Зумерский сленг)
  const isSlangRequest = /^(поясни за сленг|что значит|поясни за|поясни мне за)(?:\s|$|[:.,!?])/i.test(cleanText);
  if (isSlangRequest) {
    await handleIncoming(ctx, {
      userText: cleanText,
      isSlangExplainer: true,
    });
    return;
  }

  // 7. Полиглот (Умный переводчик)
  const isTranslateRequest = /^(переведи на|перевод на|translate to)(?:\s|$|[:.,!?])/i.test(cleanText);
  if (isTranslateRequest) {
    await handleIncoming(ctx, {
      userText: cleanText,
      isTranslator: true,
    });
    return;
  }

  // 8. Конвертер конкретной валюты ("100 долларов в сомах", "1 btc в usd", "5000 рублей в сомах")
  const conversion = await convertCurrencyQuery(cleanText);
  if (conversion) {
    await ctx.reply(
      `✧ ─── ･ ｡ﾟ☆: *. ⚡ .* :☆ﾟ. ─── ✧\n` +
      `💱 <b>LUM • КУРСОВОЙ КОНВЕРТЕР</b> ✨\n\n` +
      `💵 <b>${conversion.amount} ${conversion.fromCode}</b> = <code>${conversion.result} ${conversion.toCode}</code>\n\n` +
      `<i>⚡ Данные обновлены в реальном времени с биржи! 💕</i>`,
      { parse_mode: "HTML", reply_to_message_id: ctx.message.message_id }
    );
    return;
  }

  // 9. Криптовалютный & Валютный рынок (Общий радар)
  const isMarketRequest = /^(курс валют|курс доллара|курс биткоина|крипта|криптовалюта|котировки|\/crypto|\/rates|\/currency)(?:\s|$|[:.,!?])|^курс$/i.test(
    cleanText
  );
  if (isMarketRequest) {
    const market = await getLiveMarketRates();
    if (market) {
      const { crypto: c, rates: r } = market;
      const eurRub = r.RUB && r.EUR ? (r.RUB / r.EUR).toFixed(2) : "0";
      const eurKgs = r.KGS && r.EUR ? (r.KGS / r.EUR).toFixed(2) : "0";
      await ctx.reply(
        `✧ ─── ･ ｡ﾟ☆: *. ⚡ .* :☆ﾟ. ─── ✧\n` +
        `💎 <b>LUM • CRYPTO & CURRENCY RADAR</b> ✨\n\n` +
        `₿ <b>Bitcoin (BTC):</b> <code>$${c.BTC.toLocaleString("en-US")}</code>\n` +
        `🔷 <b>Ethereum (ETH):</b> <code>$${c.ETH.toLocaleString("en-US")}</code>\n` +
        `💎 <b>Toncoin (TON):</b> <code>$${c.TON.toFixed(2)}</code>\n` +
        `☀️ <b>Solana (SOL):</b> <code>$${c.SOL.toFixed(2)}</code>\n\n` +
        `💵 <b>1 USD ($):</b>\n` +
        `├ <code>${r.KGS.toFixed(2)} KGS</code> (сом)\n` +
        `├ <code>${r.RUB.toFixed(2)} RUB</code> (руб)\n` +
        `└ <code>${r.KZT.toFixed(2)} KZT</code> (тенге)\n\n` +
        `💶 <b>1 EUR (€):</b>\n` +
        `├ <code>${eurKgs} KGS</code> (сом)\n` +
        `└ <code>${eurRub} RUB</code> (руб)\n\n` +
        `<i>💡 Напиши например: «100 долларов в сомах» или «10 ton в рублях»!</i>`,
        { parse_mode: "HTML", reply_to_message_id: ctx.message.message_id }
      );
      return;
    }
  }

  // 10. Генератор артов, стикеров, аватарок и мемов (Pollinations Flux AI)
  const isImageRequest = /^(нарисуй|сгенерируй фото|сгенерируй арт|сделай арт|создай фото|нарисуй мне|стикер|аватарка|аватарку|мем|\/art|\/draw|\/img)(?:\s|$|[:.,!?])/i.test(
    cleanText
  );
  if (isImageRequest) {
    const statusMsg = await ctx.reply("🎨 <i>Секундочку, Дарлинг, уже рисую шедевр для тебя...</i> ✨", {
      parse_mode: "HTML",
    });
    await ctx.api.sendChatAction(ctx.chat.id, "upload_photo");

    try {
      const { imageUrl, prompt } = await generateArtwork(cleanText);
      await ctx.replyWithPhoto(imageUrl, {
        caption: `✧ ─── ･ ｡ﾟ☆: *. ⚡ .* :☆ﾟ. ─── ✧\n🎨 <b>LUM • NEURAL ART</b> ✨\n\n<i>«${escapeHtml(prompt)}»</i>\n\n<i>Дарлинг, как тебе мой рисунок? 💕</i>`,
        parse_mode: "HTML",
        reply_to_message_id: ctx.message.message_id,
      });

      try {
        await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id);
      } catch (e) {}
      return;
    } catch (err) {
      console.error("Ошибка генерации арта:", err.message);
      try {
        await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id);
      } catch (e) {}
      await ctx.reply("Ой, Дарлинг, кисточки запутались( Попробуй описать картинку чуть иначе (｡•́︿•̀｡)");
      return;
    }
  }

  // 11. Поиск музыки и превью
  const isMusicRequest = /^(найди трек|найди песню|скинь трек|скинь песню|найди музыку|\/music|\/song)(?:\s|$|[:.,!?])/i.test(cleanText);
  if (isMusicRequest) {
    let statusMsg = null;
    try {
      statusMsg = await ctx.reply("🎵 <i>Секундочку, Дарлинг, ищу трек для твоих ушек...</i>", {
        parse_mode: "HTML",
        allow_sending_without_reply: true,
      });
    } catch (e) {}

    try {
      const track = await searchMusicTrack(cleanText);
      if (track) {
        const musicCaption =
          `✧ ─── ･ ｡ﾟ☆: *. ⚡ .* :☆ﾟ. ─── ✧\n` +
          `🎵 <b>${escapeHtml(track.trackName)}</b> — <i>${escapeHtml(track.artistName)}</i>\n` +
          `💿 Альбом: <code>${escapeHtml(track.albumName || "Сингл")}</code>\n\n` +
          `🎧 <a href="${track.trackViewUrl}">Слушать полностью в Apple Music</a>`;

        let delivered = false;
        if (track.artworkUrl) {
          try {
            await ctx.replyWithPhoto(track.artworkUrl, {
              caption: musicCaption,
              parse_mode: "HTML",
              allow_sending_without_reply: true,
            });
            delivered = true;
          } catch (photoErr) {
            console.warn("replyWithPhoto error:", photoErr.message);
          }
        }

        if (!delivered) {
          await ctx.reply(musicCaption, {
            parse_mode: "HTML",
            disable_web_page_preview: false,
            allow_sending_without_reply: true,
          });
        }

        if (track.previewUrl) {
          try {
            const audioRes = await fetch(track.previewUrl, { signal: AbortSignal.timeout(6000) });
            if (audioRes.ok) {
              const audioBuf = Buffer.from(await audioRes.arrayBuffer());
              await ctx.replyWithAudio(
                new InputFile(audioBuf, `${track.artistName} - ${track.trackName}.mp3`),
                {
                  title: track.trackName,
                  performer: track.artistName,
                  caption: "▶️ <i>Официальное превью трека (30 сек)</i>",
                  parse_mode: "HTML",
                  allow_sending_without_reply: true,
                }
              );
            }
          } catch (audioErr) {
            console.warn("replyWithAudio stream error:", audioErr.message);
          }
        }
      } else {
        await ctx.reply(
          "Хм, Дарлинг, не смогла найти этот трек( Попробуй указать исполнителя или название точнее!",
          { allow_sending_without_reply: true }
        );
      }
    } catch (err) {
      console.error("Ошибка поиска музыки:", err.message);
      await ctx.reply(
        "Хм, Дарлинг, музыкальный радар слегка сбился( Напиши название трека еще раз!",
        { allow_sending_without_reply: true }
      );
    } finally {
      if (statusMsg) {
        try {
          await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id);
        } catch (e) {}
      }
    }
    return;
  }

  // 12. Умные напоминания
  const reminder = parseReminderRequest(cleanText);
  if (reminder) {
    await ctx.reply(
      `✧ ─── ･ ｡ﾟ☆: *. ⚡ .* :☆ﾟ. ─── ✧\n⏰ <b>Договорились, Дарлинг!</b>\n\nЯ напомню тебе ровно через <b>${reminder.count} ${reminder.unitName}</b>:\n👉 <i>«${escapeHtml(reminder.reminderText)}»</i>\n\n<i>Не переживай, я ни за что не забуду! 💕</i>`,
      { parse_mode: "HTML", reply_to_message_id: ctx.message.message_id }
    );

    setTimeout(async () => {
      try {
        await ctx.api.sendMessage(
          ctx.chat.id,
          `✧ ─── ･ ｡ﾟ☆: *. ⚡ .* :☆ﾟ. ─── ✧\n🔔 <b>ДАРЛИНГ, НАПОМИНАЛКА!</b> ⚡\n\nТы просил напомнить:\n👉 <b>${escapeHtml(reminder.reminderText)}</b>\n\n<i>Время вышло, бегом делать! 💕</i>`,
          { parse_mode: "HTML" }
        );
      } catch (e) {
        console.error("Ошибка отправки напоминания:", e.message);
      }
    }, reminder.ms);

    return;
  }

  // 13. Метео-радар (Живая погода)
  const isWeatherRequest = /^(погода в|погода|какая погода в|какая погода|\/weather)(?:\s|$|[:.,!?])/i.test(cleanText);
  if (isWeatherRequest) {
    const weather = await getLiveWeather(cleanText);
    if (weather) {
      await ctx.reply(
        `✧ ─── ･ ｡ﾟ☆: *. ⚡ .* :☆ﾟ. ─── ✧\n` +
        `⛅ <b>МЕТЕО-РАДАР • ${escapeHtml(weather.city.toUpperCase())}</b> (${escapeHtml(weather.country)})\n\n` +
        `🌡 <b>Температура:</b> <code>${weather.temp > 0 ? "+" + weather.temp : weather.temp}°C</code>\n` +
        `🌤 <b>Небо:</b> <i>${weather.condition}</i>\n` +
        `💨 <b>Ветер:</b> <code>${weather.wind} км/ч</code>\n\n` +
        `💬 <i>${weather.advice}</i>`,
        { parse_mode: "HTML", reply_to_message_id: ctx.message.message_id }
      );
      return;
    }
  }

  // 14. Магический Шар 8-Ball от Лам
  const is8BallRequest = /^(шар судьбы|магический шар|шар|8ball|\/8ball|правда ли|стоит ли|ответь да или нет)(?:\s|$|[:.,!?])/i.test(cleanText);
  if (is8BallRequest) {
    const ball = askMagic8Ball(cleanText);
    await ctx.reply(
      `✧ ─── ･ ｡ﾟ☆: *. ⚡ .* :☆ﾟ. ─── ✧\n` +
      `🔮 <b>КОСМИЧЕСКИЙ ШАР СУДЬБЫ ЛАМ</b> ✨\n\n` +
      `❓ <i>«${escapeHtml(ball.question)}»</i>\n\n` +
      `🎯 <b>Вердикт:</b> ${ball.verdict}\n` +
      `📊 <b>Шанс успеха:</b> <code>${ball.prob}</code>\n\n` +
      `💬 <i>«${ball.comment}»</i>`,
      { parse_mode: "HTML", reply_to_message_id: ctx.message.message_id }
    );
    return;
  }

  // 15. Бросок монетки, костей или случайного числа
  const diceOrCoin = rollDiceOrCoin(cleanText);
  if (diceOrCoin) {
    await ctx.reply(
      `✧ ─── ･ ｡ﾟ☆: *. ⚡ .* :☆ﾟ. ─── ✧\n` +
      `⚡ <b>LUM • RANDOM ENGINE</b> 🎲\n\n` +
      `🎯 Результат: ${diceOrCoin.result}\n\n` +
      `💬 <i>«${diceOrCoin.comment}»</i>`,
      { parse_mode: "HTML", reply_to_message_id: ctx.message.message_id }
    );
    return;
  }

  // 16. Космический Гороскоп
  const isHoroscopeRequest = /^(гороскоп|мой гороскоп|астропрогноз|\/horoscope)(?:\s|$|[:.,!?])/i.test(cleanText);
  if (isHoroscopeRequest) {
    const h = getDailyHoroscope(cleanText);
    await ctx.reply(
      `✧ ─── ･ ｡ﾟ☆: *. ⚡ .* :☆ﾟ. ─── ✧\n` +
      `🪐 <b>КОСМИЧЕСКИЙ ГОРОСКОП • ${h.sign.toUpperCase()}</b> ✨\n\n` +
      `⚡ <b>Электромагнитная энергия:</b> <code>${h.energy}%</code>\n` +
      `🍀 <b>Счастливое число дня:</b> <code>${h.luckyNum}</code>\n\n` +
      `💌 <b>Совет от Лам:</b>\n` +
      `<i>«${h.advice}»</i>`,
      { parse_mode: "HTML", reply_to_message_id: ctx.message.message_id }
    );
    return;
  }

  // 17. Генератор надежных паролей
  const isPasswordRequest = /^(пароль|сгенерируй пароль|придумай пароль|новый пароль|\/password)(?:\s|$|[:.,!?])/i.test(cleanText);
  if (isPasswordRequest) {
    const p = generateSecurePassword(cleanText);
    await ctx.reply(
      `✧ ─── ･ ｡ﾟ☆: *. ⚡ .* :☆ﾟ. ─── ✧\n` +
      `🔐 <b>LUM • SECURITY KEY GENERATOR</b> ⚡\n\n` +
      `🔑 Твой сгенерированный пароль:\n` +
      `<code>${escapeHtml(p.password)}</code>\n\n` +
      `🛡 Длина: <code>${p.length} символов</code>\n` +
      `⏳ Время на взлом квантовым ПК: <code>~4.8 млрд лет</code>\n\n` +
      `<i>💡 Нажми на пароль, чтобы скопировать его в буфер обмена!</i>`,
      { parse_mode: "HTML", reply_to_message_id: ctx.message.message_id }
    );
    return;
  }

  // 18. Генератор QR-кодов
  const isQrRequest = /^(сделай qr|создай qr|qr-код|qr|\/qr)(?:\s|$|[:.,!?])/i.test(cleanText);
  if (isQrRequest) {
    const qr = getQrCodeUrl(cleanText);
    if (qr) {
      await ctx.replyWithPhoto(qr.qrUrl, {
        caption:
          `✧ ─── ･ ｡ﾟ☆: *. ⚡ .* :☆ﾟ. ─── ✧\n` +
          `📱 <b>LUM • QR GENERATOR</b> ✨\n\n` +
          `🔗 <code>${escapeHtml(qr.data)}</code>\n\n` +
          `<i>Дарлинг, сканируй камерой телефона! ✨</i>`,
        parse_mode: "HTML",
        reply_to_message_id: ctx.message.message_id,
      });
      return;
    }
  }

  // 19. Википедия (Эрудит)
  const isWikiRequest = /^(что такое|кто такой|кто такая|википедия|\/wiki)(?:\s|$|[:.,!?])/i.test(cleanText);
  if (isWikiRequest) {
    const wiki = await getWikiSummary(cleanText);
    if (wiki) {
      const captionText =
        `✧ ─── ･ ｡ﾟ☆: *. ⚡ .* :☆ﾟ. ─── ✧\n` +
        `📖 <b>${escapeHtml(wiki.title)}</b>\n\n` +
        `<i>${escapeHtml(wiki.extract)}</i>\n\n` +
        (wiki.pageUrl ? `🔗 <a href="${wiki.pageUrl}">Читать подробнее в Википедии</a>` : "");

      if (wiki.thumbnail) {
        try {
          await ctx.replyWithPhoto(wiki.thumbnail, {
            caption: captionText,
            parse_mode: "HTML",
            reply_to_message_id: ctx.message.message_id,
          });
          return;
        } catch (e) {}
      }

      await ctx.reply(captionText, {
        parse_mode: "HTML",
        reply_to_message_id: ctx.message.message_id,
      });
      return;
    }
  }

  // 20. Саммаризатор текста
  const isSummaryRequest = /^(кратко:|перескажи:|саммари:|выжимка:|\/summary)(?:\s|$|[:.,!?])/i.test(cleanText);
  if (isSummaryRequest) {
    await handleIncoming(ctx, {
      userText: cleanText.replace(/^(кратко:|перескажи:|саммари:|выжимка:|\/summary)\s*/i, "").trim(),
      isSummary: true,
    });
    return;
  }

  // 21. Нейро-Решебник задач АнтиГДЗ
  const isSolveRequest = /^(реши задачу|реши уравнение|помоги решить|реши:|реши|\/solve)(?:\s|$|[:.,!?])/i.test(cleanText);
  if (isSolveRequest) {
    await handleIncoming(ctx, {
      userText: cleanText.replace(/^(реши задачу|реши уравнение|помоги решить|реши:|реши|\/solve)\s*/i, "").trim(),
      isSolve: true,
    });
    return;
  }

  // 22. Живой интернет-радар в реальном времени (DuckDuckGo Live Search)
  const isSearchRequest = /^(загугли|найди в интернете|поиск в инете|поищи в интернете|новости|гугл|\/search|\/google)(?:\s|$|[:.,!?])/i.test(cleanText);
  if (isSearchRequest) {
    let query = cleanText.replace(/^(загугли|найди в интернете|поиск в инете|поищи в интернете|новости|гугл|\/search|\/google)[:\s]*/i, "").trim();
    if (!query) query = "главные мировые новости сегодня";

    await ctx.api.sendChatAction(ctx.chat.id, "typing");
    const statusMsg = await safeSendHtml(ctx, "🌐 <i>Лам подключает спутниковые радары и сканирует интернет...</i> ⚡");

    try {
      const searchResults = await fetchLiveSearchResults(query);
      if (!searchResults || searchResults.length === 0) {
        try { await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch (e) {}
        await ctx.reply("Дарлинг, мои радары ничего не нашли по этому запросу( Попробуй спросить другими словами (｡•́︿•̀｡)");
        return;
      }

      const snippetsText = searchResults.map((r, i) => `${i + 1}. [${r.title}]: ${r.snippet}`).join("\n\n");
      const searchPrompt = `[РЕАЛЬНЫЕ ДАННЫЕ ИЗ ИНТЕРНЕТА В РЕАЛЬНОМ ВРЕМЕНИ]:
Запрос Дарлинга: "${query}"
Свежая информация из поисковика DuckDuckGo:
${snippetsText}

ТВОЯ ЗАДАЧА КАК ЛАМ:
1. Сделай структурированный, понятный, актуальный ответ на русском языке на основе этих свежих данных.
2. Говори живым языком они-принцессы Лам (называй его Дарлинг, будь озорной и милой).
3. Изложи факты четко, без устаревшей информации.`;

      const aiAnswer = await generateLumResponse({
        contents: [{ role: "user", parts: [{ text: searchPrompt }] }],
        systemPrompt: LUM_SYSTEM_PROMPT,
        maxOutputTokens: 650,
        timeoutMs: 14000,
      });

      let sourcesHtml = `\n\n🌐 <b>Свежие источники из сети:</b>\n`;
      searchResults.slice(0, 3).forEach((r) => {
        sourcesHtml += `• <a href="${r.url}">${escapeHtml(r.title)}</a>\n`;
      });

      const fullReply = `✧ ─── ･ ｡ﾟ☆: *. ⚡ .* :☆ﾟ. ─── ✧\n` +
        `🌐 <b>ИНТЕРНЕТ-РАДАР ЛАМ • LIVE SEARCH</b> ⚡\n\n` +
        (aiAnswer || "Вот что мне удалось найти в сети по твоему запросу, Дарлинг:") +
        sourcesHtml;

      try { await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch (e) {}

      await safeSendHtml(ctx, fullReply, ctx.message.message_id);
      return;
    } catch (err) {
      console.error("Ошибка живого поиска:", err.message);
      try { await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch (e) {}
      await ctx.reply("Ой, Дарлинг, спутниковая связь забарахлила! Попробуй повторить запрос чуть позже (｡•́︿•̀｡)");
      return;
    }
  }

  // 23. Сборка домашки в PDF по фразе «собери в pdf», «сделай pdf»
  const isCompilePdfRequest = /^(собери в pdf|сделай pdf|собери pdf|объедини в pdf|готово pdf)(?:\s|$|[:.,!?])/i.test(cleanText);
  if (isCompilePdfRequest) {
    const userId = ctx.from?.id;
    const session = userId ? pdfSessions.get(userId) : null;
    if (session && session.images && session.images.length > 0) {
      await ctx.api.sendChatAction(ctx.chat.id, "upload_document");
      try {
        const pdfBuffer = await createPdfFromImages(session.images, `Домашка_${ctx.from?.first_name || "Дарлинга"}`);
        const fileName = `Домашка_${(ctx.from?.first_name || "Дарлинга").replace(/[^\wа-яА-ЯёЁ]/gi, "_")}.pdf`;
        await ctx.replyWithDocument(new InputFile(pdfBuffer, fileName), {
          caption: `✧ ─── ･ ｡ﾟ☆: *. ⚡ .* :☆ﾟ. ─── ✧\n📄 <b>Дарлинг, твоя домашка собрана в единый PDF!</b> 🎓✨\n\n• Страниц: <code>${session.images.length}</code>\n• Файл готов для отправки учителю!\n\n<i>«Лам аккуратно скрепила все листы своими они-лучами ✨»</i>`,
          parse_mode: "HTML",
          reply_to_message_id: ctx.message.message_id,
        });
        pdfSessions.delete(userId);
        return;
      } catch (err) {
        console.error("Ошибка сборки PDF:", err.message);
        await ctx.reply("Ой, не получилось собрать PDF из этих фото( Попробуй заново!");
        return;
      }
    } else {
      await ctx.reply(
        "Дарлинг, в очереди пока нет фото страниц! Сначала пришли мне фото тетрадей с подписью <code>pdf</code>, а потом напиши <code>«собери в pdf»</code> ✨",
        { parse_mode: "HTML" }
      );
      return;
    }
  }

  // Обычный диалог
  await handleIncoming(ctx, { userText: cleanText });
});

// Фотографии (с поддержкой чеков оплаты, PDF сборщика, АнтиГДЗ, Детектива переписок, OCR и анализа калорий)
bot.on("message:photo", async (ctx) => {
  if (ctx.from) recordInteraction(ctx.from.id);
  const photo = ctx.message.photo[ctx.message.photo.length - 1];
  const caption = ctx.message.caption || "";
  const userId = ctx.from?.id;

  // 0. Проверяем, является ли фото чеком оплаты (активная сессия или ключевые слова)
  const pendingSession = userId ? pendingPaymentSessions.get(userId) : null;
  const isReceiptKeyword = /(чек|оплат|квитанц|перевод|сбп|банк|тинькофф|сбер|mbank|деньги|оплатил|перевел)/i.test(caption);

  if (pendingSession || isReceiptKeyword) {
    const planInfo = pendingSession || {
      planId: "vip_check",
      planTitle: "VIP подписка (по чеку)",
      amount: 79,
      days: 3,
      currency: "RUB",
    };

    const order = createPaymentOrder({
      userId,
      name: ctx.from?.first_name || "Дарлинг",
      username: ctx.from?.username || "",
      planId: planInfo.planId,
      planTitle: planInfo.planTitle,
      days: planInfo.days,
      amount: planInfo.amount,
      currency: planInfo.currency,
      photoFileId: photo.file_id,
    });

    if (userId) pendingPaymentSessions.delete(userId);

    // Уведомление пользователю
    await ctx.reply(
      `✧ ─── ･ ｡ﾟ☆: *. 🧾 .* :☆ﾟ. ─── ✧\n` +
      `✅ <b>ЧЕК ПРИНЯТ НА ПРОВЕРКУ!</b> 💚✨\n\n` +
      `• Тариф: <b>${order.planTitle}</b>\n` +
      `• Сумма: <code>${order.amount} ${order.currency}</code>\n` +
      `• Номер заявки: <code>#${order.id}</code>\n\n` +
      `Лам уже передала твой чек Создателю бота на подтверждение. Обычно проверка занимает <b>1–5 минут</b>.\n` +
      `Как только Создатель подтвердит — у тебя мгновенно включится золотая корона VIP и безлимит! 👑⚡`,
      { parse_mode: "HTML", reply_to_message_id: ctx.message.message_id }
    );

    // Пересылка Создателю (всем администраторам)
    const adminNotificationKb = new InlineKeyboard()
      .text("✅ Подтвердить VIP", `pay_approve:${order.id}`)
      .text("❌ Отклонить", `pay_reject:${order.id}`);

    const durationLabel = order.days <= 0 ? "НАВСЕГДА 👑" : `${order.days} дн.`;
    const adminMsgText =
      `🔔 <b>НОВЫЙ ЧЕК НА ОПЛАТУ!</b> 🧾💰\n\n` +
      `👤 <b>От:</b> ${escapeHtml(order.name)} (@${order.username || "нет_юзернейма"})\n` +
      `🆔 <b>User ID:</b> <code>${order.userId}</code>\n` +
      `💎 <b>Тариф:</b> <b>${order.planTitle}</b> (${durationLabel})\n` +
      `💵 <b>Сумма:</b> <code>${order.amount} ${order.currency}</code>\n` +
      `🕒 <b>Время:</b> <code>${new Date().toLocaleTimeString("ru-RU")}</code>\n\n` +
      `<i>Посмотри прикрепленный чек и нажми кнопку ниже:</i>`;

    for (const admId of adminIds) {
      try {
        await bot.api.sendPhoto(admId, photo.file_id, {
          caption: adminMsgText,
          parse_mode: "HTML",
          reply_markup: adminNotificationKb,
        });
      } catch (err) {
        console.error("Не удалось отправить чек админу:", err.message);
      }
    }
    return;
  }

  // 1. Проверяем, связано ли фото с созданием PDF домашки/конспектов
  const isPdf = /(^|\s)(pdf|пдф|в pdf|в пдф|собери в pdf|собери pdf|сделай pdf)(\s|$)/i.test(caption);
  if (isPdf) {
    const userId = ctx.from?.id;
    if (userId) {
      if (!pdfSessions.has(userId)) {
        pdfSessions.set(userId, { images: [], lastUpdated: Date.now() });
      }
      const session = pdfSessions.get(userId);
      session.lastUpdated = Date.now();

      await ctx.api.sendChatAction(ctx.chat.id, "upload_document");
      try {
        const file = await bot.api.getFile(photo.file_id);
        const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
        const res = await fetch(fileUrl);
        const arrayBuf = await res.arrayBuffer();
        session.images.push(Buffer.from(arrayBuf));

        const shouldCompileNow = /(собери|сделай|готово)/i.test(caption);
        if (shouldCompileNow && session.images.length > 0) {
          const pdfBuffer = await createPdfFromImages(session.images, `Домашка_${ctx.from?.first_name || "Дарлинга"}`);
          const fileName = `Домашка_${(ctx.from?.first_name || "Дарлинга").replace(/[^\wа-яА-ЯёЁ]/gi, "_")}.pdf`;
          await ctx.replyWithDocument(new InputFile(pdfBuffer, fileName), {
            caption: `✧ ─── ･ ｡ﾟ☆: *. ⚡ .* :☆ﾟ. ─── ✧\n📄 <b>Дарлинг, твоя домашка собрана в единый PDF!</b> 🎓✨\n\n• Страниц: <code>${session.images.length}</code>\n• Файл готов для отправки учителю!\n\n<i>«Лам всё аккуратно скрепила своими они-лучами ✨»</i>`,
            parse_mode: "HTML",
            reply_to_message_id: ctx.message.message_id,
          });
          pdfSessions.delete(userId);
          return;
        }

        const pdfKb = new InlineKeyboard()
          .text(`📚 Собрать PDF (${session.images.length} стр.)`, "action:build_pdf")
          .text("❌ Сбросить", "action:clear_pdf");

        await ctx.reply(
          `✧ ─── ･ ｡ﾟ☆: *. ⚡ .* :☆ﾟ. ─── ✧\n` +
          `📄 <b>Страница #${session.images.length} добавлена в документ!</b>\n\n` +
          `Присылай следующее фото страницы или нажми кнопку ниже, чтобы сгенерировать готовый PDF файл для учителя:`,
          { parse_mode: "HTML", reply_markup: pdfKb, reply_to_message_id: ctx.message.message_id }
        );
        return;
      } catch (err) {
        console.error("Ошибка загрузки фото для PDF:", err.message);
      }
    }
  }

  const isSolve = /реши|дз|домашка|задач|уравнени|помоги|\/solve/i.test(caption);
  const isFood = /калори|еда|блюдо|съел|тарелк|кбжу/i.test(caption);
  const isChatDetective = /переписк|скрин|что ответить|что она имел|что он имел|как ответить|намёк|намек|флирт|помоги ответить/i.test(caption);
  const isOcr = /конспект|текст|сканируй|распознай|перепечатай|ocr|сфоткал тетрадь/i.test(caption);

  let fallback = `[Дарлинг прислал фото]:
Посмотри внимательно на изображение и расскажи, что на нем изображено (объекты, люди, персонажи, детали, текст или контекст).
Отреагируй живо, эмоционально, заботливо и с юмором от лица они-принцессы Лам, обращаясь к Дарлингу!`;
  if (isFood) {
    fallback = `[АНАЛИЗ БЛЮДА И КАЛОРИЙ]:
Посмотри на фото еды и определи:
🍽 <b>Блюдо:</b> (название)
⚖️ <b>Примерный вес:</b> (оценка в граммах)
🔥 <b>Калорийность и КБЖУ:</b> (~ккал, белки, жиры, углеводы)
💬 <b>Комментарий Лам:</b> (похвали или подколи Дарлинга в своем стиле!)`;
  }

  await handleIncoming(ctx, {
    userText: caption,
    fileId: photo.file_id,
    mimeType: "image/jpeg",
    fallbackText: fallback,
    isSolve: isSolve,
    isChatDetective: isChatDetective,
    isOcr: isOcr,
  });
});

// GIF-анимации (гифки из панели Telegram, Tenor, Giphy)
bot.on("message:animation", async (ctx) => {
  if (ctx.from) recordInteraction(ctx.from.id);
  const anim = ctx.message.animation;
  const caption = ctx.message.caption || "";

  let fileIdToAnalyze = null;
  let mimeType = "image/jpeg";

  // Используем JPEG-превью кадра анимации для сверхбыстрого и 100% точного распознавания в Gemini
  if (anim.thumbnail) {
    fileIdToAnalyze = anim.thumbnail.file_id;
    mimeType = "image/jpeg";
  } else if (anim.mime_type === "image/gif") {
    fileIdToAnalyze = anim.file_id;
    mimeType = "image/gif";
  } else {
    fileIdToAnalyze = anim.file_id;
    mimeType = anim.mime_type || "video/mp4";
  }

  const fallback = `[Дарлинг прислал GIF-анимацию/гифку (название: "${anim.file_name || 'гифка'}")]:
Посмотри внимательно на изображение/кадр из этой анимации.
1. Узнай, что здесь происходит: персонажей (если это аниме, сериал, мультфильм или мем — назови персонажей и тайтл!), их эмоции, забавные позы или реакцию.
2. Живо, эмоционально, с любовью и озорным юмором отреагируй на гифку от лица они-принцессы Лам, обращаясь к Дарлингу!`;

  await handleIncoming(ctx, {
    userText: caption,
    fileId: fileIdToAnalyze,
    mimeType: mimeType,
    fallbackText: fallback,
    isGif: true,
  });
});

// Голосовые сообщения (с автоматической сверхбыстрой расшифровкой через Groq Whisper)
bot.on("message:voice", async (ctx) => {
  if (ctx.from) recordInteraction(ctx.from.id);
  await ctx.api.sendChatAction(ctx.chat.id, "typing");

  let fastTranscript = null;
  if (groqPool.size > 0) {
    try {
      const file = await bot.api.getFile(ctx.message.voice.file_id);
      const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
      const res = await fetch(fileUrl);
      const arrayBuf = await res.arrayBuffer();
      fastTranscript = await transcribeAudioGroq(Buffer.from(arrayBuf), "voice.ogg");
    } catch (e) {
      console.warn("Groq Whisper voice error:", e.message);
    }
  }

  await handleIncoming(ctx, {
    userText: fastTranscript || ctx.message.caption,
    preTranscribed: fastTranscript,
    fileId: ctx.message.voice.file_id,
    mimeType: ctx.message.voice.mime_type || "audio/ogg",
    fallbackText: "[Дарлинг записал тебе голосовое сообщение]",
    isVoiceOrVideo: true,
    voiceType: "голосовое сообщение",
  });
});

// Кружочки (видео-сообщения со сверхбыстрой расшифровкой)
bot.on("message:video_note", async (ctx) => {
  if (ctx.from) recordInteraction(ctx.from.id);
  await ctx.api.sendChatAction(ctx.chat.id, "typing");

  let fastTranscript = null;
  if (groqPool.size > 0) {
    try {
      const file = await bot.api.getFile(ctx.message.video_note.file_id);
      const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
      const res = await fetch(fileUrl);
      const arrayBuf = await res.arrayBuffer();
      fastTranscript = await transcribeAudioGroq(Buffer.from(arrayBuf), "video.mp4");
    } catch (e) {
      console.warn("Groq Whisper video_note error:", e.message);
    }
  }

  await handleIncoming(ctx, {
    userText: fastTranscript,
    preTranscribed: fastTranscript,
    fileId: ctx.message.video_note.file_id,
    mimeType: "video/mp4",
    fallbackText: "[Дарлинг записал тебе видео-кружочек]",
    isVoiceOrVideo: true,
    voiceType: "видео-кружочек",
  });
});

// Видео (кадр для анализа через thumbnail)
bot.on("message:video", async (ctx) => {
  if (ctx.from) recordInteraction(ctx.from.id);
  const video = ctx.message.video;
  const fileIdToAnalyze = video.thumbnail?.file_id || video.file_id;
  const mimeType = video.thumbnail ? "image/jpeg" : (video.mime_type || "image/jpeg");

  await handleIncoming(ctx, {
    userText: ctx.message.caption,
    fileId: fileIdToAnalyze,
    mimeType: mimeType,
    fallbackText: "Я прислал тебе видео, посмотри этот кадр:",
  });
});

// Аудио
bot.on("message:audio", async (ctx) => {
  if (ctx.from) recordInteraction(ctx.from.id);
  await handleIncoming(ctx, {
    userText: ctx.message.caption,
    fileId: ctx.message.audio.file_id,
    mimeType: ctx.message.audio.mime_type || "audio/mp3",
    fallbackText: "Послушай этот трек/аудио:",
    isVoiceOrVideo: true,
    voiceType: "аудиозапись",
  });
});

// Документы (с поддержкой GIF-файлов)
bot.on("message:document", async (ctx) => {
  if (ctx.from) recordInteraction(ctx.from.id);
  const doc = ctx.message.document;

  const isGifDoc =
    doc.mime_type === "image/gif" ||
    (doc.file_name && doc.file_name.toLowerCase().endsWith(".gif"));

  if (isGifDoc) {
    const fileIdToAnalyze = doc.thumbnail?.file_id || doc.file_id;
    const mimeType = doc.thumbnail ? "image/jpeg" : "image/gif";
    await handleIncoming(ctx, {
      userText: ctx.message.caption,
      fileId: fileIdToAnalyze,
      mimeType: mimeType,
      fallbackText: `[Дарлинг прислал GIF-документ]: посмотри кадр из этой анимации, узнай персонажей/мем и живо отреагируй как Лам!`,
      isGif: true,
    });
    return;
  }

  await handleIncoming(ctx, {
    userText: ctx.message.caption,
    fileId: doc.file_id,
    mimeType: doc.mime_type || "application/octet-stream",
    fallbackText: `Я скинул тебе файл (${doc.file_name || "документ"}):`,
  });
});

// Обработка интерактивных кнопок действий под ответами ([💡 Объясни проще], [📚 Дай пример], [⚡ Другой вариант])
bot.callbackQuery(/^act:(simpler|example|alt)$/, async (ctx) => {
  const type = ctx.match[1];
  await ctx.answerCallbackQuery();

  const originalText = ctx.callbackQuery.message?.text || "";
  let promptText = "";
  if (type === "simpler") {
    promptText = `[ЗАПРОС: ОБЪЯСНИ ПРОЩЕ]\nРанее ты ответила:\n«${originalText}»\nДарлинг просит: объясни это ещё проще, своими словами, на пальцах как пятикласснику, коротко и ясно!`;
  } else if (type === "example") {
    promptText = `[ЗАПРОС: ДАЙ ПРИМЕР]\nРанее ты ответила:\n«${originalText}»\nДарлинг просит: приведи конкретный жизненный, школьный или практический пример, чтобы всё стало предельно понятно!`;
  } else if (type === "alt") {
    promptText = `[ЗАПРОС: ДРУГОЙ ВАРИАНТ]\nРанее ты ответила:\n«${originalText}»\nДарлинг просит: предложи другой вариант решения или альтернативный способ/взгляд на эту тему!`;
  }

  await ctx.api.sendChatAction(ctx.chat.id, "typing");
  try {
    const aiAnswer = await generateLumResponse({
      contents: [{ role: "user", parts: [{ text: promptText }] }],
      systemPrompt: LUM_SYSTEM_PROMPT,
      maxOutputTokens: 500,
      timeoutMs: 12000,
    });

    if (aiAnswer) {
      const followUpKb = new InlineKeyboard()
        .text("💡 Ещё проще", "act:simpler")
        .text("📚 Ещё пример", "act:example")
        .row()
        .text("⚡ Другой вариант", "act:alt");

      await ctx.reply(aiAnswer, {
        reply_to_message_id: ctx.callbackQuery.message.message_id,
        reply_markup: followUpKb,
      });
    }
  } catch (err) {
    console.warn("Callback action error:", err.message);
  }
});

// Обработка кнопки [🎵 Скачать MP3 звук из видео]
bot.callbackQuery(/^get_mp3:(.+)$/, async (ctx) => {
  const audioId = ctx.match[1];
  const info = videoAudioCache.get(audioId);
  await ctx.answerCallbackQuery({ text: "🎵 Секундочку, вытаскиваю аудиодорожку..." });

  if (!info) {
    await ctx.reply("Дарлинг, ссылка на это видео устарела! Отправь видео заново (｡•́︿•̀｡)");
    return;
  }

  await ctx.api.sendChatAction(ctx.chat.id, "upload_voice");
  try {
    const audioRes = await downloadAudio(info);
    if (!audioRes) {
      await ctx.reply("Ой, не удалось извлечь звук из этого видео( Попробуй другое видео (｡•́︿•̀｡)");
      return;
    }

    const caption = `✧ ─── ･ ｡ﾟ☆: *. ⚡ .* :☆ﾟ. ─── ✧\n🎵 <b>${escapeHtml(audioRes.title || info.title || "Звук из видео")}</b>\n⚡ <i>Аудиодорожка извлечена технологиями Лам! ✨</i>`;

    if (audioRes.directUrl) {
      try {
        await ctx.replyWithAudio(audioRes.directUrl, {
          title: audioRes.title || info.title || "Audio Track",
          performer: "LUM • Sound Extractor",
          caption,
          parse_mode: "HTML",
          reply_to_message_id: ctx.callbackQuery.message.message_id,
        });
        return;
      } catch (streamErr) {
        console.warn("Direct audio URL failed, falling back to file:", streamErr.message);
      }
    }

    if (audioRes.filePath) {
      await ctx.replyWithAudio(new InputFile(audioRes.filePath), {
        title: audioRes.title || info.title || "Audio Track",
        performer: "LUM • Sound Extractor",
        caption,
        parse_mode: "HTML",
        reply_to_message_id: ctx.callbackQuery.message.message_id,
      });
      cleanupFile(audioRes.filePath);
    }
  } catch (err) {
    console.error("Ошибка при извлечении аудио:", err.message);
    await ctx.reply("Ой, что-то пошло не так при извлечении звука (｡•́︿•̀｡)");
  }
});

// Сборка PDF по интерактивной кнопке
bot.callbackQuery("action:build_pdf", async (ctx) => {
  const userId = ctx.from?.id;
  const session = userId ? pdfSessions.get(userId) : null;
  await ctx.answerCallbackQuery({ text: "📄 Собираю PDF документ..." });

  if (!session || !session.images || session.images.length === 0) {
    await safeSendHtml(ctx, "В очереди нет сохраненных страниц! Отправь фото с подписью <code>pdf</code> (｡•́︿•̀｡)");
    return;
  }

  await ctx.api.sendChatAction(ctx.chat.id, "upload_document");
  try {
    const pdfBuffer = await createPdfFromImages(session.images, `Домашка_${ctx.from?.first_name || "Дарлинга"}`);
    const fileName = `Домашка_${(ctx.from?.first_name || "Дарлинга").replace(/[^\wа-яА-ЯёЁ]/gi, "_")}.pdf`;
    await ctx.replyWithDocument(new InputFile(pdfBuffer, fileName), {
      caption: `✧ ─── ･ ｡ﾟ☆: *. ⚡ .* :☆ﾟ. ─── ✧\n📄 <b>Дарлинг, твоя домашка собрана в PDF!</b> 🎓✨\n\n• Страниц: <code>${session.images.length}</code>\n• Готово для отправки учителю!\n\n<i>«Лам всё аккуратно скрепила своими они-лучами ✨»</i>`,
      parse_mode: "HTML",
      reply_to_message_id: ctx.callbackQuery.message.message_id,
    });
    pdfSessions.delete(userId);
  } catch (err) {
    console.error("Ошибка сборки PDF по кнопке:", err.message);
    await ctx.reply("Ой, не получилось собрать PDF документ( Попробуй заново!");
  }
});

// Сброс очереди PDF по кнопке
bot.callbackQuery("action:clear_pdf", async (ctx) => {
  const userId = ctx.from?.id;
  if (userId) pdfSessions.delete(userId);
  await ctx.answerCallbackQuery({ text: "Очередь PDF очищена!" });
  await ctx.reply("🗑️ Очередь страниц PDF очищена! Можешь начать заново ✨");
});

// Обработка данных из Telegram Mini App (Web App)
bot.on("message:web_app_data", async (ctx) => {
  if (ctx.from) recordInteraction(ctx.from.id);
  const data = ctx.message.web_app_data?.data;
  if (!data) return;

  if (data === "/morning") {
    const digest = await getMorningDigest("Бишкек", "близнецы");
    await safeSendHtml(ctx, digest, ctx.message.message_id);
  } else if (data === "/love") {
    const stats = recordInteraction(ctx.from.id);
    const bar = renderProgressBar(stats.loveLevel);
    await ctx.reply(
      `✧ ─── ･ ｡ﾟ☆: *. ⚡ .* :☆ﾟ. ─── ✧\n` +
      `💚 <b>ПРОФИЛЬ ДАРЛИНГА • СВЯЗЬ С ЛАМ</b> ✨\n\n` +
      `⚡ <b>Статус:</b> <code>Любимый Дарлинг 💕</code>\n` +
      `💖 <b>Уровень связи:</b> [<code>${bar}</code>] <b>${stats.loveLevel}%</b>\n` +
      `💬 <b>Сообщений вместе:</b> <code>${stats.count}</code>\n` +
      `⚡ <b>Выпущено молний:</b> <code>${stats.bolts}</code>\n\n` +
      `<i>«Дарлинг, ты заглядывал в мой профиль? Я почувствовала твои искорки! 💚✨»</i>`,
      { parse_mode: "HTML", reply_to_message_id: ctx.message.message_id }
    );
  } else {
    await handleIncoming(ctx, { userText: data });
  }
});

// Приветствие новых участников в группах или появление самой Лам в чате
bot.on("message:new_chat_members", async (ctx) => {
  const newMembers = ctx.message.new_chat_members || [];
  const myId = bot.botInfo?.id;

  for (const member of newMembers) {
    if (member.id === myId) {
      // Саму Лам добавили в группу
      await ctx.reply(
        `✧ ─── ･ ｡ﾟ☆: *. ⚡ .* :☆ﾟ. ─── ✧\n` +
        `⚡ <b>Приветики всем в чате! Я Лам!</b> 💚\n\n` +
        `Я они-принцесса, умею решать любые школьные задачи, писать код, собирать шпоры, качать видео из TikTok/Reels и бить молниями! ⚡\n\n` +
        `🎮 <b>Игры для компании:</b> /quiz (викторина), /duel (дуэль молний), /roulette, /roast\n` +
        `💬 Чтобы я ответила, просто тегните меня <code>@akilum_bot</code>, начните с <i>«Лам,...»</i> или ответьте на моё сообщение!\n\n` +
        `<i>Будет весело, обещаю! 💕✨</i>`,
        { parse_mode: "HTML" }
      );
      return;
    }
  }

  // В чат вошел новый человек (не бот)
  const nonBots = newMembers.filter((m) => !m.is_bot);
  if (nonBots.length > 0) {
    const names = nonBots.map((m) => escapeHtml(m.first_name)).join(", ");
    await ctx.reply(
      `⚡ О, новенькие на нашей орбите! Добро пожаловать, <b>${names}</b>! 💚\n\n` +
      `Я Лам — если понадобятся ответы на домашку, код, шпоры или треки — просто позови меня! Пиши <code>/help</code> или <code>/quiz</code> ⚡`,
      { parse_mode: "HTML", reply_to_message_id: ctx.message.message_id }
    );
  }
});

initProactiveScheduler(bot, getSmartSticker);

// Запуск WebApp сервера для Telegram Mini App & Admin Panel
startWebAppServer(Number(process.env.PORT) || 3000, {
  bot,
  isUserVip,
  setUserVip,
  removeUserVip,
  getAllVips,
  getUserDailyUsage,
  resetUserDailyUsage,
  resetAllDailyUsages,
  DAILY_FREE_LIMIT: botSettings.dailyFreeLimit || DAILY_FREE_LIMIT,
  recordInteraction,
  getLiveMarketRates,
  getLiveWeather,
  searchMusicTrack,
  ADMIN_USERNAME,
  ADMIN_PASSWORD,
  createAdminSession,
  isValidAdminSession,
  getFullAdminStats,
  getAllUsersList,
  broadcastMessage,
  botSettings,
  saveSettings,
  paymentOrders,
  approvePaymentOrder,
  rejectPaymentOrder,
  createPaymentOrder,
  VIP_PLANS,
  AI_MODELS,
  getUserModel,
  setUserModel,
  resolveTargetUser,
  giveUserBolts,
  giveUserLove,
  giveUserCustomTitle,
  botToken: token,
});

// Установка кнопки меню WebApp (если URL сконфигурирован)
const activeWebAppUrl = getWebAppUrl();
if (activeWebAppUrl) {
  bot.api
    .setChatMenuButton({
      menu_button: {
        type: "web_app",
        text: "App",
        web_app: { url: activeWebAppUrl },
      },
    })
    .catch((e) => console.warn("Menu button notice:", e.message));
}

// Регистрация списка команд в официальном меню Telegram
const BOT_COMMANDS = [
  { command: "start", description: "⚡ Главное меню" },
  { command: "vip", description: "⭐️ VIP статус и безлимит" },
  { command: "model", description: "🧠 Выбор нейро-модели (VIP)" },
  { command: "love", description: "💚 Твой статус и энергия" },
  { command: "quiz", description: "🎯 Викторина для тебя и группы" },
  { command: "duel", description: "⚔️ Битва они-молний" },
  { command: "roulette", description: "🎰 Рулетка наказаний" },
  { command: "roast", description: "🔥 Забавная они-прожарка" },
  { command: "pdf", description: "📄 Сборщик домашки в PDF" },
  { command: "help", description: "📚 Все команды и шпаргалка" },
];
bot.api.setMyCommands(BOT_COMMANDS).catch((e) => console.warn("setMyCommands notice:", e.message));

bot.catch((err) => {
  const ctx = err.ctx;
  console.error(`[Bot Catch] Ошибка при обработке апдейта ${ctx?.update?.update_id}:`, err.error);
});

bot.start();
console.log("⚡ Ультра-Лам запущена со всеми новейшими технологиями!");
