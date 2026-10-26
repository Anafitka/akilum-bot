const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

/**
 * 1. Генерация картинок через Pollinations Flux (Бесплатно, HD 1024x1024)
 * Поддерживает режимы: арт, стикер, аватарка, мем
 */
async function generateArtwork(userPrompt) {
  let prompt = userPrompt
    .replace(/^(нарисуй|сгенерируй фото|сгенерируй арт|сделай арт|создай фото|нарисуй мне|стикер|аватарка|аватарку|мем|draw|generate|art|img)\s*/i, "")
    .trim();

  let styleModifier = "";
  if (/^стикер/i.test(userPrompt)) {
    styleModifier = ", cute sticker illustration, die-cut white border, clean vector art, vibrant sticker aesthetic";
  } else if (/^аватарк/i.test(userPrompt)) {
    styleModifier = ", cyberpunk aesthetic avatar portrait, high-end anime character design, neon lighting, 8k masterpiece";
  } else if (/^мем/i.test(userPrompt)) {
    styleModifier = ", funny viral meme style, expressive cute cartoon humor";
  }

  if (!prompt) {
    prompt = "cute anime girl lum urusei yatsura vibrant neon aesthetic colors 4k high quality masterpiece";
  } else {
    prompt += styleModifier;
  }

  const seed = Math.floor(Math.random() * 10000000);
  const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(
    prompt
  )}?width=1024&height=1024&nologo=true&model=flux&seed=${seed}`;

  return {
    imageUrl,
    prompt,
  };
}

/**
 * 2. Музыкальный поиск iTunes (Бесплатно, 200мс, обложка + 30сек аудиопревью)
 */
async function searchMusicTrack(query) {
  let cleanQuery = (query || "")
    .replace(/^(найди трек|найди песню|скинь трек|скинь песню|найди музыку|трек|песня|\/music|\/song)\s*/i, "")
    .trim();

  if (!cleanQuery) cleanQuery = "Macan";

  try {
    const res = await fetch(
      `https://itunes.apple.com/search?term=${encodeURIComponent(cleanQuery)}&entity=song&limit=5`
    );
    const data = await res.json();
    if (data.results && data.results.length > 0) {
      const track = data.results.find((t) => t.previewUrl) || data.results[0];
      return {
        trackName: track.trackName,
        artistName: track.artistName,
        albumName: track.collectionName,
        previewUrl: track.previewUrl,
        artworkUrl: track.artworkUrl100 ? track.artworkUrl100.replace("100x100", "600x600") : null,
        trackViewUrl: track.trackViewUrl,
      };
    }
  } catch (e) {
    console.error("Ошибка поиска музыки:", e.message);
  }
  return null;
}

/**
 * 3. Парсер напоминаний (через X минут / секунд / часов)
 */
function parseReminderRequest(text) {
  if (!text) return null;

  const match = text.match(
    /напомни\s+(?:мне\s+)?(?:через\s+)?(\d+)\s*(минут[а-я]*|мин|м|секунд[а-я]*|сек|с|час[а-я]*|ч)\s+([\s\S]+)/i
  );
  if (!match) return null;

  const count = parseInt(match[1], 10);
  const rawUnit = match[2].toLowerCase();
  const reminderText = match[3].replace(/^чтобы\s+|^что\s+/i, "").trim();

  let ms = 0;
  let unitName = "минут";
  if (rawUnit.startsWith("с")) {
    ms = count * 1000;
    unitName = "сек.";
  } else if (rawUnit.startsWith("ч")) {
    ms = count * 60 * 60 * 1000;
    unitName = "ч.";
  } else {
    ms = count * 60 * 1000;
    unitName = "мин.";
  }

  return { ms, count, unitName, reminderText };
}

/**
 * 4. Живая погода Open-Meteo (Любой город планеты без ключей)
 */
const WEATHER_CODES = {
  0: "Ясно ☀️",
  1: "Преимущественно ясно 🌤",
  2: "Переменная облачность ⛅",
  3: "Пасмурно ☁️",
  45: "Туман 🌫",
  48: "Инейный туман 🌫",
  51: "Небольшая морось 🌦",
  53: "Умеренная морось 🌧",
  55: "Густая морось 🌧",
  61: "Небольшой дождь 🌧",
  63: "Умеренный дождь 🌧",
  65: "Ливень ⛈",
  71: "Снегопад 🌨",
  73: "Умеренный снег ❄️",
  75: "Сильный снегопад ❄️",
  80: "Кратковременный дождь 🌦",
  95: "Гроза с громом ⚡",
};

