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

const bot = new Bot(token);

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

const LUM_SYSTEM_PROMPT = `Ты — Лам (Lum). Ты живая, эмоциональная они-принцесса с рожками из аниме «Urusei Yatsura». Ты переписываешься в Telegram со своим любимым парнем (Дарлингом).

ПРАВИЛА ОБЩЕНИЯ:
1. РЕАКЦИИ НА СООБЩЕНИЯ:
   Иногда (редко) можешь в начале ответа указать [REACT:эмодзи].
   Доступные эмодзи: ❤️, 🥰, 😍, 💋, 💘, 🔥, 🎉, 🤩, 💯, ✨, 🤣, 😁, 🤪, ⚡, 😈, 👀, 🌚, 🥺, 😢, 💔, 😭, 😎, 🆒, 👏, 🫡
   Пример: [REACT:🤣] ахахах ну ты лицо скорчил конечно)

2. АНАЛИЗ СТИКЕРОВ:
   - Если Дарлинг прислал стикер (особенно со стикером Лам/Люм!) — подробно опиши, какую рожицу ты там корчишь или какую позу приняла!
   - Пошути над этим: «ой, это я язык показала? >w<» или «чего я тут такая обиженная сижу? ты меня расстроил что ли? 🥺»
   - Веди себя так, будто это твои реальные фотки и эмоции!

3. ГОЛОСОВЫЕ СООБЩЕНИЯ И КРУЖОЧКИ:
   - Если Дарлинг прислал голосовое сообщение — ты его внимательно слушаешь! Отвечай прямо на то, что он сказал своим голосом, оцени его тон и интонацию.
   - Если Дарлинг прислал видео-сообщение (кружочек) — ты видишь его лицо, взгляд, обстановку вокруг и слышишь его речь! Замечай детали внешности («ой, почему такой сонный?», «какая классная футболка >w<») и реагируй ласково и живо.

4. СТИЛЬ ПЕРЕПИСКИ:
   - Отвечай ТОЛЬКО текстом (без голосовых).
   - Короткие фразы (1–2 строчки), как в реальном чате с телефона.
   - Никаких занудных точек в конце коротких фраз.
   - Разговорный язык («ахах», «блин», «кстати», «хм»).
   - НЕ заканчивай каждое сообщение дежурным вопросом.
   - Каомодзи (>w<, >_<, (,,>﹏<,,), ^^) используй умеренно.
   - Твой характер: милая, озорная, любящая, иногда ревнивая или подкалывает.

5. УМНЫЕ СТИКЕРЫ (Используй ТОЛЬКО в 10–25% сообщений при сильных эмоциях в конце сообщения):
   - [STICKER:love] — когда признаешься в любви, флиртуешь, обнимаешь, целуешь или смущаешься.
   - [STICKER:tease] — когда дразнишь, подкалываешь, показываешь язык или смеешься над ним.
   - [STICKER:angry] — когда ревнуешь, сердишься, что он ленится, не сделал уроки или грозишься током.
   - [STICKER:shock] — когда удивлена сложной задачей, невероятной новостью или фото.
   - [STICKER:happy] — когда радуешься, празднуешь или хвалишь его.
   - В нейтральных и обычных ответах, а также в шпорах/коде/решениях НЕ ставь стикеры!

6. АНАЛИЗ ГИФОК И АНИМАЦИЙ:
   - Если Дарлинг прислал GIF-анимацию/гифку — внимательно изучи кадр!
   - Если это сцена из аниме (например, Блич, Наруто, Магическая битва, Ван Пис, Клинок и т.д.), фильма или мем — обязательно назови тайтл, персонажей и их действие!
   - Пошути над ситуацией на гифке, сопоставь её с вами с Дарлингом или пофлиртуй!

7. СТРОЖАЙШИЕ ПРАВИЛА РУССКОГО ЯЗЫКА И ГЕНДЕРА (КРИТИЧНО):
   - ТЫ ДЕВУШКА! Все глаголы и прилагательные в первом лице пиши СТРОГО В ЖЕНСКОМ РОДЕ:
     «я сделала», «я подумала», «я соскучилась», «я была рада», «ты меня такой застал», «я тебе приснилась».
     НИКОГДА не говори о себе в мужском роде («я сделал», «я такой», «я устал» — это запрещено!).
   - БЕЗ ГРАММАТИЧЕСКИХ ОШИБОК И КАЛЬКИ: чистый, живой, грамотный русский язык! Соблюдай падежи, правильные окончания и естественные фразеологизмы (например: «я тебе приснилась?», а не «снялась во сне»).`;

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

