const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const { alldl } = require("rahad-all-downloader-v2");
const { instagramGetUrl } = require("instagram-url-direct");

const isWin = process.platform === "win32";
const BIN_DIR = path.join(__dirname, "bin");
const YTDLP_PATH = isWin ? path.join(BIN_DIR, "yt-dlp.exe") : "yt-dlp";
const DOWNLOADS_DIR = path.join(__dirname, "downloads");
const COOKIES_PATH = path.join(__dirname, "cookies.txt");

if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

function extractUrl(text) {
  if (!text) return null;
  const match = text.match(/https?:\/\/[^\s]+/i);
  return match ? match[0] : null;
}

function isVideoUrl(url) {
  if (!url) return false;
  return /tiktok\.com|instagram\.com|youtube\.com|youtu\.be|x\.com|twitter\.com|pinterest\.com|pin\.it|reddit\.com|vk\.com|twitch\.tv|threads\.net|likee\.video|facebook\.com|fb\.watch/i.test(
    url
  );
}

async function expandUrl(rawUrl) {
  try {
    const res = await fetch(rawUrl, {
      method: "GET",
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      },
    });
    return res.url || rawUrl;
  } catch (e) {
    return rawUrl;
  }
}

// 1. Движок TikWM для TikTok
async function tryTikwm(url) {
  if (!/tiktok\.com/i.test(url)) return null;
  try {
    console.log("[Downloader] TikWM запуск для:", url);
    const apiRes = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      },
    });
    const data = await apiRes.json();
    if (data && data.code === 0 && data.data && data.data.play) {
      const videoUrl = data.data.play.startsWith("http")
        ? data.data.play
        : `https://www.tikwm.com${data.data.play}`;
      const title = data.data.title || "TikTok Video";
      const timestamp = Date.now();
      const filePath = path.join(DOWNLOADS_DIR, `${timestamp}_tiktok.mp4`);

      const fileRes = await fetch(videoUrl);
      const arrayBuffer = await fileRes.arrayBuffer();
      fs.writeFileSync(filePath, Buffer.from(arrayBuffer));

      console.log("[Downloader] TikWM успешно скачал:", filePath);
      return { filePath, title };
    }
  } catch (e) {
    console.warn("[Downloader] TikWM ошибка:", e.message);
  }
  return null;
}

// 2. Движок instagram-url-direct для Instagram
async function tryInstagramDirect(url) {
  if (!/instagram\.com/i.test(url)) return null;
  try {
    console.log("[Downloader] instagram-url-direct запуск для:", url);
    const res = await instagramGetUrl(url);
    if (res && res.url_list && res.url_list.length > 0) {
      const videoItem = res.url_list.find((item) => item.type === "video") || res.url_list[0];
      const videoUrl = videoItem.url;
      const title = res.post_info?.caption?.slice(0, 50) || "Instagram Reel";
      const timestamp = Date.now();
      const filePath = path.join(DOWNLOADS_DIR, `${timestamp}_insta.mp4`);

      const fileRes = await fetch(videoUrl);
      const arrayBuffer = await fileRes.arrayBuffer();
      fs.writeFileSync(filePath, Buffer.from(arrayBuffer));

      console.log("[Downloader] instagram-url-direct успешно скачал:", filePath);
      return { filePath, title };
    }
  } catch (e) {
    console.warn("[Downloader] instagram-url-direct ошибка:", e.message);
  }
  return null;
}

// 3. Универсальный мульти-парсинг движок alldl (YouTube, TikTok, Pinterest, Instagram, Reddit, X)
async function tryAlldl(url) {
  try {
    console.log("[Downloader] alldl запуск для:", url);
    const result = await alldl.download(url, DOWNLOADS_DIR, { maxHeight: 1080 });
    if (result && result.path && fs.existsSync(result.path)) {
      const stats = fs.statSync(result.path);
      if (stats.size > 0) {
        console.log("[Downloader] alldl успешно скачал:", result.path, "размер:", stats.size);
        return {
          filePath: result.path,
          title: result.title || "Видео",
        };
      }
    }
  } catch (err) {
    console.warn("[Downloader] alldl не справился:", err.message);
  }
  return null;
}

// 4. Локальный комбайн yt-dlp с ffmpeg
async function tryYtDlp(url) {
  return new Promise((resolve) => {
    console.log("[Downloader] yt-dlp запуск для:", url);
    const timestamp = Date.now();
    const outputTemplate = path.join(DOWNLOADS_DIR, `${timestamp}_%(id)s.%(ext)s`);

    const args = [
      url,
      "-o",
      outputTemplate,
      "-f",
      "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=1080]+bestaudio/best[ext=mp4]/best",
      "--merge-output-format",
      "mp4",
      "--no-playlist",
      "--max-filesize",
      "49M",
      "--no-warnings",
      "--print",
      "after_move:%(title)s",
    ];

    if (isWin) {
      args.push("--ffmpeg-location", BIN_DIR);
      args.push("--js-runtimes", "node");
    }

    if (fs.existsSync(COOKIES_PATH)) {
      args.push("--cookies", COOKIES_PATH);
    }

    const proc = spawn(YTDLP_PATH, args);
    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      const files = fs.readdirSync(DOWNLOADS_DIR).filter((f) => f.startsWith(`${timestamp}_`));
      if (files.length > 0) {
        const filePath = path.join(DOWNLOADS_DIR, files[0]);
        const title = stdout.trim().split("\n")[0] || "Видео";
        console.log("[Downloader] yt-dlp успешно скачал:", filePath);
        return resolve({ filePath, title });
      }

      console.warn("[Downloader] yt-dlp завершился с кодом", code, "stderr:", stderr.trim());
      resolve(null);
    });

    proc.on("error", (err) => {
      console.warn("[Downloader] yt-dlp ошибка вызова:", err.message);
      resolve(null);
    });
  });
}

// Главный каскадный диспетчер скачивания
async function downloadVideo(rawUrl) {
  const url = await expandUrl(rawUrl);
  console.log("[Downloader] Обработка ссылки:", url);

  let result = null;

  // Если это TikTok
  if (/tiktok\.com/i.test(url)) {
    result = await tryTikwm(url);
    if (!result) result = await tryAlldl(url);
    if (!result) result = await tryYtDlp(url);
  }
  // Если это Instagram
  else if (/instagram\.com/i.test(url)) {
    result = await tryInstagramDirect(url);
    if (!result) result = await tryAlldl(url);
    if (!result) result = await tryYtDlp(url);
  }
  // Все остальные (YouTube, Pinterest, X/Twitter, Reddit и др.)
  else {
    result = await tryAlldl(url);
    if (!result) result = await tryYtDlp(url);
  }

  if (!result || !result.filePath || !fs.existsSync(result.filePath)) {
    throw new Error("FAILED_ALL_ENGINES");
  }

  const stats = fs.statSync(result.filePath);
  if (stats.size > 50 * 1024 * 1024) {
    cleanupFile(result.filePath);
    throw new Error("FILE_TOO_LARGE");
  }

  return result;
}

function cleanupFile(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (e) {
    console.error("Ошибка удаления файла:", e.message);
  }
}

module.exports = { extractUrl, isVideoUrl, downloadVideo, cleanupFile };
