const http = require("http");
const fs = require("fs");
const path = require("path");

function startWebAppServer(port = Number(process.env.PORT) || 3000) {
  const indexPath = path.join(__dirname, "public", "index.html");

  const server = http.createServer((req, res) => {
    // Поддержка HEAD и ping для UptimeRobot и health-чеков
    if (req.method === "HEAD") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end();
      return;
    }

    if (req.url === "/health" || req.url === "/ping") {
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("OK");
      return;
    }

    if (req.url === "/" || req.url === "/index.html" || req.url.startsWith("/?")) {
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
    } else {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not Found");
    }
  });

  server.listen(port, "0.0.0.0", () => {
    console.log(`🌐 [WebApp] Киберпанк-терминал Лам запущен на 0.0.0.0:${port}`);
  });

  return server;
}

module.exports = { startWebAppServer };
