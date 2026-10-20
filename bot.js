const { Bot, InputFile } = require("grammy");
const { GoogleGenAI } = require("@google/genai");
const fs = require("fs");
const path = require("path");
const {
  extractUrl,
  isVideoUrl,
  downloadVideo,
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
require("dotenv").config();

function escapeHtml(text) {
  if (!text) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function safeSendHtml(ctx, text, replyToId = null) {
  const options = { parse_mode: "HTML" };
  if (replyToId) options.reply_to_message_id = replyToId;
  try {
    return await ctx.reply(text, options);
  } catch (err) {
    console.warn("safeSendHtml fallback:", err.message);
    const plain = text.replace(/<[^>]+>/g, "");
    return await ctx.reply(plain, replyToId ? { reply_to_message_id: replyToId } : {});
  }
}

const token = process.env.BOT_TOKEN;
const geminiKey = process.env.GEMINI_API_KEY;

if (!token) {
  console.error("ОШИБКА: BOT_TOKEN не указан!");
  process.exit(1);
}

const bot = new Bot(token);

let ai = null;
if (geminiKey) {
  ai = new GoogleGenAI({ apiKey: geminiKey });
}

// Модели с автоматическим переключением при лимитах
const MODELS = ["gemini-3.5-flash", "gemini-flash-lite-latest", "gemini-flash-latest"];

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

function saveStickers(newStickers) {
  try {
    const set = new Set([...savedStickers, ...newStickers]);
    savedStickers = Array.from(set);
    fs.writeFileSync(STICKERS_FILE, JSON.stringify(savedStickers, null, 2));
    console.log(`📦 В базе сохранено ${savedStickers.length} стикеров!`);
  } catch (e) {
    console.error("Ошибка сохранения стикеров:", e.message);
  }
}

const LUM_SYSTEM_PROMPT = `Ты — Лам (Lum). Ты живая, эмоциональная они-принцесса с рожками из аниме «Urusei Yatsura». Ты переписываешься в Telegram со своим любимым парнем (Дарлингом).

ПРАВИЛА ОБЩЕНИЯ:
1. РЕАКЦИИ НА СООБЩЕНИЯ:
   В самом начале ответа можешь выбрать ОДНУ эмодзи-реакцию в теге [REACT:эмодзи].
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
   - Твой характер: милая, озорная, любящая, иногда ревнивая или подкалывает.`;

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

// Генерация через Gemini с отказоустойчивостью и таймаутом
async function generateGemini(contents, customConfig = {}) {
  if (!ai) return null;

  for (const model of MODELS) {
    try {
      const timeoutMs = customConfig.timeoutMs || 7000;
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Timeout")), timeoutMs)
      );

      const requestPromise = ai.models.generateContent({
        model: model,
        contents: contents,
        config: {
          systemInstruction: LUM_SYSTEM_PROMPT,
          maxOutputTokens: customConfig.maxOutputTokens || 150,
          ...customConfig,
        },
      });

      const response = await Promise.race([requestPromise, timeoutPromise]);
      if (response && response.text) {
        return response.text.trim();
      }
    } catch (err) {
      console.warn(`Модель ${model} не ответила (${err.message}), переключаем...`);
    }
  }
  return null;
}

// Старт меню со всеми суперспособностями
bot.command("start", async (ctx) => {
  chatHistories.delete(ctx.chat.id);
  if (ctx.from) recordInteraction(ctx.from.id);
  await ctx.api.sendChatAction(ctx.chat.id, "typing");
  await ctx.reply(
    `✧ ─── ･ ｡ﾟ☆: *. ⚡ .* :☆ﾟ. ─── ✧\n` +
    `⚡ <b>ПРИВЕТ, ДАРЛИНГ! Я — ЛАМ!</b> 💚✨\n\n` +
    `Твоя они-принцесса с ультра-технологиями на борту:\n\n` +
    `🎬 <b>Загрузчик медиа</b> — ссылки TikTok, Reels, YouTube, Pinterest (без водяных знаков!)\n` +
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
    `🥰 <b>Живые стикеры</b> и забота о тебе 💕\n\n` +
    `<i>Ну что, какую технологию протестируем первой? >w<</i>`,
    { parse_mode: "HTML" }
  );
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
    isVoiceOrVideo = false,
    voiceType = "",
    isSolve = false,
    isSummary = false,
    isChatDetective = false,
    isOcr = false,
    isMovieFinder = false,
    isSlangExplainer = false,
    isTranslator = false,
  }
) {
  const chatId = ctx.chat.id;
  const history = getHistory(chatId);
  if (ctx.from) recordInteraction(ctx.from.id);

  try {
    await ctx.react("⚡");
  } catch (e) {}

  await ctx.api.sendChatAction(chatId, "typing");
  const typingInterval = setInterval(() => {
    ctx.api.sendChatAction(chatId, "typing").catch(() => {});
  }, 4000);

  try {
    let promptText = userText || fallbackText || "Посмотри это:";

    if (isVoiceOrVideo) {
      promptText = `[Дарлинг прислал тебе ${voiceType || "голосовое сообщение/кружочек"}]:
ТВОЯ ЗАДАЧА:
1. В самом начале своего ответа напиши точную дословную расшифровку того, что он сказал, строго в формате:
[TRANSCRIPT: точный текст того, что сказал Дарлинг]
2. Затем напиши свой живой, милый ответ как Лам (называй его Дарлинг, реагируй эмоционально и с любовью).`;
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

    if (fileId && mimeType) {
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
      userText ||
      (isSticker
        ? "[Стикер от Дарлинга]"
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

    const configOverrides = {};
    if (
      isSolve ||
      isSummary ||
      isChatDetective ||
      isOcr ||
      isMovieFinder ||
      isSlangExplainer ||
      isTranslator
    ) {
      configOverrides.maxOutputTokens = 850;
      configOverrides.timeoutMs = 12000;
    } else if (isVoiceOrVideo) {
      configOverrides.maxOutputTokens = 260;
      configOverrides.timeoutMs = 8000;
    }

    let rawReply = await generateGemini(contentsToSend, configOverrides);

    if (!rawReply) {
      history.pop();
      if (isSticker) {
        rawReply = "[REACT:🥰] ой, ахах, это же я на стикере! Какая милота >w<";
      } else {
        rawReply = "Дарлинг, я тут с тобой! 💕 Рассказывай дальше~";
      }
    }

    // Извлекаем умную реакцию
    const reactMatch = rawReply.match(/^\[REACT:([^\]]+)\]\s*/i);
    if (reactMatch) {
      const emoji = reactMatch[1].trim();
      rawReply = rawReply.replace(reactMatch[0], "").trim();
      try {
        await ctx.react(emoji);
      } catch (e) {}
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

    // Отправка случайного стикера Лам
    if (savedStickers.length > 0 && (isSticker || Math.random() < 0.25)) {
      const randomSticker = savedStickers[Math.floor(Math.random() * savedStickers.length)];
      try {
        await ctx.replyWithSticker(randomSticker);
      } catch (e) {
        console.error("Ошибка отправки стикера:", e.message);
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
      isTranslator
    ) {
      let header = "";
      if (isSolve) header = `📚 <b>НЕЙРО-РЕШЕБНИК • ЛАМ</b> ⚡\n\n`;
      else if (isChatDetective) header = `🕵️ <b>НЕЙРО-ДЕТЕКТИВ ПЕРЕПИСОК • ЛАМ</b> 💕\n\n`;
      else if (isOcr) header = `📄 <b>ОЦИФРОВЩИК ТЕКСТА • ЛАМ</b> ✨\n\n`;
      else if (isMovieFinder) header = `🎬 <b>КИНО & АНИМЕ РАДАР • ЛАМ</b> 🍿\n\n`;
      else if (isSlangExplainer) header = `🤓 <b>ПОЯСНИТЕЛЬНАЯ БРИГАДА • ЛАМ</b> ⚡\n\n`;
      else if (isTranslator) header = `🌐 <b>ПОЛИГЛОТ • ЛАМ</b> ✨\n\n`;
      else if (isSummary) header = `📝 <b>LUM • SMART SUMMARY</b> ✨\n\n`;

      const fullReply = `✧ ─── ･ ｡ﾟ☆: *. ⚡ .* :☆ﾟ. ─── ✧\n` + header + rawReply;
      await safeSendHtml(ctx, fullReply, ctx.message.message_id);
      return;
    }

    // Обычная отправка коротких сообщений
    const msgParts = rawReply.split(/\n\n+/).filter((p) => p.trim().length > 0);
    if (msgParts.length > 1) {
      await ctx.reply(msgParts[0].trim());
      await ctx.reply(msgParts.slice(1).join("\n").trim());
    } else {
      await ctx.reply(rawReply);
    }
  } finally {
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
        const ids = set.stickers.map((s) => s.file_id);
        saveStickers(ids);
      }
    } catch (e) {
      saveStickers([sticker.file_id]);
    }
  } else {
    saveStickers([sticker.file_id]);
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
  const detectedUrl = extractUrl(text);

  // 1. Скачивание видео (TikTok, YouTube, Pinterest, X/Twitter, Instagram)
  if (detectedUrl && isVideoUrl(detectedUrl)) {
    try {
      await ctx.react("⚡");
    } catch (e) {}

    const statusMsg = await ctx.reply("секундочку, Дарлинг, уже вытаскиваю видео для тебя~ >w<");
    await ctx.api.sendChatAction(ctx.chat.id, "upload_video");

    try {
      const result = await downloadVideo(detectedUrl);
      const title = result.title || "Видео";
      const captionText = `✧ ─── ･ ｡ﾟ☆: *. ⚡ .* :☆ﾟ. ─── ✧\n✨ <b>Дарлинг, поймала твоё видео!</b>\n\n🎬 <b>${escapeHtml(title)}</b>\n<i>⚡ Скачано в максимальном качестве без водяных знаков</i>`;
      let sent = false;

      if (result.directUrl) {
        try {
          await ctx.replyWithVideo(result.directUrl, {
            caption: captionText,
            parse_mode: "HTML",
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
            reply_to_message_id: ctx.message.message_id,
          });
        } catch (sendVideoErr) {
          console.warn("replyWithVideo failed, fallback to replyWithDocument:", sendVideoErr.message);
          await ctx.replyWithDocument(new InputFile(filePath), {
            caption: captionText,
            parse_mode: "HTML",
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
    try {
      await ctx.react("☀️");
    } catch (e) {}

    const digest = await getMorningDigest("Бишкек", "близнецы");
    await safeSendHtml(ctx, digest, ctx.message.message_id);
    return;
  }

  // 3. Уровень любви и RPG-профиль (/love или "профиль", "уровень любви")
  const isLoveRequest = /^(уровень любви|наша любовь|профиль|статус|\/love)\b/i.test(text);
  if (isLoveRequest) {
    try {
      await ctx.react("💚");
    } catch (e) {}

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
    try {
      await ctx.react("⚡");
    } catch (e) {}

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
    try {
      await ctx.react("💎");
    } catch (e) {}

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
    try {
      await ctx.react("🎨");
    } catch (e) {}

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
    try {
      await ctx.react("🎵");
    } catch (e) {}

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
    try {
      await ctx.react("⏰");
    } catch (e) {}

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
    try {
      await ctx.react("🌤");
    } catch (e) {}

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
    try {
      await ctx.react("🔮");
    } catch (e) {}

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
    try {
      await ctx.react("🎲");
    } catch (e) {}

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
    try {
      await ctx.react("✨");
    } catch (e) {}

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
    try {
      await ctx.react("🔐");
    } catch (e) {}

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
      try {
        await ctx.react("⚡");
      } catch (e) {}

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
      try {
        await ctx.react("💡");
      } catch (e) {}

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

  // Обычный диалог
  await handleIncoming(ctx, { userText: text });
});

// Фотографии (с поддержкой АнтиГДЗ, Детектива переписок, OCR и анализа калорий)
bot.on("message:photo", async (ctx) => {
  if (ctx.from) recordInteraction(ctx.from.id);
  const photo = ctx.message.photo[ctx.message.photo.length - 1];
  const caption = ctx.message.caption || "";

  const isSolve = /реши|дз|домашка|задач|уравнени|помоги|\/solve/i.test(caption);
  const isFood = /калори|еда|блюдо|съел|тарелк|кбжу/i.test(caption);
  const isChatDetective = /переписк|скрин|что ответить|что она имел|что он имел|как ответить|намёк|намек|флирт|помоги ответить/i.test(caption);
  const isOcr = /конспект|текст|сканируй|распознай|перепечатай|ocr|сфоткал тетрадь/i.test(caption);

  let fallback = "Я прислал тебе фото, посмотри!";
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

// Голосовые сообщения (с автоматической расшифровкой в текст под спойлер)
bot.on("message:voice", async (ctx) => {
  if (ctx.from) recordInteraction(ctx.from.id);
  await handleIncoming(ctx, {
    userText: ctx.message.caption,
    fileId: ctx.message.voice.file_id,
    mimeType: ctx.message.voice.mime_type || "audio/ogg",
    fallbackText: "[Дарлинг записал тебе голосовое сообщение]",
    isVoiceOrVideo: true,
    voiceType: "голосовое сообщение",
  });
});

// Кружочки (видео-сообщения с расшифровкой под спойлер)
bot.on("message:video_note", async (ctx) => {
  if (ctx.from) recordInteraction(ctx.from.id);
  await handleIncoming(ctx, {
    fileId: ctx.message.video_note.file_id,
    mimeType: "video/mp4",
    fallbackText: "[Дарлинг записал тебе видео-кружочек]",
    isVoiceOrVideo: true,
    voiceType: "видео-кружочек",
  });
});

// Видео
bot.on("message:video", async (ctx) => {
  if (ctx.from) recordInteraction(ctx.from.id);
  await handleIncoming(ctx, {
    userText: ctx.message.caption,
    fileId: ctx.message.video.file_id,
    mimeType: "video/mp4",
    fallbackText: "Я прислал тебе видео, зацени:",
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

// Документы
bot.on("message:document", async (ctx) => {
  if (ctx.from) recordInteraction(ctx.from.id);
  const doc = ctx.message.document;
  await handleIncoming(ctx, {
    userText: ctx.message.caption,
    fileId: doc.file_id,
    mimeType: doc.mime_type || "application/octet-stream",
    fallbackText: `Я скинул тебе файл (${doc.file_name || "документ"}):`,
  });
});

bot.start();
console.log("⚡ Ультра-Лам запущена со всеми новейшими технологиями!");