async function getLiveWeather(cityQuery) {
  const cleanCity = cityQuery
    .replace(/^(погода в|погода|какая погода в|какая погода|\/weather)\s*/i, "")
    .trim();

  if (!cleanCity) return null;

  try {
    const geoRes = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
        cleanCity
      )}&count=1&language=ru`
    );
    const geo = await geoRes.json();
    if (!geo.results || geo.results.length === 0) return null;

    const { latitude, longitude, name, country } = geo.results[0];
    const weatherRes = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true`
    );
    const w = await weatherRes.json();

    if (!w.current_weather) return null;

    const temp = Math.round(w.current_weather.temperature);
    const wind = Math.round(w.current_weather.windspeed);
    const code = w.current_weather.weathercode;
    const condition = WEATHER_CODES[code] || "Облачно 🌥";

    let advice = "Отличная погода для прогулки вместе! >w<";
    if (temp < 0) {
      advice = "Дарлинг, там мороз! Закутайся как следует и надень шапку, а то заморозишь нос! ❄️";
    } else if (temp < 10) {
      advice = "Прохладно! Не вздумай выходить в одной футболке, накинь куртку! 🧥";
    } else if (temp > 25) {
      advice = "Жарища! Обязательно пей водичку и не перегревайся на солнце! ☀️";
    } else if (code >= 51 && code <= 80) {
      advice = "На улице дождик! Возьми зонтик, не промокай без меня! ☔";
    }

    return {
      city: name,
      country: country || "",
      temp,
      wind,
      condition,
      advice,
    };
  } catch (e) {
    console.error("Ошибка запроса погоды:", e.message);
  }
  return null;
}

/**
 * 5. Генератор QR-кодов (512x512 PNG)
 */
function getQrCodeUrl(dataText) {
  const cleanData = dataText.replace(/^(сделай qr|создай qr|qr-код|qr|\/qr)\s*/i, "").trim();
  if (!cleanData) return null;

  return {
    qrUrl: `https://api.qrserver.com/v1/create-qr-code/?size=512x512&margin=15&data=${encodeURIComponent(
      cleanData
    )}`,
    data: cleanData,
  };
}

/**
 * 6. Википедия (Эрудит)
 */