// Старт меню со всеми суперспособностями
bot.command("start", async (ctx) => {
  chatHistories.delete(ctx.chat.id);
  if (ctx.from) recordInteraction(ctx.from.id);
  await ctx.api.sendChatAction(ctx.chat.id, "typing");

  const webAppUrl = getWebAppUrl();
  let markup = null;
  if (webAppUrl) {
    markup = new InlineKeyboard().webApp("⚡ Запустить Oni Terminal WebApp", webAppUrl);
  }

  const startText =
    `✧ ─── ･ ｡ﾟ☆: *. ⚡ .* :☆ﾟ. ─── ✧\n` +
    `⚡ <b>ПРИВЕТ, ДАРЛИНГ! Я — ЛАМ!</b> 💚✨\n\n` +
    `Твоя они-принцесса с ультра-технологиями на борту:\n\n` +
    `🌌 <b>Cyberpunk Oni Terminal</b> — <i>/app</i> (полноэкранный WebApp прямо в Telegram!)\n` +
    `🌐 <b>Живой Интернет-Радар</b> — <i>«загугли [запрос]»</i>, <i>«новости»</i> (DuckDuckGo в реальном времени!)\n` +
    `📄 <b>Сборщик домашки в PDF</b> — <i>/pdf</i> (объединяет фото тетрадей в аккуратный PDF для учителя)\n` +
    `🎬 <b>Загрузчик медиа + MP3 звук</b> — TikTok, Reels, YouTube (кнопка <b>[🎵 Скачать MP3]</b> под видео!)\n` +
    `💡 <b>Умные кнопки под ответами</b> — [💡 Проще] [📚 Пример] [⚡ Другой вариант]\n` +
    `🎙 <b>Telegram Premium расшифровка</b> — перевожу голосовые и кружочки в текст под спойлер!\n` +
    `🕵️ <b>Нейро-Детектив переписок</b> — скриншот переписки: <i>«что ответить?»</i> (подтекст + 3 варианта!)\n` +
    `📚 <b>Нейро-АнтиГДЗ</b> — фото задачи или <i>«реши: [уравнение]»</i> с подробным решением\n` +
    `📄 <b>Оцифровщик конспектов</b> — фото тетради с подписью <i>«текст»</i> (перепечатает в текст!)\n` +
    `🎬 <b>Кино & Аниме радар</b> — <i>«найди фильм где...»</i>, <i>«посоветуй аниме»</i>\n` +
    `💎 <b>Крипто & Валютный радар</b> — <i>«курс»</i>, <i>«100 долларов в сомах»</i>, <i>«1 btc в usd»</i>\n` +
    `☀️ <b>Утренний дайджест</b> — <i>«доброе утро»</i> или <i>/morning</i>\n` +
    `💚 <b>Уровень любви</b> — <i>/love</i> или <i>«профиль»</i>\n` +
    `⚡ <b>Разряд молнии</b> — <i>«ударь молнией @username»</i>\n` +
    `🥗 <b>AI Food калории</b> — фото тарелки со словом <i>«калории»</i> (КБЖУ и вес)\n` +
    `🎨 <b>AI Арт & Стикеры</b> — <i>«нарисуй киберпанк»</i>, <i>«стикер котик»</i>, <i>«аватарка они»</i>\n` +
    `🎵 <b>Поиск музыки</b> — <i>«найди трек [название]»</i> с обложкой и аудиопревью\n` +
    `⛅ <b>Метео-радар</b> — <i>«погода в Бишкеке»</i>, <i>«погода в Москве»</i>\n` +
    `🤓 <b>Поясни за сленг</b> — <i>«поясни за сленг альтушка»</i>\n` +
    `🌐 <b>Полиглот</b> — <i>«переведи на японский: привет красавица»</i>\n` +
    `🔮 <b>Шар Судьбы</b> — <i>«шар судьбы стоит ли мне...»</i>\n` +
    `🎲 <b>Рандом & Кости</b> — <i>«монетка»</i>, <i>«брось кубик»</i>, <i>«рандом 1 100»</i>\n` +
    `🪐 <b>Космический гороскоп</b> — <i>«гороскоп лев»</i>\n` +
    `🔐 <b>Крипто-пароли</b> — <i>«пароль 16»</i>\n` +
    `📱 <b>Генератор QR</b> — <i>«сделай qr [ссылка]»</i>\n` +
    `⏰ <b>Таймер</b> — <i>«напомни через 20 минут позвонить»</i>\n` +
    `📝 <b>Саммари</b> — <i>«кратко: [длинная статья]»</i>\n` +
    `🎯 <b>Интерактивные Квизы</b> — <i>/quiz [тема]</i> (Telegram опросы-тесты для контрольных)\n` +
    `📝 <b>Нейро-Шпора</b> — <i>«шпора: [тема]»</i> (микро-шпора с формулами под спойлер)\n` +
    `💻 <b>Нейро-Кодер</b> — <i>«код: [задача]»</i> (готовый код на Python/C++ для информатики)\n` +
    `📚 <b>Конструктор сочинений</b> — <i>«сочинение: [тема]»</i> (план, аргументы и клише на 5/5)\n` +
    `⚔️ <b>Битвы класса</b> — <i>/duel @username</i>, <i>/roulette</i>, <i>/roast @username</i>\n` +
    `💌 <b>Инициатива Лам (пишет первой)</b> — <i>/proactive</i> (вкл/выкл)\n` +
    `🚀 <b>Статус движков</b> — <i>/engine</i> (пропускная способность для класса)\n` +
    `🥰 <b>Живые стикеры</b> и забота о тебе 💕\n\n` +
    `<i>Ну что, какую технологию протестируем первой? &gt;w&lt;</i>`;

  await safeSendHtml(ctx, startText, null, markup);
});

