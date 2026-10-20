/**
 * ai_engine.js — Высокопроизводительный мульти-провайдерный AI движок для @akilum_bot.
 * Архитектура для работы на весь класс БЕЗ ЛИМИТОВ и БЕЗ ОШИБОК 429:
 * 
 * 1. Groq Cloud Engine: молниеносный ответ (~0.3-0.5с), 14 400 бесплатных запросов/день на каждый ключ.
 * 2. Gemini Multi-Key Pool: ротация неограниченного числа бесплатных ключей Google Gemini,
 *    автоматическое переключение между независимыми квотами моделей (3.1-flash-lite, 3.5-flash-lite, 3.7-flash, 3.8-flash)
 *    и мгновенный failover на следующий ключ при 429 RESOURCE_EXHAUSTED.
 * 3. Pollinations AI Fallback: бесплатный аварийный резерв без API-ключей.
 */

const { GoogleGenAI } = require("@google/genai");

class KeyPool {
  constructor(name, keys, createClientFn) {
    this.name = name;
    this.items = (keys || []).map((key, index) => ({
      id: index + 1,
      key,
      maskedKey: key.length > 8 ? `${key.slice(0, 4)}...${key.slice(-4)}` : "***",
      client: createClientFn ? createClientFn(key) : null,
      cooldownUntil: 0,
      totalSuccess: 0,
      totalFailures: 0,
    }));
    this.roundRobinIndex = 0;
  }

  get size() {
    return this.items.length;
  }

  getAvailable() {
    if (this.items.length === 0) return null;
    const now = Date.now();
    const ready = this.items.filter((item) => item.cooldownUntil <= now);

    if (ready.length > 0) {
      const chosen = ready[this.roundRobinIndex % ready.length];
      this.roundRobinIndex = (this.roundRobinIndex + 1) % ready.length;
      return chosen;
    }

    // Если все на кулдауне — берем тот, у которого кулдаун кончится раньше всех
    const sorted = [...this.items].sort((a, b) => a.cooldownUntil - b.cooldownUntil);
    return sorted[0];
  }

  markCooldown(item, ms = 60000, reason = "") {
    if (!item) return;
    item.cooldownUntil = Date.now() + ms;
    item.totalFailures++;
    console.warn(
      `⚠️ [${this.name}] Ключ #${item.id} (${item.maskedKey}) на кулдауне ${Math.round(
        ms / 1000
      )}с. Причина: ${reason}`
    );
  }

  markSuccess(item) {
    if (!item) return;
    item.totalSuccess++;
    item.cooldownUntil = 0;
  }

  getStats() {
    const now = Date.now();
    return this.items.map((it) => ({
      id: it.id,
      key: it.maskedKey,
      active: it.cooldownUntil <= now,
      cooldownLeftSec: Math.max(0, Math.round((it.cooldownUntil - now) / 1000)),
      success: it.totalSuccess,
      fails: it.totalFailures,
    }));
  }
}

// Извлечение списка ключей из строки (поддерживает запятые, пробелы, переводы строк)
function parseKeyList(envValue) {
  if (!envValue) return [];
  return envValue
    .split(/[\s,;]+/)
    .map((k) => k.trim())
    .filter((k) => k.length > 6);
}

// 1. Инициализация пула Google Gemini
const rawGeminiKeys = [
  ...parseKeyList(process.env.GEMINI_API_KEYS),
  ...parseKeyList(process.env.GEMINI_API_KEY),
];
const uniqueGeminiKeys = Array.from(new Set(rawGeminiKeys));

const geminiPool = new KeyPool("Gemini", uniqueGeminiKeys, (key) => {
  return new GoogleGenAI({
    apiKey: key,
    httpOptions: { retryOptions: { attempts: 1 } },
  });
});

console.log(`🔌 [AI Engine] Загружено Gemini ключей в пул: ${geminiPool.size}`);

// 2. Инициализация пула Groq Cloud (Free Tier: 14,400 req/day, 30 RPM, ~300ms)
const rawGroqKeys = [
  ...parseKeyList(process.env.GROQ_API_KEYS),
  ...parseKeyList(process.env.GROQ_API_KEY),
];
const uniqueGroqKeys = Array.from(new Set(rawGroqKeys));

const groqPool = new KeyPool("Groq", uniqueGroqKeys, (key) => key);
if (groqPool.size > 0) {
  console.log(`🚀 [AI Engine] Загружено Groq ключей в пул: ${groqPool.size} (ультра-скорость включена!)`);
}

// Модели Gemini по приоритету (у каждой модели свой независимый лимит квот в Google!)
const GEMINI_MODELS = [
  "gemini-3.1-flash-lite",
  "gemini-3.5-flash-lite",
  "gemini-3.7-flash",
  "gemini-3.8-flash",
  "gemini-flash-latest",
];

// Модели Groq по приоритету скорости и качества
const GROQ_MODELS = [
  "qwen/qwen3.8-27b",
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
];

