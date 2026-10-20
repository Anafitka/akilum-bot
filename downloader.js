const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

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
  return /tiktok\.com|instagram\.com|youtube\.com|youtu\.be|x\.com|twitter\.com|pinterest\.com|pin\.it|reddit\.com|vk\.com|twitch\.tv|threads\.net|likee\.video/i.test(
    url
  );
}

async function expandUrl(url) {
  try {
    const res = await fetch(url, { method: "HEAD", redirect: "follow" });
    return res.url || url;
  } catch (e) {
    return url;
  }
}

async function downloadVideo(rawUrl) {
  const url = await expandUrl(rawUrl);

  return new Promise((resolve, reject) => {
    const timestamp = Date.now();
    const outputTemplate = path.join(DOWNLOADS_DIR, `${timestamp}_%(id)s.%(ext)s`);

    const args = [
      url,
      "-o",
      outputTemplate,
      "-f",
      "b[filesize<48M]/best[ext=mp4]/best",
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
      if (files.length === 0) {
        let errMsg = "Не удалось скачать видео";
        if (stderr.includes("empty media response") || stderr.includes("login required") || stderr.includes("401")) {
          errMsg = "INSTAGRAM_LOGIN_REQUIRED";
        }
        return reject(new Error(errMsg));
      }

      const filePath = path.join(DOWNLOADS_DIR, files[0]);
      const title = stdout.trim().split("\n")[0] || "Видео";

      resolve({ filePath, title });
    });
  });
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
