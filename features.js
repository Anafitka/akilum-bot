const path = require("path");
const fs = require("fs");

/**
 * 1. Генерация картинок через Pollinations Flux (Бесплатно, HD 1024x1024)
 */
async function generateArtwork(userPrompt) {
  // Очищаем и улучшаем промпт для красивого рендера
  let prompt = userPrompt
    .replace(/^(нарисуй|сгенерируй|создай арт|сделай арт|нарисуй мне|draw|generate|art|img)\s*/i, "")
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
    .replace(/^(найди трек|найди песню|скинь трек|скинь песню|найди музыку|трек|песня)\s*/i, "")
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

module.exports = {
  generateArtwork,
  searchMusicTrack,
  parseReminderRequest,
};
