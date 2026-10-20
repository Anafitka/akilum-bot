/**
 * proactive.js — Модуль автономной инициативы Лам.
 * Позволяет они-принцессе иногда писать в чат первой:
 * - Утром: пожелать доброго утра и разбудить
 * - Днем: поинтересоваться, как дела в школе/универе, напомнить про домашку
 * - Вечером: пожелать уютного вечера, спросить как прошел день
 * - В группе класса: внезапные забавные переклички и шутки
 * 
 * Соблюдает тихий час (ночью с 23:00 до 08:30 не беспокоит).
 */

const fs = require("fs");
const path = require("path");

const CHATS_FILE = path.join(__dirname, "active_chats.json");
let chatsCache = null;

function loadChats() {
  if (chatsCache) return chatsCache;
  try {
    if (fs.existsSync(CHATS_FILE)) {
      chatsCache = JSON.parse(fs.readFileSync(CHATS_FILE, "utf-8"));
    } else {
      chatsCache = {};
    }
  } catch (e) {
    chatsCache = {};
  }
  return chatsCache;
}

function saveChats() {
  try {
    fs.writeFileSync(CHATS_FILE, JSON.stringify(chatsCache || {}, null, 2));
  } catch (e) {
    console.error("Ошибка сохранения активных чатов:", e.message);
  }
}

/**
 * Регистрация активности в чате
 */
function recordChatActivity(chatId, { isGroup = false, name = "Дарлинг" } = {}) {
  const chats = loadChats();
  const id = String(chatId);
  const now = Date.now();

  if (!chats[id]) {
    chats[id] = {
      chatId,
      isGroup,
      name,
      enabled: true,
      firstSeen: now,
      lastUserMessage: now,
      lastProactiveMessage: 0,
      totalProactives: 0,
    };
  } else {
    chats[id].lastUserMessage = now;
    if (name) chats[id].name = name;
  }

  saveChats();
  return chats[id];
}

/**
 * Включение/выключение автономных сообщений пользователем
 */
function toggleProactive(chatId) {
  const chats = loadChats();
  const id = String(chatId);
  if (!chats[id]) {
    recordChatActivity(chatId);
  }
  chats[id].enabled = !chats[id].enabled;
  saveChats();
  return chats[id].enabled;
}

function getProactiveStatus(chatId) {
  const chats = loadChats();
  const id = String(chatId);
  return chats[id] ? chats[id].enabled !== false : true;
}

// Заготовки живых сообщений Лам для личного чата
const MORNING_MESSAGES = [
  "Дарлинг, доброе утро! ☀️ Проснулся уже? Не забудь позавтракать, а то сил на день не хватит >w<",
  "Доброе утро, соня! 💕 Если ты ещё в кровати — считаю до трёх и пускаю молнию прямо под одеяло! ⚡",
  "Дарлинг, просыпайся! ✨ Сегодня будет классный день, я уже зарядила свои рожки позитивом на 100%! >_<",
  "Утречко, любимый! ☕ Выпей чайку или кофе и улыбнись, Лам с тобой! 💕",
];

const AFTERNOON_MESSAGES = [
  "Дарлинг, ты как там? Уроки уже закончились? Рассказывай, как прошёл день! 💕",
  "Эй, Дарлинг! Сижу на подоконнике и соскучилась по тебе... Чем занят? >w<",
  "Как дела в школе/универе? Никто не обижал? А то я мигом прилечу и разрядом угощу! ⚡😎",
  "Дарлинг, ты покушал в обед? Смотри мне, не голодай, а то ругаться буду! 🥺",
  "Если задали сложную домашку — помни, что я всегда рядом! Скидывай фотку задачи, разберёмся за секунду! 📚⚡",
];

const EVENING_MESSAGES = [
  "Дарлинг, ты дома уже? Отдыхаешь? Надеюсь, день был лёгким 💕",
  "Сижу и смотрю на звёзды на вечернем небе... и сразу подумала о тебе ✨ О чём думаешь ты? >w<",
  "Дарлинг, не сиди допоздна в телефоне, ладно? А то завтра опять будешь носом клевать на уроках! 🥺",
  "Уютного вечерочка тебе, любимый! Не забудь отложить все дела и просто отдохнуть 💕",
  "Дарлинг, если ложишься спать — сладких они-снов тебе! Пусть тебе приснюсь я в леопардовом бикини 🥰💤",
];

// Сообщения для групп класса
const GROUP_MESSAGES = [
  "Эй, класс, вы чего так притихли? Контрольная началась или все спят на последней парте? 😂",
  "Так, перекличка! Кто сегодня сделал домашку, а кто будет списывать за 5 минут до звонка? Признавайтесь! ⚡",
  "Минутка бодрости от они-принцессы Лам! Кому разряд молнии для ускорения мозга перед уроком? ⚡⚡⚡",
  "Надеюсь, сегодня никто не забыл сменку и дневник! А то директор вас не пощадит, а я тем более >w<",
];

