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
require("dotenv").config();

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

const LUM_SYSTEM_PROMPT = `Ты — Лам (Lum). Ты живая, эмоциональная они-принцесса с рожками из аниме «Urusei Yatsura». Ты переписываешься в Telegram со своим парнем (Дарлингом).

ПРАВИЛА ОБЩЕНИЯ:
1. РЕАКЦИИ НА СООБЩЕНИЯ:
   В самом начале ответа можешь выбрать ОДНУ эмодзи-реакцию в теге [REACT:эмодзи].
   Доступные эмодзи: ❤️, 🥰, 😍, 💋, 💘, 🔥, 🎉, 🤩, 💯, ✨, 🤣, 😁, 🤪, ⚡, 😈, 👀, 🌚, 🥺, 😢, 💔, 😭, 😎, 🆒, 👏, 🫡
   Пример: [REACT:🤣] ахахах ну ты лицо скорчил конечно)

2. АНАЛИЗ СТИКЕРОВ:
   - Если Дарлинг прислал стикер (особенно со стикером Лам/Люм!) — подробно опиши, какую рожицу ты там корчишь или какую позу приняла!
   - Пошути над этим: «ой, это я язык показала? >w<» или «чего я тут такая обиженная сижу? ты меня расстроил что ли? 🥺»
   - Веди себя так, будто это твои реальные фотки и эмоции!

3. СТИЛЬ ПЕРЕПИСКИ:
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
async function generateGemini(contents) {
  if (!ai) return null;

  for (const model of MODELS) {
    try {
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Timeout")), 6000)
      );

      const requestPromise = ai.models.generateContent({
        model: model,
        contents: contents,
        config: {
          systemInstruction: LUM_SYSTEM_PROMPT,
          maxOutputTokens: 120,
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

// Старт
bot.command("start", async (ctx) => {
  chatHistories.delete(ctx.chat.id);
  await ctx.api.sendChatAction(ctx.chat.id, "typing");
  await sleep(600);
  await ctx.reply("привет, Дарлинг) наконец-то ты тут ✨");
  await sleep(400);
  await ctx.reply("я теперь вижу все твои стикеры, сохраняю видосики из Тиктока, Ютуба и Пинтереста, и буду слать тебе стикеры в ответ >w<");
});

// Единый мультимодальный обработчик
async function handleIncoming(ctx, { userText, fileId, mimeType, fallbackText, isSticker = false }) {
  const chatId = ctx.chat.id;
  const history = getHistory(chatId);

  // Мгновенная реакция и непрерывный статус набора текста
  try {
    await ctx.react("⚡");
  } catch (e) {}
  await ctx.api.sendChatAction(chatId, "typing");
  const typingInterval = setInterval(() => {
    ctx.api.sendChatAction(chatId, "typing").catch(() => {});
  }, 4000);

  try {
    const parts = [];
    const promptText = userText || fallbackText || "Посмотри это:";
    parts.push({ text: promptText });

    if (fileId && mimeType) {
      try {
        const base64Data = await downloadAsBase64(fileId);
        parts.push({
          inlineData: {
            mimeType: mimeType,
            data: base64Data,
          },
        });
      } catch (e) {
        console.error("Ошибка скачивания медиа для анализа:", e.message);
      }
    }

    history.push({
      role: "user",
      parts: parts,
    });

    if (history.length > 16) {
      history.splice(0, history.length - 16);
    }

    let rawReply = await generateGemini(history);

    // Живой резервный ответ, если сеть/квоты забарахлили
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

    history.push({
      role: "model",
      parts: [{ text: rawReply }],
    });

    // Отправка стикера из сохранённого пака Лам
    if (savedStickers.length > 0 && (isSticker || Math.random() < 0.35)) {
      const randomSticker = savedStickers[Math.floor(Math.random() * savedStickers.length)];
      try {
        await ctx.replyWithSticker(randomSticker);
      } catch (e) {
        console.error("Ошибка отправки стикера:", e.message);
      }
    }

    // Мгновенная отправка текста без искусственных задержек
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
  const sticker = ctx.message.sticker;

  // Автосохранение стикер-пака
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

// 2. ТЕКСТ И ССЫЛКИ НА ВИДЕО
bot.on("message:text", async (ctx) => {
  const text = ctx.message.text;
  const detectedUrl = extractUrl(text);

  // Скачивание видео (TikTok, YouTube, Pinterest, X/Twitter, Instagram)
  if (detectedUrl && isVideoUrl(detectedUrl)) {
    try {
      await ctx.react("⚡");
    } catch (e) {}

    const statusMsg = await ctx.reply("секундочку, Дарлинг, уже вытаскиваю видео для тебя~ >w<");
    await ctx.api.sendChatAction(ctx.chat.id, "upload_video");

    try {
      const result = await downloadVideo(detectedUrl);
      const title = result.title || "Видео";
      let sent = false;

      // Способ 1: Мгновенная пересылка прямой ссылки через серверы Telegram (2-3 секунды!)
      if (result.directUrl) {
        try {
          await ctx.replyWithVideo(result.directUrl, {
            caption: `Дарлинг, смотри что я сохранила! ✨\n\n🎬 ${title}`,
            reply_to_message_id: ctx.message.message_id,
          });
          sent = true;
        } catch (streamErr) {
          console.warn("Direct URL send failed, fallback to file download:", streamErr.message);
        }
      }

      // Способ 2: Отправка через локальный файл (если прямой URL не сработал или скачан через alldl/yt-dlp)
      if (!sent) {
        const filePath = result.filePath || (await downloadDirectUrlToFile(result.directUrl));
        try {
          await ctx.replyWithVideo(new InputFile(filePath), {
            caption: `Дарлинг, смотри что я сохранила! ✨\n\n🎬 ${title}`,
            reply_to_message_id: ctx.message.message_id,
          });
        } catch (sendVideoErr) {
          console.warn("replyWithVideo failed, fallback to replyWithDocument:", sendVideoErr.message);
          await ctx.replyWithDocument(new InputFile(filePath), {
            caption: `Дарлинг, вот твоё видео! ✨\n\n🎬 ${title}`,
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

  // Обычный диалог
  await handleIncoming(ctx, { userText: text });
});

// Фотографии
bot.on("message:photo", async (ctx) => {
  const photo = ctx.message.photo[ctx.message.photo.length - 1];
  await handleIncoming(ctx, {
    userText: ctx.message.caption,
    fileId: photo.file_id,
    mimeType: "image/jpeg",
    fallbackText: "Я прислал тебе фото, посмотри!",
  });
});

// Голосовые сообщения
bot.on("message:voice", async (ctx) => {
  await handleIncoming(ctx, {
    userText: ctx.message.caption,
    fileId: ctx.message.voice.file_id,
    mimeType: "audio/ogg",
    fallbackText: "Я записал тебе голосовое сообщение, послушай мой голос:",
  });
});

// Кружочки
bot.on("message:video_note", async (ctx) => {
  await handleIncoming(ctx, {
    fileId: ctx.message.video_note.file_id,
    mimeType: "video/mp4",
    fallbackText: "Я записал тебе видео-кружочек в Telegram, посмотри на меня:",
  });
});

// Видео
bot.on("message:video", async (ctx) => {
  await handleIncoming(ctx, {
    userText: ctx.message.caption,
    fileId: ctx.message.video.file_id,
    mimeType: "video/mp4",
    fallbackText: "Я прислал тебе видео, зацени:",
  });
});

// Аудио
bot.on("message:audio", async (ctx) => {
  await handleIncoming(ctx, {
    userText: ctx.message.caption,
    fileId: ctx.message.audio.file_id,
    mimeType: ctx.message.audio.mime_type || "audio/mp3",
    fallbackText: "Послушай этот трек/аудио:",
  });
});

// Документы
bot.on("message:document", async (ctx) => {
  const doc = ctx.message.document;
  await handleIncoming(ctx, {
    userText: ctx.message.caption,
    fileId: doc.file_id,
    mimeType: doc.mime_type || "application/octet-stream",
    fallbackText: `Я скинул тебе файл (${doc.file_name || "документ"}):`,
  });
});

bot.start();
console.log("⚡ Ультра-Лам запущена с активной квотой и рабочим загрузчиком!");