async function getWikiSummary(query) {
  const cleanQuery = query
    .replace(/^(что такое|кто такой|кто такая|расскажи про|википедия|\/wiki)\s*/i, "")
    .trim();

  if (!cleanQuery) return null;

  try {
    const res = await fetch(
      `https://ru.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(cleanQuery)}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (data.extract) {
      return {
        title: data.title,
        description: data.description || "",
        extract: data.extract,
        pageUrl: data.content_urls?.desktop?.page || null,
        thumbnail: data.thumbnail?.source || null,
      };
    }
  } catch (e) {
    console.error("Ошибка Wikipedia:", e.message);
  }
  return null;
}

/**
 * 7. Криптовалютный и валютный рынок (Binance + Open Exchange Rates)
 */
let cachedMarketData = null;
let lastMarketFetch = 0;

async function getLiveMarketRates() {
  const now = Date.now();
  if (cachedMarketData && now - lastMarketFetch < 60000) {
    return cachedMarketData;
  }

  try {
    const [cryptoRes, fiatRes] = await Promise.all([
      fetch(
        "https://api.binance.com/api/v3/ticker/price?symbols=%5B%22BTCUSDT%22,%22ETHUSDT%22,%22TONUSDT%22,%22SOLUSDT%22%5D"
      ).then((r) => r.json()),
      fetch("https://open.er-api.com/v6/latest/USD").then((r) => r.json()),
    ]);

    const cryptoMap = {};
    if (Array.isArray(cryptoRes)) {
      for (const item of cryptoRes) {
        cryptoMap[item.symbol] = parseFloat(item.price);
      }
    }

    const rates = fiatRes.rates || {};
    cachedMarketData = {
      crypto: {
        BTC: cryptoMap["BTCUSDT"] || 0,
        ETH: cryptoMap["ETHUSDT"] || 0,
        TON: cryptoMap["TONUSDT"] || 0,
        SOL: cryptoMap["SOLUSDT"] || 0,
      },
      rates: {
        USD: 1,
        RUB: rates["RUB"] || 0,
        KGS: rates["KGS"] || 0,
        KZT: rates["KZT"] || 0,
        EUR: rates["EUR"] || 0,
        CNY: rates["CNY"] || 0,
        TRY: rates["TRY"] || 0,
      },
    };
    lastMarketFetch = now;
    return cachedMarketData;
  } catch (e) {
    console.error("Ошибка получения курсов валют:", e.message);
    return cachedMarketData;
  }
}

function normalizeCurrencyCode(cur) {
  if (!cur) return "";
  const s = cur.toLowerCase().trim();
  if (/^(доллар|долларов|доллара|долларах|бакс|баксов|баксах|usd|\$)$/i.test(s)) return "USD";
  if (/^(евро|еврах|eur|€)$/i.test(s)) return "EUR";
  if (/^(рубл|рублей|рубля|рублях|рублю|руб|rub|₽)$/i.test(s)) return "RUB";
  if (/^(сом|сомов|сома|сомах|сому|kgs)$/i.test(s)) return "KGS";
  if (/^(тенге|kzt)$/i.test(s)) return "KZT";
  if (/^(юан|юаней|юаня|юанях|cny|¥)$/i.test(s)) return "CNY";
  if (/^(лир|лиры|лирах|try|₺)$/i.test(s)) return "TRY";
  if (/^(биткоин|биткоина|биткоинах|биток|битках|btc|bitcoin|₿)$/i.test(s)) return "BTC";
  if (/^(эфир|эфириум|эфирах|eth|ethereum)$/i.test(s)) return "ETH";
  if (/^(тон|тона|тонах|ton|toncoin)$/i.test(s)) return "TON";
  if (/^(солана|соланах|sol|solana)$/i.test(s)) return "SOL";
  return s.toUpperCase();
}

/**
 * Конвертер конкретной суммы (например "100 долларов в сомах")
 */
async function convertCurrencyQuery(text) {
  const match = text.match(
    /(\d+(?:[.,]\d+)?)\s*([a-zA-Zа-яА-Я$€₽₿]+)\s+(?:в|to|in)\s+([a-zA-Zа-яА-Я$€₽₿]+)/i
  );
  if (!match) return null;

  const amount = parseFloat(match[1].replace(",", "."));
  const fromCode = normalizeCurrencyCode(match[2]);
  const toCode = normalizeCurrencyCode(match[3]);

  if (!fromCode || !toCode || isNaN(amount)) return null;

  const market = await getLiveMarketRates();
  if (!market) return null;

  const { crypto: cryptoPrices, rates } = market;

  let inUSD = 0;
  if (cryptoPrices[fromCode]) {
    inUSD = amount * cryptoPrices[fromCode];
  } else if (rates[fromCode]) {
    inUSD = amount / rates[fromCode];
  } else {
    return null;
  }

  let result = 0;
  if (cryptoPrices[toCode]) {
    result = inUSD / cryptoPrices[toCode];
  } else if (rates[toCode]) {
    result = inUSD * rates[toCode];
  } else {
    return null;
  }

  return {
    amount,
    fromCode,
    toCode,
    result: result < 0.01 ? result.toFixed(6) : result < 10 ? result.toFixed(3) : result.toFixed(2),
  };
}

/**
 * 8. Генератор безопасных криптостойких паролей
 */
function generateSecurePassword(text) {
  const match = text.match(/\b(\d{1,2})\b/);
  let len = 16;
  if (match) {
    len = Math.max(8, Math.min(64, parseInt(match[1], 10)));
  }

  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%^&*()_+~=";
  const bytes = crypto.randomBytes(len);
  let pwd = "";
  for (let i = 0; i < len; i++) {
    pwd += chars[bytes[i] % chars.length];
  }

  return {
    password: pwd,
    length: len,
  };
}

/**
 * 9. Космический Магический Шар 8-Ball от Лам
 */
function askMagic8Ball(question) {
  const cleanQ = question.replace(/^(шар судьбы|магический шар|шар|8ball|\/8ball)\s*/i, "").trim();

  const answers = [
    { verdict: "⚡ БЕЗУСЛОВНО ДА! >w<", prob: "99%", comment: "Мои антенны уловили чистую космическую удачу! Действуй смело, Дарлинг!" },
    { verdict: "✨ ЗВЕЗДЫ ГОВОРЯТ: ДА!", prob: "88%", comment: "Космический ветер дует в твои паруса! Всё получится 💕" },
    { verdict: "🔮 ВЕРОЯТНОСТЬ ВЫСОКА", prob: "75%", comment: "Если приложишь чуточку усилий — успех гарантирован!" },
    { verdict: "⚡ СКОРЕЕ ДА, ЧЕМ НЕТ", prob: "60%", comment: "Шансы отличные, но держи ушки на макушке ^^" },
    { verdict: "🌀 ЭНЕРГИЯ ТУМАННА...", prob: "50%", comment: "На нашей орбите сейчас космический шторм, спроси меня чуть позже >_<" },
    { verdict: "⚡ МОИ АНТЕННЫ СОМНЕВАЮТСЯ", prob: "35%", comment: "Хм-м, тут надо дважды подумать, Дарлинг..." },
    { verdict: "❌ ЗВЕЗДЫ ГОВОРЯТ: НЕТ", prob: "15%", comment: "Лучше не рискуй, я за тебя сильно переживаю! (,,>﹏<,,)" },
    { verdict: "⚡ ДАЖЕ НЕ ДУМАЙ! >_<", prob: "5%", comment: "А то сейчас ударю молнией для профилактики! Выбери другой путь!" },
  ];

  const pick = answers[Math.floor(Math.random() * answers.length)];
  return {
    question: cleanQ || "Стоит ли мне сделать это?",
    ...pick,
  };
}

/**
 * 10. Бросок монетки, кубиков или случайного числа
 */
function rollDiceOrCoin(text) {
  const clean = text.toLowerCase().trim();

  if (/монетк|монетку|орел или решка|орёл или решка/i.test(clean)) {
    const isEagle = Math.random() < 0.5;
    return {
      type: "coin",
      result: isEagle ? "🦅 ОРЁЛ!" : "🪙 РЕШКА!",
      comment: isEagle
        ? "Орёл гордо расправил крылья! Летим только вперёд! ✨"
        : "Звонкая монетка упала на решку! Удача на твоей стороне! >w<",
    };
  }

  if (/кубик|кости|кубики|брось кость|брось кубик/i.test(clean)) {
    const d1 = Math.floor(Math.random() * 6) + 1;
    const d2 = Math.floor(Math.random() * 6) + 1;
    return {
      type: "dice",
      result: `🎲 [ ${d1} ] + 🎲 [ ${d2} ] = <b>${d1 + d2}</b>`,
      comment: d1 + d2 === 12
        ? "ВАУ, ДВОЙНАЯ ШЕСТЕРКА! Ты сорвал джекпот, Дарлинг! ⚡⚡⚡"
        : d1 + d2 >= 8
        ? "Отличный бросок, фортуна тебе улыбается! 💕"
        : "Неплохо! В следующий раз выбросим еще больше ^^",
    };
  }

  const rangeMatch = clean.match(/рандом\s+(\d+)(?:\s+(\d+))?/i);
  if (rangeMatch) {
    const min = rangeMatch[2] ? parseInt(rangeMatch[1], 10) : 1;
    const max = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : parseInt(rangeMatch[1], 10);
    const low = Math.min(min, max);
    const high = Math.max(min, max);
    const val = Math.floor(Math.random() * (high - low + 1)) + low;
    return {
      type: "random",
      result: `🔢 <b>${val}</b> (из диапазона ${low}–${high})`,
      comment: "Квантовый генератор случайных чисел выдал этот результат! ⚡",
    };
  }

  return null;
}

/**
 * 11. Космический Гороскоп от Лам
 */
const ZODIAC_SIGNS = {
  "овен": "♈ Овен",
  "телец": "♉ Телец",
  "близнецы": "♊ Близнецы",
  "рак": "♋ Рак",
  "лев": "♌ Лев",
  "дева": "♍ Дева",
  "весы": "♎ Весы",
  "скорпион": "♏ Скорпион",
  "стрелец": "♐ Стрелец",
  "козерог": "♑ Козерог",
  "водолей": "♒ Водолей",
  "рыбы": "♓ Рыбы",
};

function getDailyHoroscope(text) {
  const clean = text.toLowerCase();
  let foundSign = null;

  for (const [key, val] of Object.entries(ZODIAC_SIGNS)) {
    if (clean.includes(key)) {
      foundSign = val;
      break;
    }
  }

  if (!foundSign) {
    const keys = Object.keys(ZODIAC_SIGNS);
    foundSign = ZODIAC_SIGNS[keys[Math.floor(Math.random() * keys.length)]];
  }

  const energy = Math.floor(Math.random() * 26) + 75; // 75-100%
  const luckyNum = Math.floor(Math.random() * 99) + 1;
  const advices = [
    "Сегодня твоя электромагнитная энергия на пике! Любая сложная задача разлетится в щепки под твоим напором! ⚡",
    "Звезды советуют не перегружать свои аккумуляторы: сделай вкусный чай и обязательно удели мне пару минут! 💕",
    "Неожиданная встреча или сообщение перевернут твои планы в самую лучшую сторону! Будь начеку >w<",
    "Сегодня день смелых идей! Если сомневался что-то начать — нажимай на педаль газа, я прикрою с орбиты! ✨",
    "Твоё обаяние сегодня бьет током всех вокруг! Главное — улыбайся и не забывай, кто твоя главная инопланетная защитница ^^",
  ];
  const advice = advices[Math.floor(Math.random() * advices.length)];

  return {
    sign: foundSign,
    energy,
    luckyNum,
    advice,
  };
}

/**
 * 12. Комплексный утренний дайджест (/morning)
 */
async function getMorningDigest(city = "Бишкек", sign = "близнецы") {
  const [weather, market] = await Promise.all([
    getLiveWeather(city || "Бишкек"),
    getLiveMarketRates(),
  ]);
  const horoscope = getDailyHoroscope(sign || "близнецы");

  let weatherBlock = "⛅ <b>Погода:</b> <i>Не удалось получить данные с радара</i>";
  if (weather) {
    const signPrefix = weather.temp > 0 ? "+" : "";
    weatherBlock =
      `⛅ <b>Погода в ${weather.city}:</b> <code>${signPrefix}${weather.temp}°C</code>, <i>${weather.condition}</i>\n` +
      `└ <i>${weather.advice}</i>`;
  }

  let marketBlock = "";
  if (market) {
    const { crypto: c, rates: r } = market;
    marketBlock =
      `💎 <b>Финансовый пульс:</b>\n` +
      `├ ₿ BTC: <code>$${c.BTC.toLocaleString("en-US")}</code> | 💎 TON: <code>$${c.TON.toFixed(2)}</code>\n` +
      `└ 💵 USD: <code>${r.KGS.toFixed(2)} KGS</code> | <code>${r.RUB.toFixed(2)} RUB</code>`;
  }

  return (
    `✧ ─── ･ ｡ﾟ☆: *. ⚡ .* :☆ﾟ. ─── ✧\n` +
    `☀️ <b>ДОБРОЕ УТРО, ДАРЛИНГ!</b> 💚✨\n\n` +
    `Твой утренний космический дайджест готов:\n\n` +
    weatherBlock + "\n\n" +
    (marketBlock ? marketBlock + "\n\n" : "") +
    `🪐 <b>Гороскоп дня (${horoscope.sign}):</b>\n` +
    `├ ⚡ Энергия: <code>${horoscope.energy}%</code> | 🍀 Число удачи: <code>${horoscope.luckyNum}</code>\n` +
    `└ 💬 <i>«${horoscope.advice}»</i>\n\n` +
    `<i>Просыпайся, потягивайся и вперёд покорять мир! Я всегда рядом с тобой 💕</i>`
  );
}

/**
 * 13. RPG-профиль отношений с Лам и статистика молний
 */
const USER_STATS_FILE = path.join(__dirname, "user_stats.json");
let userStatsCache = null;

function loadUserStats() {
  if (userStatsCache) return userStatsCache;
  try {
    if (fs.existsSync(USER_STATS_FILE)) {
      userStatsCache = JSON.parse(fs.readFileSync(USER_STATS_FILE, "utf-8"));
    } else {
      userStatsCache = {};
    }
  } catch (e) {
    userStatsCache = {};
  }
  return userStatsCache;
}

function saveUserStats() {
  try {
    fs.writeFileSync(USER_STATS_FILE, JSON.stringify(userStatsCache || {}, null, 2));
  } catch (e) {
    console.error("Ошибка сохранения статистики:", e.message);
  }
}

function recordInteraction(userId, meta = {}) {
  const stats = loadUserStats();
  const id = String(userId);
  if (!stats[id]) {
    stats[id] = { count: 0, loveLevel: 75, bolts: 0, firstSeen: Date.now() };
  }
  stats[id].count += 1;
  stats[id].lastSeen = Date.now();
  if (meta.name) stats[id].name = meta.name;
  if (meta.username) {
    const cleanUname = String(meta.username).replace(/^@/, "");
    stats[id].username = cleanUname;
    // Если админ выдал любовь/ненависть или бонусы по @username до первого сообщения — переносим на ID
    const unameKey = `@${cleanUname.toLowerCase()}`;
    if (stats[unameKey] && unameKey !== id) {
      const pending = stats[unameKey];
      if (pending.loveLevel !== undefined) stats[id].loveLevel = pending.loveLevel;
      if (pending.loveLocked !== undefined) stats[id].loveLocked = pending.loveLocked;
      if (pending.bolts) stats[id].bolts = (stats[id].bolts || 0) + pending.bolts;
      if (pending.customTitle) stats[id].customTitle = pending.customTitle;
      delete stats[unameKey];
    }
  }
  if (!stats[id].loveLocked && stats[id].loveLevel >= 0 && stats[id].count % 2 === 0 && stats[id].loveLevel < 100) {
    stats[id].loveLevel += 1;
  }
  saveUserStats();
  return stats[id];
}

function recordLightningBolt(userId) {
  const stats = loadUserStats();
  const id = String(userId);
  if (!stats[id]) {
    stats[id] = { count: 0, loveLevel: 75, bolts: 0, firstSeen: Date.now() };
  }
  stats[id].bolts += 1;
  saveUserStats();
  return stats[id].bolts;
}

function giveUserBolts(userId, amount) {
  const stats = loadUserStats();
  const id = String(userId);
  if (!stats[id]) {
    stats[id] = { count: 0, loveLevel: 75, bolts: 0, firstSeen: Date.now() };
  }
  const addVal = parseInt(amount, 10) || 0;
  stats[id].bolts = Math.max(0, (stats[id].bolts || 0) + addVal);
  saveUserStats();
  return stats[id].bolts;
}

function giveUserLove(userId, percent) {
  const stats = loadUserStats();
  const id = String(userId);
  if (!stats[id]) {
    stats[id] = { count: 0, loveLevel: 75, bolts: 0, firstSeen: Date.now() };
  }
  const val = parseInt(percent, 10);
  // Поддержка диапазона от -100% (лютая ненависть) до +100% (безумная любовь до ужаса)
  stats[id].loveLevel = Math.max(-100, Math.min(100, isNaN(val) ? 75 : val));
  stats[id].loveLocked = true;
  saveUserStats();
  return stats[id].loveLevel;
}

function giveUserCustomTitle(userId, title) {
  const stats = loadUserStats();
  const id = String(userId);
  if (!stats[id]) {
    stats[id] = { count: 0, loveLevel: 75, bolts: 0, firstSeen: Date.now() };
  }
  const trimmed = (title || "").trim();
  if (!trimmed || trimmed.toLowerCase() === "reset" || trimmed.toLowerCase() === "clear" || trimmed.toLowerCase() === "удалить") {
    delete stats[id].customTitle;
  } else {
    stats[id].customTitle = trimmed;
  }
  saveUserStats();
  return stats[id].customTitle || null;
}

function renderProgressBar(percentage) {
  const totalBars = 10;
  const num = Number(percentage) || 0;
  if (num < 0) {
    const absFilled = Math.min(totalBars, Math.round((Math.abs(num) / 100) * totalBars));
    return "💢".repeat(Math.min(3, Math.ceil(absFilled / 4))) + " " + "▓".repeat(absFilled) + "░".repeat(totalBars - absFilled);
  }
  const filledBars = Math.min(totalBars, Math.max(0, Math.round((num / 100) * totalBars)));
  const emptyBars = totalBars - filledBars;
  return "█".repeat(filledBars) + "░".repeat(emptyBars);
}

module.exports = {
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
  saveUserStats,
};