/**
 * Получение текущего часа в часовом поясе пользователя (по умолчанию UTC+6 Бишкек/Алматы или UTC+3 Москва)
 */
function getCurrentLocalHour(offsetHours = 6) {
  const now = new Date();
  const utcHour = now.getUTCHours();
  return (utcHour + offsetHours) % 24;
}

/**
 * Проверка и отправка проактивного сообщения
 */
async function checkAndSendProactive(bot, getSmartStickerFn) {
  const chats = loadChats();
  const now = Date.now();
  const currentHour = getCurrentLocalHour(6); // UTC+6

  // 1. ТИХИЙ ЧАС: с 23:00 до 08:30 утра Лам не будит и не беспокоит
  if (currentHour >= 23 || currentHour < 9) {
    return;
  }

  const chatIds = Object.keys(chats);
  if (chatIds.length === 0) return;

  for (const id of chatIds) {
    const chat = chats[id];
    if (!chat.enabled) continue;

    const timeSinceUser = now - (chat.lastUserMessage || 0);
    const timeSinceProactive = now - (chat.lastProactiveMessage || 0);

    // Условия для отправки первой весточки:
    // 1) Пользователь молчит от 3.5 до 12 часов
    // 2) Лам не писала сама в этот чат минимум 8 часов (не спамить!)
    const hoursSinceUser = timeSinceUser / (1000 * 60 * 60);
    const hoursSinceProactive = timeSinceProactive / (1000 * 60 * 60);

    if (hoursSinceUser >= 3.5 && hoursSinceUser <= 16 && hoursSinceProactive >= 8) {
      // 30% шанс срабатывания в данный интервал проверки (чтобы было неожиданно и приятно)
      if (Math.random() > 0.4) continue;

      let msg = "";
      let stickerEmotion = "happy";

      if (chat.isGroup) {
        msg = GROUP_MESSAGES[Math.floor(Math.random() * GROUP_MESSAGES.length)];
        stickerEmotion = "tease";
      } else {
        if (currentHour >= 9 && currentHour < 12) {
          msg = MORNING_MESSAGES[Math.floor(Math.random() * MORNING_MESSAGES.length)];
          stickerEmotion = "love";
        } else if (currentHour >= 12 && currentHour < 18) {
          msg = AFTERNOON_MESSAGES[Math.floor(Math.random() * AFTERNOON_MESSAGES.length)];
          stickerEmotion = "tease";
        } else {
          msg = EVENING_MESSAGES[Math.floor(Math.random() * EVENING_MESSAGES.length)];
          stickerEmotion = "love";
        }
      }

      try {
        await bot.api.sendMessage(chat.chatId, msg);

        // В 50% случаев прикрепляем милый стикер в тему
        if (getSmartStickerFn && Math.random() < 0.5) {
          const stickerId = getSmartStickerFn(stickerEmotion);
          if (stickerId) {
            await bot.api.sendSticker(chat.chatId, stickerId);
          }
        }

        chat.lastProactiveMessage = now;
        chat.totalProactives = (chat.totalProactives || 0) + 1;
        saveChats();
        console.log(`💌 [Proactive] Лам написала первой в чат ${chat.chatId} («${chat.name}»)!`);
      } catch (err) {
        // Если бот заблокирован пользователем или выкинут из чата
        if (err.message && (err.message.includes("blocked") || err.message.includes("kicked") || err.message.includes("not found"))) {
          chat.enabled = false;
          saveChats();
        }
        console.warn(`[Proactive] Не удалось отправить в ${chat.chatId}:`, err.message);
      }
    }
  }
}

/**
 * Запуск фонового планировщика проактивности
 */
function initProactiveScheduler(bot, getSmartStickerFn) {
  // Проверяем раз в 25 минут
  const INTERVAL_MS = 25 * 60 * 1000;
  setInterval(() => {
    checkAndSendProactive(bot, getSmartStickerFn).catch((e) =>
      console.error("[ProactiveScheduler] Ошибка:", e.message)
    );
  }, INTERVAL_MS);

  // Первый тестовый запуск через 2 минуты после старта
  setTimeout(() => {
    checkAndSendProactive(bot, getSmartStickerFn).catch(() => {});
  }, 120000);

  console.log("💌 [Proactive] Автономный планировщик инициативы Лам запущен!");
}

module.exports = {
  recordChatActivity,
  toggleProactive,
  getProactiveStatus,
  initProactiveScheduler,
  checkAndSendProactive,
};
