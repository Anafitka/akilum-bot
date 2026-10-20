/**
 * web_search.js — Живой интернет-радар в реальном времени через DuckDuckGo
 */

async function fetchLiveSearchResults(query) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });
    const html = await res.text();
    const titleMatches = [
      ...html.matchAll(
        /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
      ),
    ];
    const snippetMatches = [
      ...html.matchAll(
        /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi
      ),
    ];

    const results = [];
    const count = Math.min(titleMatches.length, snippetMatches.length, 5);

    for (let i = 0; i < count; i++) {
      const rawLink = titleMatches[i][1];
      let actualUrl = rawLink;
      const uddg = rawLink.match(/uddg=([^&]+)/);
      if (uddg) {
        try {
          actualUrl = decodeURIComponent(uddg[1]);
        } catch {
          actualUrl = rawLink;
        }
      }
      const title = titleMatches[i][2].replace(/<[^>]+>/g, "").trim();
      const snippet = snippetMatches[i][1].replace(/<[^>]+>/g, "").trim();

      if (snippet && title) {
        results.push({
          title,
          url: actualUrl,
          snippet,
        });
      }
    }

    return results;
  } catch (e) {
    console.error("[WebSearch] Ошибка поиска:", e.message);
    return [];
  }
}

module.exports = { fetchLiveSearchResults };
