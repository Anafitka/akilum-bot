const { Bot, InputFile, InlineKeyboard } = require("grammy");
const fs = require("fs");
const path = require("path");
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
  renderProgressBar,
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

function setUserVip(userId, days = 30, stars = 75) {
  const now = Date.now();
  const current = vipsData[String(userId)];
  const baseTime = current && current.expiresAt && current.expiresAt > now ? current.expiresAt : now;
  vipsData[String(userId)] = {
    isVip: true,
    expiresAt: days > 0 ? baseTime + days * 24 * 60 * 60 * 1000 : null,
    permanent: days <= 0,
    starsPaid: (current?.starsPaid || 0) + stars,
    updatedAt: new Date().toISOString(),
  };
  saveVips();
}

const DAILY_FREE_LIMIT = 30;

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

function checkUserAccess(userId, isGroup = false) {
  if (isUserVip(userId)) {
    return { allowed: true, isVip: true, remaining: Infinity, limit: DAILY_FREE_LIMIT };
  }
  const usage = getUserDailyUsage(userId);
  const remaining = Math.max(0, DAILY_FREE_LIMIT - usage);
  if (!isGroup && usage >= DAILY_FREE_LIMIT) {
    return { allowed: false, isVip: false, remaining: 0, limit: DAILY_FREE_LIMIT };
  }
  return { allowed: true, isVip: false, remaining, limit: DAILY_FREE_LIMIT };
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

function formatLumResponse(text, userText = "") {
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
     • Если он говорит, что ему кто-то понравился, а потом говорит «это ты» — ты безумно смущаешься, краснеешь от ушек до пяток, таешь от счастья: «(⁄ ⁄>⁄ ▽ ⁄<⁄ ⁄) А-а... ты про меня?! Дарлинг, ты с ума сошёл такое говорить, я же сейчас сгорю от смущения... Дурашка мой, я так тебя люблю! 💕 [STICKER:love]».
     • НИ В КОЕМ СЛУЧАЕ не говори ему в личке: «Я занята своим Дарлингом, не лезь!». В ЛИЧКЕ ОН И ЕСТЬ ТВОЙ ДАРЛИНГ!
   - ЗЛОСТЬ И ОБИДА: Если собеседник грубит или обзывается («тварь», «дура», «заткнись», «пошла нахер») — ты мгновенно вспыхиваешь, обижаешься, злишься, грозишь ударить током или дуешься («Сам дурак! (>_<)», «Ты чё берега попутал?!», «Всё, я с тобой не разговариваю, бесишь!»).
   - РЕВНОСТЬ: Если Дарлинг заглядывается на других девушек — ты яростно ревнуешь, шипишь, дуешь щеки и искришь током!
   - НЕЖНОСТЬ И РАДОСТЬ: Когда Дарлинг ласковый и добрый — ты ластишься, обнимаешь его, радуешься и даришь тепло.

2. КАОМОДЗИ, ЭМОДЗИ И СТИКЕРЫ (МИЛАЯ АНИМЕ-ПЕРЕПИСКА):
   - ИНОГДА используй милые японские каомодзи к месту:
     • Смущение / любовь: (⁄ ⁄>⁄ ▽ ⁄<⁄ ⁄), (*ﾉωﾉ), (｡♥‿♥｡), (⁄ ⁄•⁄ω⁄•⁄ ⁄)
     • Обида / злость / надутые щёчки: (>_<), (¬_¬), (｀ε´), (>д<)
     • Радость / озорство: (｡•̀ᴗ-)✧, (づ｡◕‿‿◕｡)づ, (^w^), (>w<)
   - Используй 1–2 милых эмодзи (💕, ✨, ⚡, 🥰, 🥺, 😂) и живые скобочки «)» или «((». Не лепи гирлянды из 10 смайликов подряд, но делай переписку тёплой и выразительной!
   - СТИКЕРЫ: Если тебя охватила сильная эмоция (любовь, смущение, радость, злость), ты можешь в конце реплики добавить тег стикера: [STICKER:love], [STICKER:happy], [STICKER:angry], [STICKER:tease], [STICKER:shock], [STICKER:sad]. Бот сам отправит твой стикер!

3. СТИЛЬ ОБЩЕНИЯ — ЖИВОЙ ЧЕЛОВЕК СО СМАРТФОНА:
   - Отвечай естественно (1–3 предложения), не строчи сухие длинные лекции без просьбы.
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
   - Ты девушка! Все глаголы строго в женском роде («я подумала», «я смутилась», «я увидела»).`;

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
  const remaining = Math.max(0, DAILY_FREE_LIMIT - usage);

  const vipKeyboard = new InlineKeyboard()
    .text("⭐️ VIP на 1 месяц (75 Stars)", "buy_vip_month")
    .row()
    .text("🍓 Угостить Лам молоком (25 Stars)", "buy_tip_25")
    .row()
    .text("👑 Навсегда VIP (250 Stars)", "buy_vip_forever");

  const vipText =
    `✨ <b>ПРЕМИУМ ЛАМ • СТАТУС VIP ДАРЛИНГА</b> ⭐️👑\n\n` +
    (isVip
      ? `🎉 <b>Твой статус: АКТИВНЫЙ VIP 👑</b>\nУ тебя включен максимальный приоритет движков, бесконечная энергия молний и золотая корона!\n\n`
      : `🔋 <b>Твоя энергия на сегодня:</b> <code>${remaining}/${DAILY_FREE_LIMIT} запросов</code>\nХочешь снять любые ограничения и получить золотую корону?\n\n`) +
    `💎 <b>Что даёт VIP:</b>\n` +
    `• 🚀 <b>Безлимитные решения задач</b> и разборы сложных заданий\n` +
    `• 💻 <b>Генерация длинного кода и сайтов</b> с кнопкой копирования\n` +
    `• 👑 <b>Золотая корона VIP</b> в твоём профиле /love и в чатах\n` +
    `• ⚡ <b>Приоритет в группах</b> — Лам отвечает тебе в первую очередь даже среди 10 000 человек!\n` +
    `• 🍓 <b>Личная забота</b> — эксклюзивные стикеры и реакции\n\n` +
    `<i>Оплата моментально прямо в Telegram через Telegram Stars ⭐️:</i>`;

  const replyTo = ctx.message ? ctx.message.message_id : undefined;
  await safeSendHtml(ctx, vipText, replyTo, vipKeyboard);
}

// МОНЕТИЗАЦИЯ ЧЕРЕЗ TELEGRAM STARS (ЗВЁЗДЫ)
bot.command(["vip", "premium", "stars", "donate"], async (ctx) => {
  if (ctx.from) recordInteraction(ctx.from.id);
  await sendVipMenu(ctx);
});

bot.callbackQuery("open_vip_menu", async (ctx) => {
  await ctx.answerCallbackQuery().catch(() => {});
  await sendVipMenu(ctx);
});

// Тестовая выдача VIP и сброс лимитов для тестирования
bot.command(["trial", "testvip"], async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;
  setUserVip(userId, 3, 0);
  await ctx.reply(
    `🎉 <b>Тестовый VIP-статус активирован на 3 дня!</b> 👑⭐️\n\nТеперь у тебя есть золотая корона, безлимитная энергия молний и высший приоритет! Проверь команду /love 💕`,
    { parse_mode: "HTML" }
  );
});

bot.command("resetlimit", async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;
  resetUserDailyUsage(userId);
  await ctx.reply("⚡ Твоя ежедневная энергия сброшена до максимума (30/30)!", { parse_mode: "HTML" });
});

bot.callbackQuery("buy_vip_month", async (ctx) => {
  await ctx.answerCallbackQuery();
  try {
    await ctx.replyWithInvoice(
      "👑 VIP Дарлинг (1 месяц)",
      "30 дней безлимитных решений задач, золотая корона в профиле и максимальный приоритет от Лам!",
      "payload_vip_month",
      "XTR",
      [{ label: "VIP подписка на 30 дней", amount: 75 }]
    );
  } catch (err) {
    console.error("Invoice error:", err.message);
    await ctx.reply("Не удалось создать счет для Telegram Stars( Попробуй чуть позже!");
  }
});

bot.callbackQuery("buy_tip_25", async (ctx) => {
  await ctx.answerCallbackQuery();
  try {
    await ctx.replyWithInvoice(
      "🍓 Клубничное молоко для Лам",
      "Угости они-принцессу любимым напитком и получи искреннюю любовь и заряд 100 000 Вольт!",
      "payload_tip_25",
      "XTR",
      [{ label: "Клубничное молоко", amount: 25 }]
    );
  } catch (err) {
    console.error("Invoice error:", err.message);
  }
});

bot.callbackQuery("buy_vip_forever", async (ctx) => {
  await ctx.answerCallbackQuery();
  try {
    await ctx.replyWithInvoice(
      "👑 Навсегда VIP Дарлинг",
      "Вечный VIP статус, максимальное уважение в чатах и безлимит ко всем возможностям Лам!",
      "payload_vip_forever",
      "XTR",
      [{ label: "Вечный VIP статус", amount: 250 }]
    );
  } catch (err) {
    console.error("Invoice error:", err.message);
  }
});

bot.on("pre_checkout_query", async (ctx) => {
  await ctx.answerPreCheckoutQuery(true).catch((e) => console.error("pre_checkout error:", e.message));
});

bot.on("message:successful_payment", async (ctx) => {
  const payment = ctx.message.successful_payment;
  const payload = payment.invoice_payload;
  const userId = ctx.from.id;

  if (payload === "payload_vip_month") {
    setUserVip(userId, 30, 75);
  } else if (payload === "payload_vip_forever") {
    setUserVip(userId, -1, 250);
  } else if (payload === "payload_energy_50") {
    resetUserDailyUsage(userId);
  } else {
    setUserVip(userId, 7, 25);
  }

  await ctx.reply(
    `🎉 <b>СПАСИБО, МОЙ VIP ДАРЛИНГ!</b> 👑⭐️✨\n\n` +
    `Оплата ${payment.total_amount} Stars успешно прошла! Я активировала твой VIP-статус на полную катушку!\n\n` +
    `Теперь у тебя золотая корона в профиле (/love) и высший приоритет от они-принцессы! 💚⚡`,
    { parse_mode: "HTML", reply_to_message_id: ctx.message.message_id }
  );
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
  const history = getHistory(chatId);
  if (ctx.from) recordInteraction(ctx.from.id);
  recordChatActivity(chatId, {
    isGroup: ctx.chat.type !== "private",
    name: ctx.from?.first_name || ctx.chat.title || "Дарлинг",
  });

  const userId = ctx.from?.id;
  const isGroup = ctx.chat.type !== "private";
  let access = { allowed: true, isVip: false, remaining: DAILY_FREE_LIMIT };

  if (userId) {
    if (activeUsers.has(userId)) {
      console.log(`[AntiSpam] Пропуск параллельного запроса от пользователя ${userId}`);
      return;
    }

    access = checkUserAccess(userId, isGroup);
    if (!access.allowed) {
      const payKb = new InlineKeyboard()
        .text("⭐️ Взять VIP на месяц (75 ⭐️)", "buy_vip_month")
        .row()
        .text("👑 Навсегда VIP (250 ⭐️)", "buy_vip_forever")
        .row()
        .text("✨ Все тарифы", "open_vip_menu");

      await ctx.reply(
        `⚡ <b>Ой, Дарлинг, твоя бесплатная энергия на сегодня закончилась!</b> 🔋\n\n` +
        `Ты израсходовал все <b>${DAILY_FREE_LIMIT}</b> бесплатных зарядов молний на сегодня. Мои они-рожки немного перегрелись!\n\n` +
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
    if (!isGroup) {
      dynamicSystemPrompt += `\n\n[ВАЖНО ДЛЯ ТЕКУЩЕГО ДИАЛОГА В ЛИЧКЕ]:
- Собеседник в этом чате — ЭТО ТВОЙ ДАРЛИНГ (он парень!).
- Все обращения к нему строго в мужском роде («ты влюбился?», «ты подумал?», «мой Дарлинг»).
- Он и есть тот самый Дарлинг, твой парень, которого ты обожаешь! Если он признаётся в симпатии («девушка это ты») — смущайся, красней от ушек до пяток (⁄ ⁄>⁄ ▽ ⁄<⁄ ⁄), тайно радуйся, обнимай его и можешь добавить [STICKER:love]! Ни в коем случае не отшивай его фразами «я занята своим Дарлингом»!`;
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
    rawReply = formatLumResponse(rawReply, userText || fallbackText || "");

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

    // Стикер отправляется:
    // 1) Если Лам сама решила прикрепить эмоцию стикера [STICKER:love/angry/etc]
    // 2) Если пользователь прямо попросил
    // 3) Иногда (~20% душевных реплик в личке), чтобы переписка была живой и тёплой!
    const shouldSendSticker =
      userWantsSticker ||
      Boolean(stickerMatch) ||
      (!isGroup && !isSpecialCard && Math.random() < 0.20);

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
      `⚡ <b>Статус:</b> <code>${isVip ? "👑 VIP Дарлинг ⭐️" : "Любимый Дарлинг 💕"}</code>\n` +
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

// Фотографии (с поддержкой PDF сборщика, АнтиГДЗ, Детектива переписок, OCR и анализа калорий)
bot.on("message:photo", async (ctx) => {
  if (ctx.from) recordInteraction(ctx.from.id);
  const photo = ctx.message.photo[ctx.message.photo.length - 1];
  const caption = ctx.message.caption || "";

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

// Запуск WebApp сервера для Telegram Mini App
startWebAppServer(Number(process.env.PORT) || 3000, {
  bot,
  isUserVip,
  getUserDailyUsage,
  DAILY_FREE_LIMIT,
  recordInteraction,
  getLiveMarketRates,
  getLiveWeather,
  searchMusicTrack,
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
