const path = require("path");
const fs = require("fs");

/**
 * 1. Генерация картинок через Pollinations Flux (Бесплатно, HD 1024x1024)
 */
async function generateArtwork(userPrompt) {
  let prompt = userPrompt
    .replace(/^(нарисуй|сгенерируй фото|сгенерируй арт|сделай арт|создай фото|нарисуй мне|draw|generate|art|img)\s*/i, "")
    .trim();

  if (!prompt) {
    prompt = "cute anime girl lum urusei yatsura vibrant neon aesthetic colors 4k high quality masterpiece";
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
  const cleanQuery = query
    .replace(/^(найди трек|найди песню|скинь трек|скинь песню|найди музыку|трек|песня|\/music|\/song)\s*/i, "")
    .trim();

  if (!cleanQuery) return null;

  try {
    const res = await fetch(
      `https://itunes.apple.com/search?term=${encodeURIComponent(cleanQuery)}&entity=song&limit=1`
    );
    const data = await res.json();
    if (data.results && data.results.length > 0) {
      const track = data.results[0];
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

module.exports = {
  generateArtwork,
  searchMusicTrack,
  parseReminderRequest,
  getLiveWeather,
  getQrCodeUrl,
  getWikiSummary,
};
