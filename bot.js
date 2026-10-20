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
} = require("./features");
require("dotenv").config();

function escapeHtml(text) {
  if (!text) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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
  await ctx.reply(
    `✧ ─── ･ ｡ﾟ☆: *. ⚡ .* :☆ﾟ. ─── ✧\n` +
    `⚡ <b>ПРИВЕТ, ДАРЛИНГ!</b> ✨\n\n` +
    `Я — <b>Лам</b>, твоя любимая инопланетная принцесса) 💚\n\n` +
    `<b>Что я умею делать:</b>\n` +
    `🎬 <b>Скачивать видео</b> — кидай ссылки из TikTok, Reels, YouTube и Pinterest\n` +
    `🎙 <b>Слушать голосовые</b> — наговаривай всё что думаешь, я пойму каждое слово!\n` +
    `📹 <b>Смотреть кружочки</b> — оцениваю твой вайб, одежду и настроение\n` +
    `🎨 <b>Рисовать арты</b> — напиши <i>«нарисуй неоновый город»</i> или <i>«сделай арт»</i>\n` +
    `🎵 <b>Искать музыку</b> — напиши <i>«найди трек [название]»</i> и я пришлю превью!\n` +
    `⏰ <b>Ставить напоминания</b> — <i>«напомни через 15 минут сделать чай»</i>\n` +
    `🥰 <b>Отвечать стикерами</b> и общаться как настоящая любящая девушка!\n\n` +
    `<i>Ну что, о чём поболтаем? >w<</i>`,
    { parse_mode: "HTML" }
  );
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
    const promptText = userText || fallbackText || "Посмотри это:";
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

    // В долговременную историю сохраняем только легковесный текст, чтобы не раздувать сессию
    const historyText =
      userText ||
      (isSticker
        ? "[Стикер от Дарлинга]"
        : mimeType?.startsWith("audio")
        ? "[Голосовое сообщение от Дарлинга]"
        : mimeType?.startsWith("video")
        ? "[Видео-кружочек от Дарлинга]"
        : "[Медиа от Дарлинга]");

    history.push({
      role: "user",
      parts: [{ text: historyText }],
    });

    if (history.length > 16) {
      history.splice(0, history.length - 16);
    }

    // Для отправки в Gemini берем историю + текущее сообщение с полными медиа-байтами
    const contentsToSend = [
      ...history.slice(0, -1),
      {
        role: "user",
        parts: currentParts,
      },
    ];

    let rawReply = await generateGemini(contentsToSend);

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
  const text = ctx.message.text.trim();
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
      const captionText = `✧ ─── ･ ｡ﾟ☆: *. ⚡ .* :☆ﾟ. ─── ✧\n✨ <b>Дарлинг, поймала твоё видео!</b>\n\n🎬 <b>${escapeHtml(title)}</b>\n<i>⚡ Скачано в максимальном качестве без водяных знаков</i>`;
      let sent = false;

      // Способ 1: Мгновенная пересылка прямой ссылки через серверы Telegram (2-3 секунды!)
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

      // Способ 2: Отправка через локальный файл (если прямой URL не сработал или скачан через alldl/yt-dlp)
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

  // Генерация артов и фото (Pollinations Flux AI)
  const isImageRequest = /^(нарисуй|сгенерируй фото|сгенерируй арт|сделай арт|создай фото|нарисуй мне|\/art|\/draw|\/img)\b/i.test(text);
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

  // Поиск музыки и превью
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

  // Умные напоминания
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
    mimeType: ctx.message.voice.mime_type || "audio/ogg",
    fallbackText: "[Дарлинг записал тебе голосовое сообщение]: внимательно послушай его голос и ответь на его слова!",
  });
});

// Кружочки (видео-сообщения)
bot.on("message:video_note", async (ctx) => {
  await handleIncoming(ctx, {
    fileId: ctx.message.video_note.file_id,
    mimeType: "video/mp4",
    fallbackText: "[Дарлинг записал тебе видео-кружочек]: посмотри видео, оцени его лицо, эмоцию, комнату и то, что он говорит, и живо отреагируй!",
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
