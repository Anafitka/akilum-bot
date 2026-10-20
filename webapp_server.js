const http = require("http");
const fs = require("fs");
const path = require("path");

function startWebAppServer(port = process.env.PORT || 3000) {
  const indexPath = path.join(__dirname, "public", "index.html");

  const server = http.createServer((req, res) => {
    if (req.url === "/" || req.url === "/index.html" || req.url.startsWith("/?")) {
      fs.readFile(indexPath, "utf-8", (err, content) => {
        if (err) {
          res.writeHead(500, { "Content-Type": "text/plain" });
          res.end("Error loading WebApp");
        } else {
          res.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-cache",
          });
          res.end(content);
        }
      });
    } else {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
    }
  });

  server.listen(port, () => {
    console.log(`🌐 [WebApp] Киберпанк-терминал Лам запущен на порту ${port}`);
  });

  return server;
}

module.exports = { startWebAppServer };
