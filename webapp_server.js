const http = require("http");
const fs = require("fs");
const path = require("path");

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2e6) {
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

    // Выдать VIP пользователю
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
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "userId is required" }));
          return;
        }

        if (setUserVip) {
          const numDays = parseInt(days) || 30;
          setUserVip(userId, numDays, stars || 0, "Дарлинг", "");

          // Оповещаем пользователя в Telegram
          if (bot) {
            const daysText = numDays === -1 ? "Навсегда (Forever)" : `${numDays} дней`;
            bot.api.sendMessage(
              Number(userId),
              `🎉 <b>СЮРПРИЗ ОТ СОЗДАТЕЛЯ БОТА!</b> 👑⭐️✨\n\n` +
              `Тебе выдан статус <b>VIP Дарлинга</b> на <b>${daysText}</b>!\n\n` +
              `• Полный безлимит на задачи, код и арт-генерацию\n` +
              `• Золотая корона в твоём профиле (/love)\n` +
              `• Высший приоритет от они-принцессы Лам! 💕`,
              { parse_mode: "HTML" }
            ).catch((e) => console.warn("Notify user error:", e.message));
          }
        }
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
      return;
    }

    // Снять VIP у пользователя
    if (pathname === "/api/admin/take-vip" && req.method === "POST") {
      if (!checkAdminAuth(req, parsedUrl)) {
        res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: "Unauthorized" }));
        return;
      }
      try {
        const body = await parseJsonBody(req);
        const { userId } = body;
        if (removeUserVip) {
          removeUserVip(userId);
        }
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
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

      let title = "⭐️ VIP Дарлинг (1 месяц)";
      let description = "30 дней безлимита на задачи, код и золотая корона в профиле!";
      let payload = "payload_vip_month";
      let amount = 75;

      if (type === "vip_forever") {
        title = "👑 Навсегда VIP Дарлинг";
        description = "Вечный VIP статус, титул «Единственный Дарлинг» и бесконечные молнии без подписки!";
        payload = "payload_vip_forever";
        amount = 199; // Выгодная цена со скидкой!
      } else if (type === "vip_week") {
        title = "⚡ VIP Дарлинг (1 неделя)";
        description = "7 дней полного безлимита на задачи, код и арт-генерацию!";
        payload = "payload_vip_week";
        amount = 25;
      } else if (type === "tip_15" || type === "ramen_15") {
        title = "🍜 Рамен с чили для Лам";
        description = "Угости они-принцессу любимым горячим блюдом (+100к Вольт любви и мгновенная энергия)!";
        payload = "payload_tip_15";
        amount = 15;
      } else if (type === "tip_25") {
        title = "🍓 Клубничное молоко для Лам";
        description = "Угости они-принцессу любимым напитком (+100к Вольт любви)!";
        payload = "payload_tip_25";
        amount = 25;
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