const http = require("http");
const fs = require("fs");
const path = require("path");

function startWebAppServer(port = Number(process.env.PORT) || 3000, context = {}) {
  const { bot, isUserVip, getUserDailyUsage, DAILY_FREE_LIMIT, recordInteraction } = context;
  const indexPath = path.join(__dirname, "public", "index.html");

  const server = http.createServer(async (req, res) => {
    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

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

    // API: Статус пользователя (VIP, энергия, любовь)
    if (pathname === "/api/user-status") {
      const userId = parsedUrl.searchParams.get("userId");
      const isVip = (isUserVip && userId) ? isUserVip(userId) : false;
      const usage = (getUserDailyUsage && userId) ? getUserDailyUsage(userId) : 0;
      const maxEnergy = DAILY_FREE_LIMIT || 20;
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
          loveLevel: stats.loveLevel || 85,
          bolts: stats.bolts || 0,
          count: stats.count || 1,
        })
      );
      return;
    }

    // API: Создание ссылки инвойса Telegram Stars для оплаты прямо в Mini App
    if (pathname === "/api/create-invoice") {
      const type = parsedUrl.searchParams.get("type") || "vip_month";

      let title = "👑 VIP Дарлинг (1 месяц)";
      let description = "30 дней безлимита на задачи, код и золотая корона в профиле!";
      let payload = "payload_vip_month";
      let amount = 75;

      if (type === "vip_forever") {
        title = "👑 Навсегда VIP Дарлинг";
        description = "Вечный VIP статус и бесконечные молнии без подписки!";
        payload = "payload_vip_forever";
        amount = 250;
      } else if (type === "tip_25") {
        title = "🍓 Клубничное молоко для Лам";
        description = "Угости они-принцессу любимым напитком (+100к Вольт любви)!";
        payload = "payload_tip_25";
        amount = 25;
      } else if (type === "energy_50") {
        title = "⚡ +50 Зарядов энергии";
        description = "Пакет дополнительных молний без оформления подписки!";
        payload = "payload_energy_50";
        amount = 15;
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
    console.log(`🌐 [WebApp] Сервер Telegram Mini App запущен на 0.0.0.0:${port}`);
  });

  return server;
}

module.exports = { startWebAppServer };