// Преобразование истории Gemini в формат сообщений OpenAI/Groq
function toOpenAIMessages(contents, systemPrompt) {
  const messages = [];
  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }

  for (const item of contents) {
    const role = item.role === "model" ? "assistant" : "user";
    const textPart = (item.parts || [])
      .map((p) => (typeof p === "string" ? p : p.text || ""))
      .filter(Boolean)
      .join("\n");
    if (textPart) {
      messages.push({ role, content: textPart });
    }
  }
  return messages;
}

/**
 * Вызов Groq Cloud API (~0.3-0.5 секунд ответ)
 */
async function callGroq(messages, maxTokens = 350, timeoutMs = 6000) {
  const keyItem = groqPool.getAvailable();
  if (!keyItem) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    for (const model of GROQ_MODELS) {
      try {
        const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${keyItem.key}`,
          },
          body: JSON.stringify({
            model,
            messages,
            max_tokens: maxTokens,
            temperature: 0.75,
          }),
          signal: controller.signal,
        });

        if (res.status === 429) {
          groqPool.markCooldown(keyItem, 60000, "Rate Limit (429)");
          return null;
        }

        if (!res.ok) {
          continue;
        }

        const data = await res.json();
        const reply = data?.choices?.[0]?.message?.content?.trim();
        if (reply) {
          clearTimeout(timer);
          groqPool.markSuccess(keyItem);
          return reply;
        }
      } catch (err) {
        if (err.name === "AbortError") break;
      }
    }
  } finally {
    clearTimeout(timer);
  }
  return null;
}

/**
 * Вызов Google Gemini с умной ротацией моделей и ключей из пула
 */
async function callGemini(contents, systemPrompt, maxTokens = 120, timeoutMs = 15000) {
  if (geminiPool.size === 0) return null;

  const maxKeyAttempts = Math.min(geminiPool.size, 4);

  for (let k = 0; k < maxKeyAttempts; k++) {
    const keyItem = geminiPool.getAvailable();
    if (!keyItem) break;

    let keyAllExhausted = true;

    for (const model of GEMINI_MODELS) {
      try {
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Timeout")), timeoutMs)
        );

        const genPromise = keyItem.client.models.generateContent({
          model,
          contents,
          config: {
            systemInstruction: systemPrompt,
            maxOutputTokens: maxTokens,
          },
        });

        const res = await Promise.race([genPromise, timeoutPromise]);
        if (res && res.text) {
          geminiPool.markSuccess(keyItem);
          return res.text.trim();
        }
      } catch (err) {
        const errMsg = err.message || "";
        const isQuota =
          errMsg.includes("429") ||
          errMsg.includes("RESOURCE_EXHAUSTED") ||
          errMsg.includes("quota");
        const is503 = errMsg.includes("503") || errMsg.includes("UNAVAILABLE");

        if (isQuota) {
          // У этой конкретной модели квота исчерпана — пробуем следующую модель
          continue;
        } else if (is503) {
          // Временный перегруз модели на серверах Google — пробуем другую модель
          continue;
        } else if (errMsg.includes("404")) {
          continue;
        } else {
          keyAllExhausted = false;
          break;
        }
      }
    }

    if (keyAllExhausted) {
      geminiPool.markCooldown(keyItem, 90000, "Все модели ключа исчерпали квоту");
    }
  }

  return null;
}

/**
 * Вызов Pollinations AI (аварийный резерв без API-ключа)
 */
async function callPollinations(messages, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch("https://text.pollinations.ai/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages,
        model: "openai-fast",
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);
    if (!res.ok) return null;

    const text = await res.text();
    if (text && !text.includes("Free limit reached")) {
      return text.trim();
    }
  } catch (err) {
    clearTimeout(timer);
  }
  return null;
}

/**
 * Единый диспетчер генерации ответов Лам:
 * - Мультимодальные запросы (фото, голос, видео) -> Gemini Key Pool (только Gemini понимает файлы).
 * - Текстовые диалоги -> Groq (0.3с) -> Gemini Key Pool -> Pollinations AI.
 */
async function generateLumResponse({
  contents,
  systemPrompt,
  maxOutputTokens = 120,
  timeoutMs = 15000,
  isMultimodal = false,
}) {
  // 1. Для голосовых сообщений, кружочков и фото — Gemini Key Pool
  if (isMultimodal) {
    const geminiReply = await callGemini(contents, systemPrompt, maxOutputTokens, timeoutMs);
    if (geminiReply) return geminiReply;
    return null;
  }

  // 2. Для чисто текстовых запросов:
  const openAIMessages = toOpenAIMessages(contents, systemPrompt);

  // Слой 1: Groq Cloud (если указан хотя бы 1 бесплатный ключ — скорость молнии ~300мс)
  if (groqPool.size > 0) {
    const groqReply = await callGroq(openAIMessages, maxOutputTokens, 5000);
    if (groqReply) return groqReply;
  }

  // Слой 2: Gemini Key Pool (ротация моделей и ключей)
  const geminiReply = await callGemini(contents, systemPrompt, maxOutputTokens, timeoutMs);
  if (geminiReply) return geminiReply;

  // Слой 3: Pollinations AI (аварийный резерв без ключей)
  const pollReply = await callPollinations(openAIMessages, 7000);
  if (pollReply) return pollReply;

  return null;
}

module.exports = {
  geminiPool,
  groqPool,
  generateLumResponse,
};
