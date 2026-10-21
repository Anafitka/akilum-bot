const http = require("http");
const fs = require("fs");
const path = require("path");
const { InputFile, InlineKeyboard } = require("grammy");

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 12e6) {
        req.destroy();
        reject(new Error("Payload too large"));
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        resolve({});
      }
    });
    req.on("error", reject);
  });
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function startWebAppServer(port = Number(process.env.PORT) || 3000, context = {}) {
  const {
    bot,
    isUserVip,
    setUserVip,
    removeUserVip,
    getAllVips,
    getUserDailyUsage,
    resetUserDailyUsage,
    resetAllDailyUsages,
    DAILY_FREE_LIMIT,
    recordInteraction,
    getLiveMarketRates,
    getLiveWeather,
    searchMusicTrack,
    ADMIN_USERNAME = "Akilum",
    ADMIN_PASSWORD = "Clearson0078912",
    createAdminSession,
    isValidAdminSession,
    getFullAdminStats,
    getAllUsersList,
    broadcastMessage,
    botSettings,
    saveSettings,
    paymentOrders,
    approvePaymentOrder,
    rejectPaymentOrder,
    createPaymentOrder,
    pendingPaymentSessions,
    adminIds,
    VIP_PLANS,
    AI_MODELS,
    getUserModel,
    setUserModel,
    resolveTargetUser,
    giveUserBolts,
    giveUserLove,
    giveUserCustomTitle,
    isUserBanned,
    getUserWarns,
    getBanInfo,
    warnUser,
    unwarnUser,
    banUser,
    unbanUser,
    botToken,
  } = context;

  const indexPath = path.join(__dirname, "public", "index.html");
  const adminPath = path.join(__dirname, "public", "admin.html");
  const avatarPath = path.join(__dirname, "public", "avatar.jpg");

  function checkAdminAuth(req, parsedUrl) {
    const authHeader = req.headers["authorization"] || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim() || parsedUrl.searchParams.get("token");
    if (!token || !isValidAdminSession || !isValidAdminSession(token)) {
      return false;
    }
    return true;
  }

  const server = http.createServer(async (req, res) => {
    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === "HEAD") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end();
      return;
    }

    const host = req.headers.host || "localhost";
    const parsedUrl = new URL(req.url, `http://${host}`);
    const pathname = parsedUrl.pathname;

    if (pathname === "/health" || pathname === "/ping") {
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("OK");
      return;
    }

    // Фото бота для WebApp
    if (pathname === "/avatar.jpg" || pathname === "/avatar.png") {
      fs.readFile(avatarPath, (err, content) => {
        if (err) {
          res.writeHead(404);
          res.end("Not Found");
        } else {
          res.writeHead(200, {
            "Content-Type": "image/jpeg",
            "Cache-Control": "public, max-age=86400",
          });
          res.end(content);
        }
      });
      return;
    }

    // ==========================================
    // 👑 ADMIN API ENDPOINTS (ДЛЯ ПАНЕЛИ СОЗДАТЕЛЯ)
    // ==========================================

    // Авторизация администратора
    if (pathname === "/api/admin/login" && req.method === "POST") {
      try {
        const body = await parseJsonBody(req);
        const { username, password } = body;
        if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
          const token = createAdminSession ? createAdminSession() : "admin_token_active";
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok: true, token, username }));
        } else {
          res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok: false, error: "Неверный логин или пароль" }));
        }
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
      return;
    }

    // Проверка активности сессии администратора
    if (pathname === "/api/admin/check-auth") {
      if (!checkAdminAuth(req, parsedUrl)) {
        res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: "Unauthorized" }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true, username: ADMIN_USERNAME }));
      return;
    }

    // Полная статистика бота для дашборда
    if (pathname === "/api/admin/stats") {
      if (!checkAdminAuth(req, parsedUrl)) {
        res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: "Unauthorized" }));
        return;
      }
      const stats = getFullAdminStats ? getFullAdminStats() : {};
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true, ...stats }));
      return;
    }

    // Список всех VIP пользователей
    if (pathname === "/api/admin/vips") {
      if (!checkAdminAuth(req, parsedUrl)) {
        res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: "Unauthorized" }));
        return;
      }
      const vips = getAllVips ? getAllVips() : [];
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true, vips }));
      return;
    }

    // Выдать VIP пользователю (по ID или по @username)
    if (pathname === "/api/admin/give-vip" && req.method === "POST") {
      if (!checkAdminAuth(req, parsedUrl)) {
        res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: "Unauthorized" }));
        return;
      }
      try {
        const body = await parseJsonBody(req);
        const { userId, days, stars } = body;
        if (!userId) {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok: false, error: "Укажите ID или @username пользователя!" }));
          return;
        }

        const target = resolveTargetUser ? await resolveTargetUser(userId) : null;
        const targetId = target ? target.userId : String(userId).replace(/[^\d]/g, "");
        const targetName = target ? target.name : "Дарлинг";
        const targetUsername = target ? target.username : "";

        if (!targetId) {
          res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok: false, error: `Пользователь «${userId}» не найден!` }));
          return;
        }

        if (setUserVip) {
          const numDays = parseInt(days) || 30;
          setUserVip(targetId, numDays, stars || 0, targetName, targetUsername);

          // Оповещаем пользователя в Telegram
          if (bot) {
            const daysText = numDays === -1 ? "Навсегда (Forever 👑)" : `${numDays} дней`;
            bot.api.sendMessage(
              Number(targetId),
              `✧ ─── ･ ｡ﾟ☆: *. 👑 .* :☆ﾟ. ─── ✧\n` +
              `🎉 <b>СЮРПРИЗ ОТ СОЗДАТЕЛЯ БОТА!</b> 👑⭐️✨\n\n` +
              `Тебе лично выдан статус <b>VIP Дарлинга</b> на <b>${daysText}</b>!\n\n` +
              `• Полный безлимит на задачи, код и арт-генерацию ⚡\n` +
              `• Доступ ко всем 4 VIP-моделям нейросетей (/model) 🧠\n` +
              `• Золотая корона в твоём профиле (/love) и во всех беседах 👑\n` +
              `• Высший приоритет от они-принцессы Лам! 💕`,
              { parse_mode: "HTML" }
            ).catch((e) => console.warn("Notify user error:", e.message));
          }
        }
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: true, targetId, name: targetName, username: targetUsername }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
      return;
    }

    // Снять VIP у пользователя (по ID или по @username)
    if (pathname === "/api/admin/take-vip" && req.method === "POST") {
      if (!checkAdminAuth(req, parsedUrl)) {
        res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: "Unauthorized" }));
        return;
      }
      try {
        const body = await parseJsonBody(req);
        const { userId } = body;
        if (!userId) {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok: false, error: "Укажите ID или @username пользователя!" }));
          return;
        }

        const target = resolveTargetUser ? await resolveTargetUser(userId) : null;
        const targetId = target ? target.userId : String(userId).replace(/[^\d]/g, "");

        if (!targetId) {
          res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok: false, error: `Пользователь «${userId}» не найден!` }));
          return;
        }

        if (removeUserVip) {
          removeUserVip(targetId);
        }

        if (bot) {
          bot.api.sendMessage(
            Number(targetId),
            `ℹ️ <b>Уведомление:</b> Ваш VIP-статус был завершён/отозван Создателем бота. Спасибо, что были с нами! 💚`,
            { parse_mode: "HTML" }
          ).catch(() => {});
        }

        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: true, targetId }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
      return;
    }

    // Выдать предупреждение (варн, 3 варна = автобан)
    if (pathname === "/api/admin/warn-user" && req.method === "POST") {
      if (!checkAdminAuth(req, parsedUrl)) {
        res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: "Unauthorized" }));
        return;
      }
      try {
        const body = await parseJsonBody(req);
        const { identifier, reason = "Нарушение правил" } = body;
        if (!identifier) {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok: false, error: "Укажите ID или @username пользователя!" }));
          return;
        }

        const target = resolveTargetUser ? await resolveTargetUser(identifier) : null;
        const targetId = target ? target.userId : String(identifier).replace(/[^\d]/g, "");

        if (!targetId) {
          res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok: false, error: `Пользователь «${identifier}» не найден!` }));
          return;
        }

        const resWarn = warnUser ? warnUser(targetId, reason, "Админ-Панель") : { count: 1, isBanned: false };

        if (bot) {
          if (resWarn.isBanned) {
            bot.api.sendMessage(
              Number(targetId),
              `✧ ─── ･ ｡ﾟ☆: *. ⛔ .* :☆ﾟ. ─── ✧\n` +
              `⛔ <b>ТВОЙ АККАУНТ ЗАБЛОКИРОВАН НАВСЕГДА!</b> 🚫\n\n` +
              `Ты набрал <b>3 из 3 предупреждений</b>.\n` +
              `• <b>Последняя причина:</b> ${escapeHtml(reason)}\n\n` +
              `<i>Доступ ко всем функциям Лам навсегда ограничен.</i>`,
              { parse_mode: "HTML" }
            ).catch(() => {});
          } else {
            bot.api.sendMessage(
              Number(targetId),
              `✧ ─── ･ ｡ﾟ☆: *. ⚠️ .* :☆ﾟ. ─── ✧\n` +
              `⚠️ <b>ВНИМАНИЕ! ТЫ ПОЛУЧИЛ ПРЕДУПРЕЖДЕНИЕ (${resWarn.count}/3)!</b> ⚡\n\n` +
              `• <b>Причина:</b> ${escapeHtml(reason)}\n` +
              `• <b>Выдал:</b> Администратор\n\n` +
              `<i>Дарлинг, соблюдай правила! При получении 3 предупреждений твой доступ к боту будет заблокирован навсегда! 💔</i>`,
              { parse_mode: "HTML" }
            ).catch(() => {});
          }
        }

        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({
          ok: true,
          count: resWarn.count,
          isBanned: resWarn.isBanned,
          user: target ? { name: target.name, username: target.username, userId: target.userId } : { userId: targetId }
        }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
      return;
    }

    // Снять предупреждение (unwarn)
    if (pathname === "/api/admin/unwarn-user" && req.method === "POST") {
      if (!checkAdminAuth(req, parsedUrl)) {
        res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: "Unauthorized" }));
        return;
      }
      try {
        const body = await parseJsonBody(req);
        const { identifier } = body;
        if (!identifier) {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok: false, error: "Укажите ID или @username пользователя!" }));
          return;
        }

        const target = resolveTargetUser ? await resolveTargetUser(identifier) : null;
        const targetId = target ? target.userId : String(identifier).replace(/[^\d]/g, "");

        if (!targetId) {
          res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok: false, error: `Пользователь «${identifier}» не найден!` }));
          return;
        }

        const resUnwarn = unwarnUser ? unwarnUser(targetId) : { count: 0 };

        if (bot) {
          bot.api.sendMessage(
            Number(targetId),
            `✧ ─── ･ ｡ﾟ☆: *. 💚 .* :☆ﾟ. ─── ✧\n` +
            `✅ <b>Администратор снял с тебя одно предупреждение!</b>\n` +
            `Текущие варны: <code>${resUnwarn.count}/3</code>. Спасибо за соблюдение правил! ✨`,
            { parse_mode: "HTML" }
          ).catch(() => {});
        }

        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: true, count: resUnwarn.count }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
      return;
    }

    // Заблокировать пользователя (бан)
    if (pathname === "/api/admin/ban-user" && req.method === "POST") {
      if (!checkAdminAuth(req, parsedUrl)) {
        res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: "Unauthorized" }));
        return;
      }
      try {
        const body = await parseJsonBody(req);
        const { identifier, reason = "Решение администратора" } = body;
        if (!identifier) {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok: false, error: "Укажите ID или @username пользователя!" }));
          return;
        }

        const target = resolveTargetUser ? await resolveTargetUser(identifier) : null;
        const targetId = target ? target.userId : String(identifier).replace(/[^\d]/g, "");

        if (!targetId) {
          res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok: false, error: `Пользователь «${identifier}» не найден!` }));
          return;
        }

        if (banUser) banUser(targetId, reason, "Админ-Панель");

        if (bot) {
          bot.api.sendMessage(
            Number(targetId),
            `✧ ─── ･ ｡ﾟ☆: *. ⛔ .* :☆ﾟ. ─── ✧\n` +
            `⛔ <b>ТВОЙ ДОСТУП К БОТУ ЗАБЛОКИРОВАН!</b> 🚫\n\n` +
            `• <b>Причина:</b> ${escapeHtml(reason)}\n` +
            `• <b>Кем:</b> Создатель бота\n\n` +
            `<i>Все команды и функции отключены.</i>`,
            { parse_mode: "HTML" }
          ).catch(() => {});
        }

        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: true, user: target ? { name: target.name, username: target.username, userId: target.userId } : { userId: targetId } }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
      return;
    }

    // Разблокировать пользователя (разбан)
    if (pathname === "/api/admin/unban-user" && req.method === "POST") {
      if (!checkAdminAuth(req, parsedUrl)) {
        res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: "Unauthorized" }));
        return;
      }
      try {
        const body = await parseJsonBody(req);
        const { identifier } = body;
        if (!identifier) {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok: false, error: "Укажите ID или @username пользователя!" }));
          return;
        }

        const target = resolveTargetUser ? await resolveTargetUser(identifier) : null;
        const targetId = target ? target.userId : String(identifier).replace(/[^\d]/g, "");

        if (!targetId) {
          res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok: false, error: `Пользователь «${identifier}» не найден!` }));
          return;
        }

        if (unbanUser) unbanUser(targetId);

        if (bot) {
          bot.api.sendMessage(
            Number(targetId),
            `✧ ─── ･ ｡ﾟ☆: *. 💚 .* :☆ﾟ. ─── ✧\n` +
            `🔓 <b>УРА! ТВОЙ АККАУНТ РАЗБЛОКИРОВАН СОЗДАТЕЛЕМ!</b> ✨\n\n` +
            `Все ограничения сняты, варны сброшены. Добро пожаловать обратно, Дарлинг! 💕`,
            { parse_mode: "HTML" }
          ).catch(() => {});
        }

        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: true, user: target ? { name: target.name, username: target.username, userId: target.userId } : { userId: targetId } }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
      return;
    }

    // Наградить пользователя бонусами (VIP, Искорки, Любовь, Титул, Сброс энергии)
    if (pathname === "/api/admin/give-reward" && req.method === "POST") {
      if (!checkAdminAuth(req, parsedUrl)) {
        res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: "Unauthorized" }));
        return;
      }
      try {
        const body = await parseJsonBody(req);
        const { userId, vipDays, bolts, loveLevel, customTitle, resetLimits } = body;
        if (!userId) {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok: false, error: "Укажите ID или @username пользователя!" }));
          return;
        }

        const target = resolveTargetUser ? await resolveTargetUser(userId) : null;
        const targetId = target ? target.userId : String(userId).replace(/[^\d]/g, "");

        if (!targetId) {
          res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok: false, error: `Пользователь «${userId}» не найден!` }));
          return;
        }

        const targetName = target ? target.name : "Дарлинг";
        const targetUsername = target ? target.username : "";
        const perksAwarded = [];

        // 1. VIP статус
        if (vipDays !== undefined && vipDays !== null && vipDays !== "") {
          const vDays = parseInt(vipDays, 10);
          if (vDays === -999) {
            if (removeUserVip) removeUserVip(targetId);
            perksAwarded.push("❌ VIP статус отозван");
          } else if (!isNaN(vDays)) {
            if (setUserVip) setUserVip(targetId, vDays, 0, targetName, targetUsername);
            const dLabel = vDays <= 0 ? "НАВСЕГДА 👑" : `${vDays} дн.`;
            perksAwarded.push(`👑 VIP-статус (${dLabel})`);
          }
        }

        // 2. Искорки / Молнии
        if (bolts !== undefined && bolts !== null && bolts !== "") {
          const bAmount = parseInt(bolts, 10);
          if (!isNaN(bAmount) && bAmount > 0 && giveUserBolts) {
            const newTotal = giveUserBolts(targetId, bAmount);
            perksAwarded.push(`⚡ +${bAmount} молний (всего: ${newTotal})`);
          }
        }

        // 3. Уровень любви
        if (loveLevel !== undefined && loveLevel !== null && loveLevel !== "") {
          const lVal = parseInt(loveLevel, 10);
          if (!isNaN(lVal) && giveUserLove) {
            giveUserLove(targetId, lVal);
            perksAwarded.push(`💖 Связь с Лам: ${lVal}%`);
          }
        }

        // 4. Кастомный титул
        if (customTitle !== undefined && customTitle !== null) {
          if (giveUserCustomTitle) {
            const newTitle = giveUserCustomTitle(targetId, customTitle);
            if (newTitle) perksAwarded.push(`🏷 Титул: «${newTitle}»`);
            else perksAwarded.push(`🏷 Титул сброшен на стандартный`);
          }
        }

        // 5. Сброс лимитов энергии
        if (resetLimits && resetUserDailyUsage) {
          resetUserDailyUsage(targetId);
          perksAwarded.push(`🔋 Полная перезарядка энергии`);
        }

        // Оповещение в Telegram
        if (bot && perksAwarded.length > 0) {
          const perksList = perksAwarded.map(p => `• ${p}`).join("\n");
          bot.api.sendMessage(
            Number(targetId),
            `✧ ─── ･ ｡ﾟ☆: *. 🎁 .* :☆ﾟ. ─── ✧\n` +
            `🎉 <b>ВАМ ПРИШЕЛ ПОДАРОК ОТ СОЗДАТЕЛЯ!</b> 👑✨\n\n` +
            `Создатель бота лично даровал вам особые привилегии:\n` +
            `${perksList}\n\n` +
            `<i>«Ты просто чудо, мой Дарлинг! Наслаждайся! 💚⚡»</i>`,
            { parse_mode: "HTML" }
          ).catch((e) => console.warn("Notify gift error:", e.message));
        }

        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: true, targetId, name: targetName, username: targetUsername, perksAwarded }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
      return;
    }

    // Поиск пользователя по ID или @username
    if (pathname === "/api/admin/find-user") {
      if (!checkAdminAuth(req, parsedUrl)) {
        res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: "Unauthorized" }));
        return;
      }
      const query = parsedUrl.searchParams.get("query");
      const target = resolveTargetUser ? await resolveTargetUser(query) : null;
      if (!target) {
        res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: `Пользователь «${query}» не найден` }));
        return;
      }
      const isVip = isUserVip ? isUserVip(target.userId) : false;
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({
        ok: true,
        user: {
          userId: target.userId,
          name: target.name,
          username: target.username,
          isVip,
          loveLevel: target.stats?.loveLevel || 75,
          bolts: target.stats?.bolts || 0,
          customTitle: target.stats?.customTitle || "",
          count: target.stats?.count || 0,
        }
      }));
      return;
    }

    // Список всех пользователей
    if (pathname === "/api/admin/users") {
      if (!checkAdminAuth(req, parsedUrl)) {
        res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: "Unauthorized" }));
        return;
      }
      const users = getAllUsersList ? getAllUsersList() : [];
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true, users }));
      return;
    }

    // Запуск массовой рассылки
    if (pathname === "/api/admin/broadcast" && req.method === "POST") {
      if (!checkAdminAuth(req, parsedUrl)) {
        res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: "Unauthorized" }));
        return;
      }
      try {
        const body = await parseJsonBody(req);
        const { text } = body;
        if (!text) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "text is required" }));
          return;
        }

        if (broadcastMessage && bot) {
          const result = await broadcastMessage(bot, text);
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok: true, ...result }));
          return;
        }
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "Broadcast service not configured" }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
      return;
    }

    // Обновление глобальных настроек
    if (pathname === "/api/admin/settings" && req.method === "POST") {
      if (!checkAdminAuth(req, parsedUrl)) {
        res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: "Unauthorized" }));
        return;
      }
      try {
        const body = await parseJsonBody(req);
        if (body.dailyFreeLimit && botSettings) {
          botSettings.dailyFreeLimit = Number(body.dailyFreeLimit);
          if (saveSettings) saveSettings();
        }
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: true, settings: botSettings }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
      return;
    }

    // Сбросить лимиты энергии всем пользователям
    if (pathname === "/api/admin/reset-limits" && req.method === "POST") {
      if (!checkAdminAuth(req, parsedUrl)) {
        res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: "Unauthorized" }));
        return;
      }
      if (resetAllDailyUsages) {
        resetAllDailyUsages();
      }
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // Список всех чеков и платежей (для админки)
    if (pathname === "/api/admin/payments") {
      if (!checkAdminAuth(req, parsedUrl)) {
        res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: "Unauthorized" }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true, payments: paymentOrders || [] }));
      return;
    }

    // Подтвердить платёж и выдать VIP пользователю
    if (pathname === "/api/admin/approve-payment" && req.method === "POST") {
      if (!checkAdminAuth(req, parsedUrl)) {
        res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: "Unauthorized" }));
        return;
      }
      try {
        const body = await parseJsonBody(req);
        const { orderId } = body;
        if (!orderId) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "orderId is required" }));
          return;
        }

        const order = approvePaymentOrder ? approvePaymentOrder(orderId, "Web Admin Panel") : null;
        if (!order) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "Order not found or already processed" }));
          return;
        }

        if (bot) {
          const durationLabel = order.days <= 0 ? "👑 НАВСЕГДА" : `${order.days} дн.`;
          bot.api.sendMessage(
            Number(order.userId),
            `✧ ─── ･ ｡ﾟ☆: *. 👑 .* :☆ﾟ. ─── ✧\n` +
            `🎉 <b>УРА! ТВОЙ ПЛАТЁЖ ПОДТВЕРЖДЕН СОЗДАТЕЛЕМ!</b> ⭐️✨\n\n` +
            `Создатель бота лично проверил твой чек и активировал <b>VIP-статус (${durationLabel})</b>!\n\n` +
            `👑 <b>Твои привилегии прямо сейчас:</b>\n` +
            `• Золотая корона VIP в твоём профиле (/love) и во всех беседах\n` +
            `• Безлимитная энергия молний и решений задач\n` +
            `• Доступ ко всем 4 премиум-моделям (/model)\n` +
            `• Ответ за 0.3 секунды и приоритет №1\n\n` +
            `<i>«Добро пожаловать в сладкую жизнь, мой любимый VIP Дарлинг! 💚⚡»</i>`,
            { parse_mode: "HTML" }
          ).catch((e) => console.warn("Approve notify error:", e.message));
        }

        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: true, order }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
      return;
    }

    // Отклонить платёж по чеку
    if (pathname === "/api/admin/reject-payment" && req.method === "POST") {
      if (!checkAdminAuth(req, parsedUrl)) {
        res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: "Unauthorized" }));
        return;
      }
      try {
        const body = await parseJsonBody(req);
        const { orderId } = body;
        const order = rejectPaymentOrder ? rejectPaymentOrder(orderId, "Web Admin Panel") : null;
        if (!order) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "Order not found" }));
          return;
        }

        if (bot) {
          bot.api.sendMessage(
            Number(order.userId),
            `⚠️ <b>Оповещение по оплате:</b>\n` +
            `К сожалению, ваш чек по тарифу <b>${order.planTitle}</b> не прошел верификацию.\n` +
            `Если произошла ошибка или вы отправили не тот чек, напишите Создателю напрямую или оформите заказ заново через /vip 💕`,
            { parse_mode: "HTML" }
          ).catch(() => {});
        }

        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: true, order }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
      return;
    }

    // Получить или обновить реквизиты оплаты (админ)
    if (pathname === "/api/admin/requisites") {
      if (!checkAdminAuth(req, parsedUrl)) {
        res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: "Unauthorized" }));
        return;
      }
      if (req.method === "POST") {
        try {
          const body = await parseJsonBody(req);
          if (botSettings) {
            botSettings.requisites = { ...(botSettings.requisites || {}), ...(body.requisites || body) };
            if (saveSettings) saveSettings();
          }
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok: true, requisites: botSettings?.requisites }));
        } catch (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: err.message }));
        }
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true, requisites: botSettings?.requisites || {} }));
      return;
    }

    // Проксирование фото чека из Telegram для показа в веб-админке
    if (pathname === "/api/admin/photo") {
      if (!checkAdminAuth(req, parsedUrl)) {
        res.writeHead(401);
        res.end("Unauthorized");
        return;
      }
      const fileId = parsedUrl.searchParams.get("fileId");
      if (!fileId || !bot) {
        res.writeHead(400);
        res.end("fileId is required");
        return;
      }
      try {
        const file = await bot.api.getFile(fileId);
        const fileUrl = `https://api.telegram.org/file/bot${botToken || process.env.BOT_TOKEN}/${file.file_path}`;
        const photoRes = await fetch(fileUrl);
        const buf = await photoRes.arrayBuffer();
        res.writeHead(200, { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=3600" });
        res.end(Buffer.from(buf));
      } catch (err) {
        res.writeHead(500);
        res.end("Failed to load photo");
      }
      return;
    }

    // ==========================================
    // 🌐 СТРАНИЦЫ И ПОЛЬЗОВАТЕЛЬСКИЕ API
    // ==========================================

    // Веб Админ-панель
    if (pathname === "/admin" || pathname === "/admin.html") {
      fs.readFile(adminPath, "utf-8", (err, content) => {
        if (err) {
          res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Admin page not found");
        } else {
          res.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-cache",
          });
          res.end(content);
        }
      });
      return;
    }

    // API: Статус пользователя (VIP, энергия, любовь)
    if (pathname === "/api/user-status") {
      const userId = parsedUrl.searchParams.get("userId");
      const isVip = (isUserVip && userId) ? isUserVip(userId) : false;
      const usage = (getUserDailyUsage && userId) ? getUserDailyUsage(userId) : 0;
      const maxEnergy = (botSettings && botSettings.dailyFreeLimit) || DAILY_FREE_LIMIT || 30;
      const remainingEnergy = Math.max(0, maxEnergy - usage);

      let stats = { count: 1, loveLevel: 75, bolts: 0 };
      if (recordInteraction && userId) {
        try {
          stats = recordInteraction(userId);
        } catch (e) {}
      }

      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(
        JSON.stringify({
          ok: true,
          userId,
          isVip,
          maxEnergy,
          remainingEnergy: isVip ? 9999 : remainingEnergy,
          loveLevel: isVip ? 100 : (stats.loveLevel || 85),
          bolts: stats.bolts || 0,
          count: stats.count || 1,
          customTitle: stats.customTitle || "",
        })
      );
      return;
    }

    // API: Выполнение действия из Mini App с отправкой в чат и закрытием WebApp
    if (pathname === "/api/action") {
      const userId = parsedUrl.searchParams.get("userId");
      const text = parsedUrl.searchParams.get("text") || "";
      const userName = parsedUrl.searchParams.get("userName") || "Дарлинг";

      if (!userId || !text) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "userId and text are required" }));
        return;
      }

      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true }));

      // Асинхронно передаем обновление боту
      setImmediate(async () => {
        try {
          if (bot) {
            const entities = [];
            if (text.startsWith("/")) {
              const cmdMatch = text.match(/^\/[a-zA-Z0-9_]+/);
              if (cmdMatch) {
                entities.push({
                  type: "bot_command",
                  offset: 0,
                  length: cmdMatch[0].length,
                });
              }
            }

            await bot.handleUpdate({
              update_id: Math.floor(Math.random() * 10000000) + 1,
              message: {
                message_id: 990000000 + Math.floor(Math.random() * 1000000),
                date: Math.floor(Date.now() / 1000),
                chat: { id: Number(userId), type: "private" },
                from: { id: Number(userId), is_bot: false, first_name: userName },
                text: text,
                entities: entities.length > 0 ? entities : undefined,
              },
            });
          }
        } catch (err) {
          console.error("Ошибка обработки action из WebApp:", err.message);
        }
      });
      return;
    }

    // API: Живой поиск музыки для Mini App с превью и обложкой
    if (pathname === "/api/music-search") {
      const q = parsedUrl.searchParams.get("q") || "Macan";
      try {
        if (searchMusicTrack) {
          const track = await searchMusicTrack(q);
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok: true, track }));
          return;
        }
      } catch (err) {
        console.error("Music search API error:", err.message);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: err.message }));
        return;
      }
    }

    // API: Живые котировки валют и крипты
    if (pathname === "/api/rates") {
      try {
        if (getLiveMarketRates) {
          const data = await getLiveMarketRates();
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok: true, data }));
          return;
        }
      } catch (err) {
        console.error("Rates API error:", err.message);
      }
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false }));
      return;
    }

    // API: Живая погода
    if (pathname === "/api/weather") {
      const city = parsedUrl.searchParams.get("city") || "Бишкек";
      try {
        if (getLiveWeather) {
          const data = await getLiveWeather(city);
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok: true, data }));
          return;
        }
      } catch (err) {
        console.error("Weather API error:", err.message);
      }
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false }));
      return;
    }

    // API: Создание ссылки инвойса Telegram Stars (с обновленными тарифами)
    if (pathname === "/api/create-invoice") {
      const type = parsedUrl.searchParams.get("type") || "vip_month";

      let title = "⭐️ VIP Дарлинг (30 дней)";
      let description = "30 дней безлимита на задачи, код и золотая корона в профиле!";
      let payload = "payload_vip_month";
      let amount = 99;

      if (type === "vip_1day" || type === "tip_15" || type === "ramen_15") {
        title = "⚡ Импульс на 1 день VIP";
        description = "24 часа полного безлимита, доступ ко всем моделям и спасение контрольной!";
        payload = "payload_vip_1day";
        amount = 15;
      } else if (type === "vip_3days") {
        title = "🍓 Уикенд с Лам (3 дня VIP)";
        description = "3 дня беззаботного кайфа и отдыха с личной они-вайфу!";
        payload = "payload_vip_3days";
        amount = 29;
      } else if (type === "vip_week") {
        title = "🎒 Ударная Неделя (7 дней VIP)";
        description = "7 дней полного безлимита на задачи, код и арт-генерацию!";
        payload = "payload_vip_week";
        amount = 49;
      } else if (type === "vip_month") {
        title = "⭐️ VIP Дарлинг (30 дней)";
        description = "Сладкая жизнь на целый месяц! Выбор 92% студентов!";
        payload = "payload_vip_month";
        amount = 99;
      } else if (type === "vip_quarter") {
        title = "💎 Четверть / Семестр (90 дней VIP)";
        description = "3 месяца спокойствия и высший балл за все домашние работы со скидкой 40%!";
        payload = "payload_vip_quarter";
        amount = 199;
      } else if (type === "vip_forever") {
        title = "👑 Бог Они-Империи (Навсегда VIP)";
        description = "Вечный VIP статус, титул «Единственный Дарлинг» и вечный безлимит без подписок!";
        payload = "payload_vip_forever";
        amount = 299;
      }

      try {
        if (!bot) throw new Error("Bot API not initialized");
        const invoiceLink = await bot.api.createInvoiceLink(
          title,
          description,
          payload,
          "",
          "XTR",
          [{ label: title, amount }]
        );

        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: true, invoiceLink, title, amount }));
        return;
      } catch (err) {
        console.error("Ошибка createInvoiceLink:", err.message);
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: err.message }));
        return;
      }
    }

    // API: Публичные реквизиты для оплаты картами / СБП / MBANK
    if (pathname === "/api/requisites") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({
        ok: true,
        requisites: botSettings?.requisites || {
          bankName: "MasterCard / MBANK / ЭЛКАРТ / Сбербанк (переводы по карте и номеру)",
          cardNumber: "5302 0009 7083 9639",
          phoneNumber: "+996 (700) 00-00-00",
          recipientName: "Akilum (Создатель)",
          currency: "USD / RUB / KGS",
        },
        plans: VIP_PLANS || {},
      }));
      return;
    }

    // API: Фиксация намерения оплаты перед отправкой чека
    if (pathname === "/api/initiate-payment" && req.method === "POST") {
      try {
        const body = await parseJsonBody(req);
        const { userId, planId, currency, amount } = body;
        if (userId && planId && pendingPaymentSessions) {
          const plan = VIP_PLANS ? VIP_PLANS[planId] : null;
          pendingPaymentSessions.set(String(userId), {
            planId,
            planTitle: plan ? plan.title : planId,
            amount: amount || (plan ? (currency === "som" || currency === "mbank" ? `${plan.som} сом` : (currency === "usd" ? `$${plan.usd}` : `${plan.rub} ₽`)) : 0),
            days: plan ? plan.days : 30,
            currency: currency === "som" || currency === "mbank" ? "KGS" : (currency === "usd" ? "USD" : "RUB"),
            initiatedAt: Date.now(),
          });
        }
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
      return;
    }

    // API: Отправка чека/квитанции напрямую из WebApp с фото
    if (pathname === "/api/submit-receipt" && req.method === "POST") {
      try {
        const body = await parseJsonBody(req);
        const { userId, planId, currency, amount, imageBase64, name, username } = body;
        if (!userId) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "userId is required" }));
          return;
        }

        const plan = VIP_PLANS ? VIP_PLANS[planId] : null;
        const curLabel = currency === "som" || currency === "mbank" ? "KGS" : (currency === "usd" ? "USD" : "RUB");
        const formattedAmount = amount || (plan ? (curLabel === "KGS" ? `${plan.som} сом` : (curLabel === "USD" ? `$${plan.usd}` : `${plan.rub} ₽`)) : "VIP");

        const order = createPaymentOrder ? createPaymentOrder({
          userId,
          name: name || "Дарлинг",
          username: username || "",
          planId: planId || "vip_check",
          planTitle: plan ? plan.title : "VIP подписка",
          days: plan ? plan.days : 30,
          amount: formattedAmount,
          currency: curLabel,
          photoFileId: null,
        }) : null;

        if (!order) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "Failed to create payment order" }));
          return;
        }

        if (pendingPaymentSessions) {
          pendingPaymentSessions.delete(String(userId));
          pendingPaymentSessions.delete(Number(userId));
        }

        // Если прикреплен скриншот в Base64 — отправляем в Telegram админам
        if (imageBase64 && bot) {
          try {
            const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, "");
            const imgBuffer = Buffer.from(cleanBase64, "base64");
            const durationLabel = order.days <= 0 ? "НАВСЕГДА 👑" : `${order.days} дн.`;
            const adminMsgText =
              `🔔 <b>НОВЫЙ ЧЕК ИЗ ПРИЛОЖЕНИЯ!</b> 🧾💰\n\n` +
              `👤 <b>От:</b> ${escapeHtml(order.name)} (@${order.username || "нет_юзернейма"})\n` +
              `🆔 <b>User ID:</b> <code>${order.userId}</code>\n` +
              `💎 <b>Тариф:</b> <b>${order.planTitle}</b> (${durationLabel})\n` +
              `💵 <b>Сумма:</b> <code>${order.amount}</code>\n` +
              `🕒 <b>Время:</b> <code>${new Date().toLocaleTimeString("ru-RU")}</code>\n\n` +
              `<i>Проверь квитанцию и нажми кнопку ниже:</i>`;

            const adminNotificationKb = new InlineKeyboard()
              .text("✅ Подтвердить VIP", `pay_approve:${order.id}`)
              .text("❌ Отклонить", `pay_reject:${order.id}`);

            const tgAdmins = adminIds ? Array.from(adminIds) : [];
            for (const admId of tgAdmins) {
              try {
                const sentMsg = await bot.api.sendPhoto(admId, new InputFile(imgBuffer, "receipt.jpg"), {
                  caption: adminMsgText,
                  parse_mode: "HTML",
                  reply_markup: adminNotificationKb,
                });
                if (sentMsg.photo && sentMsg.photo.length > 0) {
                  order.photoFileId = sentMsg.photo[sentMsg.photo.length - 1].file_id;
                }
              } catch (err) {
                console.error("sendPhoto to admin error:", err.message);
              }
            }
          } catch (imgErr) {
            console.error("Receipt image process error:", imgErr.message);
          }
        }

        // Отправка личного сообщения в бот пользователю
        if (bot) {
          bot.api.sendMessage(
            Number(order.userId),
            `✧ ─── ･ ｡ﾟ☆: *. 🧾 .* :☆ﾟ. ─── ✧\n` +
            `✅ <b>ЧЕК УСПЕШНО ПРИНЯТ НА ПРОВЕРКУ!</b> 💚✨\n\n` +
            `• Тариф: <b>${order.planTitle}</b>\n` +
            `• Сумма: <code>${order.amount}</code>\n` +
            `• Номер заявки: <code>#${order.id}</code>\n\n` +
            `Лам уже передала твой чек Создателю на подтверждение. Проверка обычно занимает <b>1–5 минут</b>.\n` +
            `Как только Создатель подтвердит — корона VIP и безлимит включатся мгновенно! 👑⚡`,
            { parse_mode: "HTML" }
          ).catch(() => {});
        }

        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: true, orderId: order.id }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
      return;
    }

    // API: Список доступных нейро-моделей
    if (pathname === "/api/models") {
      const userId = parsedUrl.searchParams.get("userId");
      const currentModel = (getUserModel && userId) ? getUserModel(userId) : "turbo";
      const isVip = (isUserVip && userId) ? isUserVip(userId) : false;
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true, models: AI_MODELS || {}, currentModel, isVip }));
      return;
    }

    // API: Переключение модели пользователем
    if (pathname === "/api/set-model" && req.method === "POST") {
      try {
        const body = await parseJsonBody(req);
        const { userId, modelKey } = body;
        if (!userId || !modelKey) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "userId and modelKey are required" }));
          return;
        }

        const isVip = (isUserVip && userId) ? isUserVip(userId) : false;
        if (!isVip) {
          res.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok: false, error: "Выбор моделей доступен только владельцам VIP-статуса!" }));
          return;
        }

        if (setUserModel) {
          setUserModel(userId, modelKey);
        }
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: true, currentModel: modelKey }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
      return;
    }

    // Главная страница Mini App
    if (pathname === "/" || pathname === "/index.html") {
      fs.readFile(indexPath, "utf-8", (err, content) => {
        if (err) {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end("<h1>Akilum Bot is Running!</h1>");
        } else {
          res.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-cache",
          });
          res.end(content);
        }
      });
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not Found");
  });

  server.listen(port, "0.0.0.0", () => {
    console.log(`🌐 [WebApp] Сервер Telegram Mini App & Admin Panel запущен на 0.0.0.0:${port}`);
  });

  return server;
}

module.exports = { startWebAppServer };