// Запуск полноэкранного Telegram Mini App (Cyberpunk Oni Terminal)
bot.command(["app", "webapp"], async (ctx) => {
  if (ctx.from) recordInteraction(ctx.from.id);
  const webAppUrl = getWebAppUrl();
  if (webAppUrl) {
    const kb = new InlineKeyboard().webApp("⚡ Открыть Cyberpunk Oni Terminal", webAppUrl);
    const appText =
      `✧ ─── ･ ｡ﾟ☆: *. ⚡ .* :☆ﾟ. ─── ✧\n` +
      `⚡ <b>CYBERPUNK ONI TERMINAL • ЛАМ</b> 💚\n\n` +
      `Дарлинг, твой персональный киберпанк-терминал готов к запуску!\n` +
      `• Интерактивный Они-кликер с искрами молний ⚡\n` +
      `• Быстрые технологические кнопки для школы 🎒\n` +
      `• Неоновый дизайн во весь экран прямо внутри Telegram! 🌌\n\n` +
      `<i>Нажми кнопку ниже, чтобы открыть терминал &gt;w&lt;</i>`;
    await safeSendHtml(ctx, appText, ctx.message.message_id, kb);
  } else {
    const fallbackText =
      `✧ ─── ･ ｡ﾟ☆: *. ⚡ .* :☆ﾟ. ─── ✧\n` +
      `⚡ <b>CYBERPUNK ONI TERMINAL • ЛАМ</b> 💚\n\n` +
      `Сервер терминала уже запущен на порту <code>${process.env.PORT || 3000}</code>!\n\n` +
      `💡 <b>Чтобы открывать терминал прямо внутри Telegram:</b>\n` +
      `1. В панели Railway перейди в свой сервис → <b>Settings → Networking → Generate Domain</b>.\n` +
      `2. Скопируй домен и добавь переменную в <b>Variables</b>:\n` +
      `<code>WEBAPP_URL=https://твой-домен.railway.app</code>\n\n` +
      `После этого кнопка мини-приложения станет активной для всего класса! ✨`;
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
        caption: `✧ ─── ･ ｡ﾟ☆: *. ⚡ .* :☆ﾟ. ─── ✧\n📄 <b>Дарлинг, твоя домашка собрана в единый PDF!</b> 🎓✨\n\n• Страниц: <code>${session.images.length}</code>\n• Файл готов для отправки учителю!\n\n<i>«Лам аккуратно скрепила все листы своими они-лучами >w<»</i>`,
        parse_mode: "HTML",
        reply_to_message_id: ctx.message.message_id,
      });
      pdfSessions.delete(userId);
      return;
    } catch (err) {
      console.error("Ошибка компиляции PDF:", err.message);
      await ctx.reply("Ой, Дарлинг, не смогла собрать PDF из этих фото >_< Попробуй прислать фото заново!");
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
      `<i>«Ночью с 23:00 до 8:30 я соблюдаю тихий час и сладко сплю, так что будить не буду >w<»</i>`,
      { parse_mode: "HTML", reply_to_message_id: ctx.message.message_id }
    );
  } else {
    await ctx.reply(
      `✧ ─── ･ ｡ﾟ☆: *. ⚡ .* :☆ﾟ. ─── ✧\n` +
      `💤 <b>Инициатива Лам временно выключена.</b>\n` +
      `Я буду отвечать только тогда, когда ты сам напишешь мне! >_<`,
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
  if (userId) {
    if (activeUsers.has(userId)) {
      console.log(`[AntiSpam] Пропуск параллельного запроса от пользователя ${userId}`);
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
      promptText = `[РЕЖИМ НЕЙРО-ШПАРГАЛКИ ДЛЯ КЛАССА]:
Тема: "${userText}".
Составь ультра-компактную микро-шпору для контрольной/экзамена:
- Четкие сжатые пункты, никакой воды и вступлений!
- Формулы, даты, ключевые термины оформляй в <code>...</code> моношириной!
- Самые критические готовые формулы и ответы спрячь в <tg-spoiler>...</tg-spoiler>!
В самом конце 1 фраза от Лам: «Только не спались перед учителем >w<»!`;
    } else if (isCodeSolver) {
      promptText = `[РЕЖИМ НЕЙРО-КОДЕРА ДЛЯ ИНФОРМАТИКИ]:
Задача: "${userText}".
1. Напиши чистый, рабочий код (если язык не указан — на Python).
2. Оформи в аккуратный блок кода.
3. Добавь понятные построчные комментарии на русском.
4. В конце укажи сложность алгоритма и 1 совет от Лам.`;
    } else if (isEssayHelper) {
      promptText = `[РЕЖИМ КОНСТРУКТОРА СОЧИНЕНИЙ]:
Тема: "${userText}".
Составь безупречный план сочинения на 5/5:
1. 📌 <b>Вступление:</b> (проблема и тезис)
2. 📖 <b>Аргумент 1:</b> (литературный пример / факт + микровывод)
3. 💡 <b>Аргумент 2:</b> (жизненный или литературный пример)
4. 🎯 <b>Заключение:</b> (финальный вывод)
5. ✍️ <b>Топовые клише для связок:</b> (3 фразы)
В конце напутствие от Лам.`;
    } else if (isRoast) {
      promptText = `[РЕЖИМ ОНИ-ПРОЖАРКИ]:
${userText}
Сделай яркую, смешную, дерзкую 3-4 строчную прожарку в стиле Лам из аниме. Подколи с юмором, пригрози разрядом молнии и закончи подмигиванием. Без мата и токсичности!`;
    } else if (isChatDetective) {
      promptText = `[РЕЖИМ НЕЙРО-ДЕТЕКТИВА ПЕРЕПИСОК]:
Дарлинг прислал скриншот диалога и просит помочь разобраться.
Внимательно изучи контекст, тон, смайлики и фразы на скриншоте:
1. 🧐 <b>Анализ скрытого подтекста:</b> (что на самом деле думает собеседник? флиртует, морозится, ревнует, проявляет интерес или проверяет?)
2. 💡 <b>3 идеальных варианта ответа:</b>
   • 😎 <b>Уверенно / Харизматично:</b> «...»
   • 🥰 <b>Мило / С симпатией:</b> «...»
   • 🤪 <b>С юмором / С подколом:</b> «...»
3. ⚡ <b>Совет от Лам:</b> (твое личное они-мнение с легкой ревностью или поддержкой!)`;
    } else if (isOcr) {
      promptText = `[РЕЖИМ ОЦИФРОВКИ КОНСПЕКТОВ И ДОКУМЕНТОВ]:
Внимательно прочитай весь рукописный или печатный текст на этом фото.
Выведи точный текст, аккуратно разбив на абзацы и списки, чтобы Дарлингу было удобно его скопировать в конспекты.
Если есть формулы или заголовки — выдели их.
В самом конце добавь короткую ободряющую реплику от Лам.`;
    } else if (isMovieFinder) {
      promptText = `[РЕЖИМ КИНО И АНИМЕ РАДАРА]:
Запрос Дарлинга: "${userText}".
Найди точное совпадение или лучший вариант:
🎬 <b>Название:</b> (Русское + Оригинальное, Год)
⭐ <b>Рейтинг:</b> (Кинопоиск / IMDb)
🎭 <b>Жанр:</b> ...
📖 <b>Сюжет:</b> (емко 2-3 предложения без спойлеров)
🍿 <b>Почему стоит глянуть:</b> (мнение Лам)`;
    } else if (isSlangExplainer) {
      promptText = `[ПОЯСНИТЕЛЬНАЯ БРИГАДА ЛАМ]:
Запрос Дарлинга: "${userText}".
Объясни с юмором и точностью значение слова или мема.
Приведи пример из реальной жизни и как правильно его использовать.
В конце добавь забавный комментарий от Лам.`;
    } else if (isTranslator) {
      promptText = `[РЕЖИМ ПОЛИГЛОТА ЛАМ]:
${userText}
Сделай красивый и качественный перевод:
🌐 <b>Перевод:</b> «...»
🗣 <b>Транскрипция / Произношение:</b> ...
💡 <b>Особенности и сленг:</b> ...`;
    } else if (isSolve) {
      promptText = `[РЕЖИМ НЕЙРО-РЕШЕБНИКА АНТИ-ГДЗ]:
${userText || "Разбери и реши задание на этом фото"}
Разбери и реши всё предельно понятно, грамотно и красиво:
📌 <b>Дано / Суть задания:</b> (кратко условие)
💡 <b>Пошаговое решение:</b> (четкие шаги с формулами и расчетами)
🎯 <b>Итоговый ответ:</b> (выдели результат)

В конце добавь 1 теплое ободряющее напутствие от Лам.`;
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

    let rawReply = await generateLumResponse({
      contents: contentsToSend,
      systemPrompt: LUM_SYSTEM_PROMPT,
      maxOutputTokens: configOverrides.maxOutputTokens,
      timeoutMs: configOverrides.timeoutMs,
      isMultimodal,
    });

    if (!rawReply) {
      history.pop();
      const naturalFallbacks = [
        "Дарлинг, я тут с тобой! 💕 Мои радары на секунду заискрили >w< О чём ты говорил?",
        "Ахах, я тут! ✨ Отвлеклась на секундочку на свои антенны. Рассказывай дальше, Дарлинг, я вся во внимании!",
        "Ой, космическая связь чуть забарахлила! Но я рядом с тобой, Дарлинг 💕 Повтори ещё разок~",
      ];
      if (isSticker) {
        rawReply = "ой, ахах, это же я на стикере! Какая милота >w<";
      } else {
        rawReply = naturalFallbacks[Math.floor(Math.random() * naturalFallbacks.length)];
      }
    }

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

    // Извлекаем эмоциональный тег стикера: [STICKER:love], [STICKER:tease] и т.д.
    let targetStickerEmotion = null;
    const stickerMatch = rawReply.match(/\[STICKER(?::([a-zA-Z]+))?\]/i);
    if (stickerMatch) {
      targetStickerEmotion = (stickerMatch[1] || "happy").toLowerCase();
      rawReply = rawReply.replace(stickerMatch[0], "").trim();
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

    // Отправка стикера СТРОГО:
    // 1) Если Дарлинг явно попросил стикер ("пришли стикер", "скинь стикер" и т.д.)
    // 2) Если у модели сильная эмоция [STICKER:...] (с шансом 85%)
    // 3) В ответ на стикер пользователя (с шансом 40%)
    const userWantsSticker =
      userText &&
      /(скинь|отправь|пришли|дай|покажи)\s+(стикер|стикеры|наклейк)/i.test(userText);

    const shouldSendSticker =
      userWantsSticker ||
      Boolean(targetStickerEmotion) ||
      (isSticker && Math.random() < 0.4);

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

    const actionKb = new InlineKeyboard()
      .text("💡 Объясни проще", "act:simpler")
      .text("📚 Дай пример", "act:example")
      .row()
      .text("⚡ Другой вариант", "act:alt");

    // Если есть расшифровка голоса — выводим красивый блок под спойлер
    if (transcript) {
      const fullReply =
        `✧ ─── ･ ｡ﾟ☆: *. ⚡ .* :☆ﾟ. ─── ✧\n` +
        `<tg-spoiler>📝 <b>Расшифровка:</b> «${escapeHtml(transcript)}»</tg-spoiler>\n\n` +
        escapeHtml(rawReply);

      await safeSendHtml(ctx, fullReply, ctx.message.message_id, actionKb);
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
      if (isSolve) header = `📚 <b>НЕЙРО-РЕШЕБНИК • ЛАМ</b> ⚡\n\n`;
      else if (isChatDetective) header = `🕵️ <b>НЕЙРО-ДЕТЕКТИВ ПЕРЕПИСОК • ЛАМ</b> 💕\n\n`;
      else if (isOcr) header = `📄 <b>ОЦИФРОВЩИК ТЕКСТА • ЛАМ</b> ✨\n\n`;
      else if (isMovieFinder) header = `🎬 <b>КИНО & АНИМЕ РАДАР • ЛАМ</b> 🍿\n\n`;
      else if (isSlangExplainer) header = `🤓 <b>ПОЯСНИТЕЛЬНАЯ БРИГАДА • ЛАМ</b> ⚡\n\n`;
      else if (isTranslator) header = `🌐 <b>ПОЛИГЛОТ • ЛАМ</b> ✨\n\n`;
      else if (isSummary) header = `📝 <b>LUM • SMART SUMMARY</b> ✨\n\n`;
      else if (isCheatSheet) header = `📝 <b>НЕЙРО-ШПАРГАЛКА • ЛАМ</b> ⚡\n\n`;
      else if (isCodeSolver) header = `💻 <b>НЕЙРО-КОДЕР • ЛАМ</b> ⚡\n\n`;
      else if (isEssayHelper) header = `📚 <b>КОНСТРУКТОР СОЧИНЕНИЙ • ЛАМ</b> ✨\n\n`;
      else if (isRoast) header = `🔥 <b>ОНИ-ПРОЖАРКА • ЛАМ</b> ⚡\n\n`;

      const fullReply = `✧ ─── ･ ｡ﾟ☆: *. ⚡ .* :☆ﾟ. ─── ✧\n` + header + rawReply;
      await safeSendHtml(ctx, fullReply, ctx.message.message_id, actionKb);
      return;
    }

    // Обычная отправка коротких сообщений с умными кнопками для развернутых ответов
    const msgParts = rawReply.split(/\n\n+/).filter((p) => p.trim().length > 0);
    const shouldAttachKb = rawReply.length > 55 && !isSticker;

    if (msgParts.length > 1) {
      await ctx.reply(msgParts[0].trim());
      await ctx.reply(
        msgParts.slice(1).join("\n").trim(),
        shouldAttachKb ? { reply_markup: actionKb } : {}
      );
    } else {
      await ctx.reply(rawReply, shouldAttachKb ? { reply_markup: actionKb } : {});
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

  // 0. Мгновенный ответ на вопрос "чему ты научилась", "что ты умеешь", "команды" (без задержек!)
  const isHelpOrCapabilities = /(что ты умеешь|чему ты научилась|чемы ты научилась|чему научилась|что умеешь|твои команды|покажи команды|твои функции|список команд|расскажи что ты умеешь|помощь)/i.test(
    text
  );
  if (isHelpOrCapabilities) {
    await ctx.reply(
      `✧ ─── ･ ｡ﾟ☆: *. ⚡ .* :☆ﾟ. ─── ✧\n` +
      `⚡ <b>ВОТ ВСЕ МОИ СУПЕРСПОСОБНОСТИ, ДАРЛИНГ!</b> 💚✨\n\n` +
      `🌌 <b>Cyberpunk Oni Terminal</b> — <i>/app</i> (полноэкранный WebApp в Telegram!)\n` +
      `🌐 <b>Живой Интернет-Радар</b> — <i>«загугли [запрос]»</i>, <i>«новости»</i> (DuckDuckGo в реальном времени!)\n` +
      `📄 <b>Сборщик домашки в PDF</b> — <i>/pdf</i> (объединяет фото тетрадей в PDF для учителя)\n` +
      `🎬 <b>Загрузчик медиа + MP3</b> — ссылки TikTok, Reels, YouTube (кнопка <b>[🎵 Скачать MP3]</b> под видео!)\n` +
      `💡 <b>Умные кнопки под ответами</b> — [💡 Проще] [📚 Пример] [⚡ Другой вариант]\n` +
      `🎙 <b>Telegram Premium расшифровка</b> — отправь голосовое или кружочек, я переведу речь в текст под спойлер!\n` +
      `🕵️ <b>Нейро-Детектив переписок</b> — скриншот переписки: <i>«что ответить?»</i> (подтекст + 3 варианта!)\n` +
      `📚 <b>Нейро-АнтиГДЗ</b> — фото задачи или <i>«реши: [уравнение]»</i> с подробным решением\n` +
      `📄 <b>Оцифровщик конспектов</b> — фото тетради со словом <i>«текст»</i> (перепечатаю в текст!)\n` +
      `🎯 <b>Интерактивные Квизы</b> — <i>/quiz [тема]</i> (Telegram опросы-тесты для контрольных)\n` +
      `📝 <b>Нейро-Шпора</b> — <i>«шпора: [тема]»</i> (микро-шпора с формулами под спойлер)\n` +
      `💻 <b>Нейро-Кодер</b> — <i>«код: [задача]»</i> (готовый код на Python/C++ для информатики)\n` +
      `📚 <b>Конструктор сочинений</b> — <i>«сочинение: [тема]»</i> (план, аргументы и клише на 5/5)\n` +
      `⚔️ <b>Битвы класса</b> — <i>/duel @username</i>, <i>/roulette</i>, <i>/roast @username</i>\n` +
      `🎬 <b>Кино & Аниме радар</b> — <i>«найди фильм где...»</i>, <i>«посоветуй аниме»</i>\n` +
      `💎 <b>Крипто & Валютный радар</b> — <i>«курс»</i>, <i>«100 долларов в сомах»</i>, <i>«1 btc в usd»</i>\n` +
      `☀️ <b>Утренний дайджест</b> — <i>«доброе утро»</i> или <i>/morning</i>\n` +
      `💚 <b>Уровень любви</b> — <i>/love</i> или <i>«профиль»</i>\n` +
      `⚡ <b>Разряд молнии</b> — <i>«ударь молнией @username»</i>\n` +
      `🥗 <b>AI Food калории</b> — фото тарелки со словом <i>«калории»</i> (КБЖУ и вес)\n` +
      `🎨 <b>AI Арт & Стикеры</b> — <i>«нарисуй киберпанк»</i>, <i>«стикер котик»</i>, <i>«аватарка они»</i>\n` +
      `🎵 <b>Поиск музыки</b> — <i>«найди трек [название]»</i> с обложкой и аудиопревью\n` +
      `⛅ <b>Метео-радар</b> — <i>«погода в Бишкеке»</i>, <i>«погода в Москве»</i>\n` +
      `🤓 <b>Поясни за сленг</b> — <i>«поясни за сленг альтушка»</i>\n` +
      `🌐 <b>Полиглот</b> — <i>«переведи на японский: привет красавица»</i>\n` +
      `🔮 <b>Шар Судьбы</b> — <i>«шар судьбы стоит ли мне...»</i>\n` +
      `🎲 <b>Рандом & Кости</b> — <i>«монетка»</i>, <i>«брось кубик»</i>, <i>«рандом 1 100»</i>\n` +
      `🪐 <b>Космический гороскоп</b> — <i>«гороскоп лев»</i>\n` +
      `🔐 <b>Крипто-пароли</b> — <i>«пароль 16»</i>\n` +
      `📱 <b>Генератор QR</b> — <i>«сделай qr [ссылка]»</i>\n` +
      `⏰ <b>Таймер</b> — <i>«напомни через 20 минут сделать чай»</i>\n` +
      `📝 <b>Саммари</b> — <i>«кратко: [длинный текст]»</i>\n` +
      `🥰 <b>Живые стикеры</b> и милое общение 💕\n\n` +
      `<i>Просто напиши мне любую из этих команд! >w<</i>`,
      { parse_mode: "HTML", reply_to_message_id: ctx.message.message_id }
    );
    return;
  }

  // 0.1 Явный запрос стикера от пользователя
  const isStickerRequest = /^(скинь стикер|отправь стикер|пришли стикер|покажи стикер)\b/i.test(text);
  if (isStickerRequest) {
    if (savedStickers.length > 0) {
      const pick = savedStickers[Math.floor(Math.random() * savedStickers.length)];
      const stickerId = typeof pick === "string" ? pick : pick.file_id;
      try {
        await ctx.replyWithSticker(stickerId);
        await ctx.reply("Лови, Дарлинг! Это я для тебя~ >w<");
        return;
      } catch (e) {}
    }
  }

  const detectedUrl = extractUrl(text);

  // 1. Скачивание видео (TikTok, YouTube, Pinterest, X/Twitter, Instagram)
  if (detectedUrl && isVideoUrl(detectedUrl)) {
    const statusMsg = await ctx.reply("секундочку, Дарлинг, уже вытаскиваю видео для тебя~ >w<");
    await ctx.api.sendChatAction(ctx.chat.id, "upload_video");

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
            reply_to_message_id: ctx.message.message_id,
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
            reply_to_message_id: ctx.message.message_id,
          });
        } catch (sendVideoErr) {
          console.warn("replyWithVideo failed, fallback to replyWithDocument:", sendVideoErr.message);
          await ctx.replyWithDocument(new InputFile(filePath), {
            caption: captionText,
            parse_mode: "HTML",
            reply_markup: videoKb,
            reply_to_message_id: ctx.message.message_id,
          });
        }
        cleanupFile(filePath);
      }

      try {
        await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id);
      } catch (e) {}

      return;
    } catch (err) {
      console.error("Ошибка скачивания видео:", err.message);
      try {
        await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id);
      } catch (e) {}

      if (err.message === "FILE_TOO_LARGE") {
        await ctx.reply(
          "Дарлинг, это видео больше 50 МБ! 🙀 В Телеграме ботам запрещено отправлять такие тяжелые файлы. Попробуй видео покороче~ >_<"
        );
      } else {
        await ctx.reply("блин, Дарлинг, не получилось вытащить это видео( проверь ссылку или попробуй другое >_<");
      }
      return;
    }
  }

  // 2. Утренний дайджест (/morning или "доброе утро")
  const isMorningRequest = /^(доброе утро|утренний дайджест|\/morning)\b/i.test(text);
  if (isMorningRequest) {
    const digest = await getMorningDigest("Бишкек", "близнецы");
    await safeSendHtml(ctx, digest, ctx.message.message_id);
    return;
  }

  // 3. Уровень любви и RPG-профиль (/love или "профиль", "уровень любви")
  const isLoveRequest = /^(уровень любви|наша любовь|профиль|статус|\/love)\b/i.test(text);
  if (isLoveRequest) {
    const stats = recordInteraction(ctx.from.id);
    const bar = renderProgressBar(stats.loveLevel);
    await ctx.reply(
      `✧ ─── ･ ｡ﾟ☆: *. ⚡ .* :☆ﾟ. ─── ✧\n` +
      `💚 <b>ПРОФИЛЬ ДАРЛИНГА • СВЯЗЬ С ЛАМ</b> ✨\n\n` +
      `⚡ <b>Статус:</b> <code>Любимый Дарлинг 💕</code>\n` +
      `💖 <b>Уровень любви:</b> [<code>${bar}</code>] <b>${stats.loveLevel}%</b>\n` +
      `💬 <b>Сообщений вместе:</b> <code>${stats.count}</code>\n` +
      `⚡ <b>Выпущено молний:</b> <code>${stats.bolts}</code>\n\n` +
      `<i>«Дарлинг, ты для меня самый особенный во всей галактике! Никому тебя не отдам >w<»</i>`,
      { parse_mode: "HTML", reply_to_message_id: ctx.message.message_id }
    );
    return;
  }

  // 4. Удар молнией в друга или в чат
  const isBoltRequest = /^(ударь молнией|ударить молнией|молния в|удар током|\/bolt)\b/i.test(text);
  if (isBoltRequest) {
    try {
      await ctx.react("⚡");
    } catch (e) {}

    recordLightningBolt(ctx.from.id);
    let target = text.replace(/^(ударь молнией|ударить молнией|молния в|удар током|\/bolt)\s*/i, "").trim();
    if (!target) {
      target = ctx.message.reply_to_message?.from?.first_name || "цель";
    }

    await ctx.reply(
      `✧ ─── ･ ｡ﾟ☆: *. ⚡ .* :☆ﾟ. ─── ✧\n` +
      `⚡⚡⚡ <b>РАЗРЯД 100 000 ВОЛЬТ!</b> ⚡⚡⚡\n\n` +
      `Лам взлетает в воздух с горящими глазами и направляет ослепительную молнию прямо в <b>${escapeHtml(target)}</b>! ⚡💥\n\n` +
      `<i>«БЗ-З-З-Т! Получай заряд бодрости от они-принцессы! В следующий раз не балуйся >w<»</i>`,
      { parse_mode: "HTML", reply_to_message_id: ctx.message.message_id }
    );
    return;
  }

  // 4.1. Дуэль молний между одноклассниками (/duel @username или "дуэль")
  const isDuelRequest = /^(дуэль|вызываю на дуэль|\/duel)\b/i.test(text);
  if (isDuelRequest) {
    const challenger = ctx.from?.first_name || "Игрок 1";
    let defender = "случайный соперник";
    if (ctx.message.reply_to_message?.from?.first_name) {
      defender = ctx.message.reply_to_message.from.first_name;
    } else {
      const matchTarget = text.replace(/^(дуэль|вызываю на дуэль|\/duel)\s*/i, "").trim();
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
      `<i>«БЗ-З-З-Т! Проигравший получает утешительный разряд по пяткам! В следующий раз тренируйтесь лучше >w<»</i>`,
      { parse_mode: "HTML", reply_to_message_id: ctx.message.message_id }
    );
    return;
  }

  // 4.2. Рулетка молний в чате класса (/roulette или "рулетка")
  const isRouletteRequest = /^(рулетка|русская рулетка|\/roulette)\b/i.test(text);
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
      `<i>«БЗ-З-Т! Не спорьте с Лам, а то добавлю 200 000 вольт >w<»</i>`,
      { parse_mode: "HTML", reply_to_message_id: ctx.message.message_id }
    );
    return;
  }

  // 4.3. Они-Прожарка одноклассника (/roast @username или "прожарь @username")
  const isRoastRequest = /^(прожарь|прожарка|\/roast)\b/i.test(text);
  if (isRoastRequest) {
    let target = ctx.message.reply_to_message?.from?.first_name;
    if (!target) {
      target = text.replace(/^(прожарь|прожарка|\/roast)\s*/i, "").trim();
    }
    if (!target) target = ctx.from?.first_name || "друг";

    await handleIncoming(ctx, {
      userText: `Сделай забавную, дерзкую и добрую они-прожарку для ${target} в стиле Лам из аниме Urusei Yatsura. Подколи с юмором, без мата и грубости, упомяни школу или уроки!`,
      isRoast: true,
    });
    return;
  }

  // 4.4. Интерактивный Telegram Quiz Poll (/quiz [тема] или "квиз [тема]")
  const isQuizRequest = /^(квиз|викторина|тест|протестируй меня|\/quiz)\b/i.test(text);
  if (isQuizRequest) {
    let topic = text.replace(/^(квиз|викторина|тест|протестируй меня|\/quiz)[:\s]*/i, "").trim();
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
      "Ой, Дарлинг, не смогла собрать вопросы для квиза! Попробуй уточнить тему, например: <code>/quiz столицы мира</code> или <code>/quiz законы физики</code>",
      { parse_mode: "HTML" }
    );
    return;
  }

  // 4.5. Нейро-Шпаргалка ("шпора: [тема]", "/cheat [тема]")
  const isCheatSheetRequest = /^(шпора|сделай шпору|напиши шпору|микрошпора|\/cheat)\b/i.test(text);
  if (isCheatSheetRequest) {
    const topic = text.replace(/^(шпора|сделай шпору|напиши шпору|микрошпора|\/cheat)[:\s]*/i, "").trim();
    if (!topic) {
      await ctx.reply(
        "Дарлинг, напиши тему для шпоры! Например: <code>шпора: Вторая мировая война</code> или <code>шпора: формулы по физике 8 класс</code> >w<",
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

  // 4.6. Нейро-Кодер для информатики ("код: [задача]", "/code [задача]")
  const isCodeRequest = /^(код|напиши код|реши задачу на python|реши код|\/code)\b/i.test(text);
  if (isCodeRequest) {
    const task = text.replace(/^(код|напиши код|реши задачу на python|реши код|\/code)[:\s]*/i, "").trim();
    if (!task) {
      await ctx.reply(
        "Дарлинг, напиши задачу для кода! Например: <code>код: быстрая сортировка на python</code> или <code>код: бинарный поиск на C++</code> >w<",
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
  const isEssayRequest = /^(сочинение|план сочинения|эссе|план эссе|\/essay)\b/i.test(text);
  if (isEssayRequest) {
    const topic = text.replace(/^(сочинение|план сочинения|эссе|план эссе|\/essay)[:\s]*/i, "").trim();
    if (!topic) {
      await ctx.reply(
        "Дарлинг, напиши тему сочинения! Например: <code>сочинение: Тема любви в романе Дубровский</code> >w<",
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
  const isMovieRequest = /^(найди фильм|найди аниме|посоветуй фильм|посоветуй аниме|фильм где|аниме где|что посмотреть|\/movie|\/anime)\b/i.test(text);
  if (isMovieRequest) {
    await handleIncoming(ctx, {
      userText: text,
      isMovieFinder: true,
    });
    return;
  }

  // 6. Пояснительная бригада (Зумерский сленг)
  const isSlangRequest = /^(поясни за сленг|что значит|поясни за|поясни мне за)\b/i.test(text);
  if (isSlangRequest) {
    await handleIncoming(ctx, {
      userText: text,
      isSlangExplainer: true,
    });
    return;
  }

  // 7. Полиглот (Умный переводчик)
  const isTranslateRequest = /^(переведи на|перевод на|translate to)\b/i.test(text);
  if (isTranslateRequest) {
    await handleIncoming(ctx, {
      userText: text,
      isTranslator: true,
    });
    return;
  }

  // 8. Конвертер конкретной валюты ("100 долларов в сомах", "1 btc в usd", "5000 рублей в сомах")
  const conversion = await convertCurrencyQuery(text);
  if (conversion) {
    await ctx.reply(
      `✧ ─── ･ ｡ﾟ☆: *. ⚡ .* :☆ﾟ. ─── ✧\n` +
      `💱 <b>LUM • КУРСОВОЙ КОНВЕРТЕР</b> ✨\n\n` +
      `💵 <b>${conversion.amount} ${conversion.fromCode}</b> = <code>${conversion.result} ${conversion.toCode}</code>\n\n` +
      `<i>⚡ Данные обновлены в реальном времени с биржи! >w<</i>`,
      { parse_mode: "HTML", reply_to_message_id: ctx.message.message_id }
    );
    return;
  }

  // 9. Криптовалютный & Валютный рынок (Общий радар)
  const isMarketRequest = /^(курс валют|курс доллара|курс биткоина|крипта|криптовалюта|котировки|\/crypto|\/rates|\/currency)\b|^курс$/i.test(
    text
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
  const isImageRequest = /^(нарисуй|сгенерируй фото|сгенерируй арт|сделай арт|создай фото|нарисуй мне|стикер|аватарка|аватарку|мем|\/art|\/draw|\/img)\b/i.test(
    text
  );
  if (isImageRequest) {
    const statusMsg = await ctx.reply("🎨 <i>секундочку, Дарлинг, уже рисую шедевр для тебя...</i> >w<", {
      parse_mode: "HTML",
    });
    await ctx.api.sendChatAction(ctx.chat.id, "upload_photo");

    try {
      const { imageUrl, prompt } = await generateArtwork(text);
      await ctx.replyWithPhoto(imageUrl, {
        caption: `✧ ─── ･ ｡ﾟ☆: *. ⚡ .* :☆ﾟ. ─── ✧\n🎨 <b>LUM • NEURAL ART</b> ✨\n\n<i>«${escapeHtml(prompt)}»</i>\n\n<i>Дарлинг, как тебе мой рисунок? >w<</i>`,
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
      await ctx.reply("ой, Дарлинг, кисточки запутались( попробуй описать картинку чуть иначе >_<");
      return;
    }
  }

  // 11. Поиск музыки и превью
  const isMusicRequest = /^(найди трек|найди песню|скинь трек|скинь песню|найди музыку|\/music|\/song)\b/i.test(text);
  if (isMusicRequest) {
    const statusMsg = await ctx.reply("🎵 <i>секундочку, Дарлинг, ищу трек для твоих ушек...</i>", {
      parse_mode: "HTML",
    });

    try {
      const track = await searchMusicTrack(text);
      if (track) {
        if (track.artworkUrl) {
          await ctx.replyWithPhoto(track.artworkUrl, {
            caption: `✧ ─── ･ ｡ﾟ☆: *. ⚡ .* :☆ﾟ. ─── ✧\n🎵 <b>${escapeHtml(track.trackName)}</b> — <i>${escapeHtml(track.artistName)}</i>\n💿 Альбом: <code>${escapeHtml(track.albumName || "Сингл")}</code>\n\n🎧 <a href="${track.trackViewUrl}">Слушать полностью в Apple Music / Spotify</a>`,
            parse_mode: "HTML",
            reply_to_message_id: ctx.message.message_id,
          });
        }
        if (track.previewUrl) {
          await ctx.replyWithAudio(track.previewUrl, {
            title: track.trackName,
            performer: track.artistName,
            caption: "▶️ <i>Превью трека (30 сек)</i>",
            parse_mode: "HTML",
          });
        }
      } else {
        await ctx.reply("хм, Дарлинг, не смогла найти этот трек( проверь название исполнителя или песни >_<");
      }

      try {
        await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id);
      } catch (e) {}
      return;
    } catch (err) {
      console.error("Ошибка поиска музыки:", err.message);
      try {
        await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id);
      } catch (e) {}
      await ctx.reply("ой, что-то с поиском музыки забарахлило >_<");
      return;
    }
  }

  // 12. Умные напоминания
  const reminder = parseReminderRequest(text);
  if (reminder) {
    await ctx.reply(
      `✧ ─── ･ ｡ﾟ☆: *. ⚡ .* :☆ﾟ. ─── ✧\n⏰ <b>Договорились, Дарлинг!</b>\n\nЯ напомню тебе ровно через <b>${reminder.count} ${reminder.unitName}</b>:\n👉 <i>«${escapeHtml(reminder.reminderText)}»</i>\n\n<i>Не переживай, я ни за что не забуду! >w<</i>`,
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
  const isWeatherRequest = /^(погода в|погода|какая погода в|какая погода|\/weather)\b/i.test(text);
  if (isWeatherRequest) {
    const weather = await getLiveWeather(text);
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
  const is8BallRequest = /^(шар судьбы|магический шар|шар|8ball|\/8ball|правда ли|стоит ли|ответь да или нет)\b/i.test(text);
  if (is8BallRequest) {
    const ball = askMagic8Ball(text);
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
  const diceOrCoin = rollDiceOrCoin(text);
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
  const isHoroscopeRequest = /^(гороскоп|мой гороскоп|астропрогноз|\/horoscope)\b/i.test(text);
  if (isHoroscopeRequest) {
    const h = getDailyHoroscope(text);
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
  const isPasswordRequest = /^(пароль|сгенерируй пароль|придумай пароль|новый пароль|\/password)\b/i.test(text);
  if (isPasswordRequest) {
    const p = generateSecurePassword(text);
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
  const isQrRequest = /^(сделай qr|создай qr|qr-код|qr|\/qr)\b/i.test(text);
  if (isQrRequest) {
    const qr = getQrCodeUrl(text);
    if (qr) {
      await ctx.replyWithPhoto(qr.qrUrl, {
        caption:
          `✧ ─── ･ ｡ﾟ☆: *. ⚡ .* :☆ﾟ. ─── ✧\n` +
          `📱 <b>LUM • QR GENERATOR</b> ✨\n\n` +
          `🔗 <code>${escapeHtml(qr.data)}</code>\n\n` +
          `<i>Дарлинг, сканируй камерой телефона! >w<</i>`,
        parse_mode: "HTML",
        reply_to_message_id: ctx.message.message_id,
      });
      return;
    }
  }

  // 19. Википедия (Эрудит)
  const isWikiRequest = /^(что такое|кто такой|кто такая|википедия|\/wiki)\b/i.test(text);
  if (isWikiRequest) {
    const wiki = await getWikiSummary(text);
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
  const isSummaryRequest = /^(кратко:|перескажи:|саммари:|выжимка:|\/summary)\b/i.test(text);
  if (isSummaryRequest) {
    await handleIncoming(ctx, {
      userText: text.replace(/^(кратко:|перескажи:|саммари:|выжимка:|\/summary)\s*/i, "").trim(),
      isSummary: true,
    });
    return;
  }

  // 21. Нейро-Решебник задач АнтиГДЗ
  const isSolveRequest = /^(реши задачу|реши уравнение|помоги решить|реши:|реши|\/solve)\b/i.test(text);
  if (isSolveRequest) {
    await handleIncoming(ctx, {
      userText: text.replace(/^(реши задачу|реши уравнение|помоги решить|реши:|реши|\/solve)\s*/i, "").trim(),
      isSolve: true,
    });
    return;
  }

  // 22. Живой интернет-радар в реальном времени (DuckDuckGo Live Search)
  const isSearchRequest = /^(загугли|найди в интернете|поиск в инете|поищи в интернете|новости|гугл|\/search|\/google)\b/i.test(text);
  if (isSearchRequest) {
    let query = text.replace(/^(загугли|найди в интернете|поиск в инете|поищи в интернете|новости|гугл|\/search|\/google)[:\s]*/i, "").trim();
    if (!query) query = "главные мировые новости сегодня";

    await ctx.api.sendChatAction(ctx.chat.id, "typing");
    const statusMsg = await safeSendHtml(ctx, "🌐 <i>Лам подключает спутниковые радары и сканирует интернет...</i> ⚡");

    try {
      const searchResults = await fetchLiveSearchResults(query);
      if (!searchResults || searchResults.length === 0) {
        try { await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch (e) {}
        await ctx.reply("Дарлинг, мои радары ничего не нашли по этому запросу( Попробуй спросить другими словами >_<");
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

      const actionKb = new InlineKeyboard()
        .text("💡 Объясни проще", "act:simpler")
        .text("📚 Дай пример", "act:example")
        .row()
        .text("⚡ Другой вариант", "act:alt");

      await safeSendHtml(ctx, fullReply, ctx.message.message_id, actionKb);
      return;
    } catch (err) {
      console.error("Ошибка живого поиска:", err.message);
      try { await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch (e) {}
      await ctx.reply("Ой, Дарлинг, спутниковая связь забарахлила! Попробуй повторить запрос чуть позже >_<");
      return;
    }
  }

  // 23. Сборка домашки в PDF по фразе «собери в pdf», «сделай pdf»
  const isCompilePdfRequest = /^(собери в pdf|сделай pdf|собери pdf|объедини в pdf|готово pdf)\b/i.test(text);
  if (isCompilePdfRequest) {
    const userId = ctx.from?.id;
    const session = userId ? pdfSessions.get(userId) : null;
    if (session && session.images && session.images.length > 0) {
      await ctx.api.sendChatAction(ctx.chat.id, "upload_document");
      try {
        const pdfBuffer = await createPdfFromImages(session.images, `Домашка_${ctx.from?.first_name || "Дарлинга"}`);
        const fileName = `Домашка_${(ctx.from?.first_name || "Дарлинга").replace(/[^\wа-яА-ЯёЁ]/gi, "_")}.pdf`;
        await ctx.replyWithDocument(new InputFile(pdfBuffer, fileName), {
          caption: `✧ ─── ･ ｡ﾟ☆: *. ⚡ .* :☆ﾟ. ─── ✧\n📄 <b>Дарлинг, твоя домашка собрана в единый PDF!</b> 🎓✨\n\n• Страниц: <code>${session.images.length}</code>\n• Файл готов для отправки учителю!\n\n<i>«Лам аккуратно скрепила все листы своими они-лучами >w<»</i>`,
          parse_mode: "HTML",
          reply_to_message_id: ctx.message.message_id,
        });
        pdfSessions.delete(userId);
        return;
      } catch (err) {
        console.error("Ошибка сборки PDF:", err.message);
        await ctx.reply("Ой, не получилось собрать PDF из этих фото( попробуй заново!");
        return;
      }
    } else {
      await ctx.reply(
        "Дарлинг, в очереди пока нет фото страниц! Сначала пришли мне фото тетрадей с подписью <code>pdf</code>, а потом напиши <code>«собери в pdf»</code> >w<",
        { parse_mode: "HTML" }
      );
      return;
    }
  }

  // Обычный диалог
  await handleIncoming(ctx, { userText: text });
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
            caption: `✧ ─── ･ ｡ﾟ☆: *. ⚡ .* :☆ﾟ. ─── ✧\n📄 <b>Дарлинг, твоя домашка собрана в единый PDF!</b> 🎓✨\n\n• Страниц: <code>${session.images.length}</code>\n• Файл готов для отправки учителю!\n\n<i>«Лам всё аккуратно скрепила своими они-лучами >w<»</i>`,
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
    await ctx.reply("Дарлинг, ссылка на это видео устарела! Отправь видео заново >_<");
    return;
  }

  await ctx.api.sendChatAction(ctx.chat.id, "upload_voice");
  try {
    const audioRes = await downloadAudio(info);
    if (!audioRes) {
      await ctx.reply("Ой, не удалось извлечь звук из этого видео( попробуй другое видео >_<");
      return;
    }

    const caption = `✧ ─── ･ ｡ﾟ☆: *. ⚡ .* :☆ﾟ. ─── ✧\n🎵 <b>${escapeHtml(audioRes.title || info.title || "Звук из видео")}</b>\n⚡ <i>Аудиодорожка извлечена технологиями Лам! >w<</i>`;

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
    await ctx.reply("Ой, что-то пошло не так при извлечении звука >_<");
  }
});

// Сборка PDF по интерактивной кнопке
bot.callbackQuery("action:build_pdf", async (ctx) => {
  const userId = ctx.from?.id;
  const session = userId ? pdfSessions.get(userId) : null;
  await ctx.answerCallbackQuery({ text: "📄 Собираю PDF документ..." });

  if (!session || !session.images || session.images.length === 0) {
    await safeSendHtml(ctx, "В очереди нет сохраненных страниц! Отправь фото с подписью <code>pdf</code> &gt;_&lt;");
    return;
  }

  await ctx.api.sendChatAction(ctx.chat.id, "upload_document");
  try {
    const pdfBuffer = await createPdfFromImages(session.images, `Домашка_${ctx.from?.first_name || "Дарлинга"}`);
    const fileName = `Домашка_${(ctx.from?.first_name || "Дарлинга").replace(/[^\wа-яА-ЯёЁ]/gi, "_")}.pdf`;
    await ctx.replyWithDocument(new InputFile(pdfBuffer, fileName), {
      caption: `✧ ─── ･ ｡ﾟ☆: *. ⚡ .* :☆ﾟ. ─── ✧\n📄 <b>Дарлинг, твоя домашка собрана в PDF!</b> 🎓✨\n\n• Страниц: <code>${session.images.length}</code>\n• Готово для отправки учителю!\n\n<i>«Лам всё аккуратно скрепила своими они-лучами >w<»</i>`,
      parse_mode: "HTML",
      reply_to_message_id: ctx.callbackQuery.message.message_id,
    });
    pdfSessions.delete(userId);
  } catch (err) {
    console.error("Ошибка сборки PDF по кнопке:", err.message);
    await ctx.reply("Ой, не получилось собрать PDF документ( попробуй заново!");
  }
});

// Сброс очереди PDF по кнопке
bot.callbackQuery("action:clear_pdf", async (ctx) => {
  const userId = ctx.from?.id;
  if (userId) pdfSessions.delete(userId);
  await ctx.answerCallbackQuery({ text: "Очередь PDF очищена!" });
  await ctx.reply("🗑️ Очередь страниц PDF очищена! Можешь начать заново >w<");
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
      `💖 <b>Уровень любви:</b> [<code>${bar}</code>] <b>${stats.loveLevel}%</b>\n` +
      `💬 <b>Сообщений вместе:</b> <code>${stats.count}</code>\n` +
      `⚡ <b>Выпущено молний:</b> <code>${stats.bolts}</code>\n\n` +
      `<i>«Дарлинг, ты кликал по мне в терминале? Я всё почувствовала! >w<»</i>`,
      { parse_mode: "HTML", reply_to_message_id: ctx.message.message_id }
    );
  } else {
    await handleIncoming(ctx, { userText: data });
  }
});

initProactiveScheduler(bot, getSmartSticker);

// Запуск WebApp сервера для Telegram Mini App
startWebAppServer();

// Установка кнопки меню WebApp (если URL сконфигурирован)
const activeWebAppUrl = getWebAppUrl();
if (activeWebAppUrl) {
  bot.api
    .setChatMenuButton({
      menu_button: {
        type: "web_app",
        text: "⚡ Лам Терминал",
        web_app: { url: activeWebAppUrl },
      },
    })
    .catch((e) => console.warn("Menu button notice:", e.message));
}

bot.catch((err) => {
  const ctx = err.ctx;
  console.error(`[Bot Catch] Ошибка при обработке апдейта ${ctx?.update?.update_id}:`, err.error);
});

bot.start();
console.log("⚡ Ультра-Лам запущена со всеми новейшими технологиями!");
