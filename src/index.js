// src/index.js
// 総合・社会・政治・経済・ビジネスに特化したフィード構成
const RSS_URLS = [
  // --- 総合・社会・国際・政治（NHK） ---
  "https://www.nhk.or.jp/rss/news/cat0.xml",           // NHK 主要
  "https://www.nhk.or.jp/rss/news/cat1.xml",           // NHK 社会
  "https://www.nhk.or.jp/rss/news/cat4.xml",           // NHK 政治
  "https://www.nhk.or.jp/rss/news/cat5.xml",           // NHK 経済・ビジネス
  "https://www.nhk.or.jp/rss/news/cat6.xml",           // NHK 国際

  // --- 経済・ビジネス・オピニオン深掘り ---
  "https://toyokeizai.net/list/feed/rss",              // 東洋経済オンライン
  "https://diamond.jp/list/feed/rss",                 // ダイヤモンド・オンライン
  "https://agora-web.jp/feed",                         // アゴラ 言論プラットフォーム

  // --- 大手通信社・国際速報 ---
  "https://jp.reuters.com/rssFeed/topNews/",            // ロイター 総合トップニュース
  "https://jp.reuters.com/rssFeed/businessNews/",       // ロイター 経済・ビジネス
  "https://feeds.bbci.co.uk/japanese/rss.xml",         // BBC News Japan

  // --- 大手テレビ・ポータル総合（要約が充実しているもの） ---
  "https://newsdig.tbs.co.jp/list/feed/rss",           // TBS NEWS DIG
  "https://news.biglobe.ne.jp/news_rss.xml",           // BIGLOBE 総合
  "https://www.excite.co.jp/rss/news_editor.xml",       // excite 編集部セレクト

  // --- 地域ニュース ---
  "https://www.niigata-nippo.co.jp/list/feed/rss",     // 新潟日報
];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/news") {
      if (request.method === "OPTIONS") return handleOptions();
      return handleNews();
    }

    return env.ASSETS.fetch(request);
  },
};

async function handleNews() {
  try {
    const fetchPromises = RSS_URLS.map(async (rssUrl) => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3500);

        const res = await fetch(rssUrl, {
          signal: controller.signal,
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; NewsSwipeBot/1.0)",
            Accept: "application/rss+xml, application/xml, text/xml, */*",
          },
          cf: { cacheTtl: 300, cacheEverything: true },
        });
        clearTimeout(timeoutId);

        if (!res.ok) return [];
        const xml = await res.text();
        return parseRss(xml);
      } catch {
        return [];
      }
    });

    const results = await Promise.all(fetchPromises);
    const flattened = results.flat();

    const seenLinks = new Set();
    const seenTitles = new Set();
    const uniqueArticles = [];

    for (const article of flattened) {
      const titleKey = article.title.replace(/\s+/g, "").slice(0, 15);
      if (!seenLinks.has(article.link) && !seenTitles.has(titleKey)) {
        seenLinks.add(article.link);
        seenTitles.add(titleKey);
        uniqueArticles.push(article);
      }
    }

    uniqueArticles.sort(() => Math.random() - 0.5);

    return jsonResponse({ articles: uniqueArticles, fetchedAt: new Date().toISOString() }, 200, {
      "Cache-Control": "s-maxage=180, stale-while-revalidate=360",
    });
  } catch (err) {
    return jsonResponse({ error: `Failed to fetch news: ${err.message}` }, 500);
  }
}

function handleOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      ...extraHeaders,
    },
  });
}

function parseRss(xml) {
  const items = [];
  const itemRegex = /<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[2];

    const title = decodeEntities(stripTags(extractTag(block, "title")));

    const rawContent = extractTag(block, "content:encoded")
                  || extractTag(block, "content")
                  || extractTag(block, "description")
                  || extractTag(block, "dc:description")
                  || extractTag(block, "summary");

    const description = decodeEntities(stripTags(rawContent)).trim();

    // 本文が空、あるいは極端に短いものは除外
    if (!description || description.length < 15) {
      continue;
    }

    const imageUrl = extractImageUrl(block, rawContent);

    let link = extractTag(block, "link");
    if (!link || link.includes("<")) {
      const linkHrefMatch = /<link\b[^>]*href=["']([^"']+)["']/i.exec(block);
      if (linkHrefMatch) link = linkHrefMatch[1];
    }
    link = decodeEntities(stripTags(link)).trim();

    const pubDateRaw = decodeEntities(stripTags(
      extractTag(block, "pubDate") || extractTag(block, "published") || extractTag(block, "updated") || extractTag(block, "dc:date")
    )).trim();
    const pubDate = normalizeDate(pubDateRaw);

    if (title && link) {
      items.push({
        title: title.trim(),
        description,
        link,
        pubDate,
        imageUrl: imageUrl || null,
      });
    }
  }

  return items;
}

function extractImageUrl(block, rawContent) {
  const enclosureMatch = /<enclosure\b[^>]*url=["']([^"']+\.(?:jpe?g|png|webp|gif)[^"']*)["']/i.exec(block);
  if (enclosureMatch) return enclosureMatch[1];

  const mediaMatch = /<media:(?:content|thumbnail)\b[^>]*url=["']([^"']+)["']/i.exec(block);
  if (mediaMatch) return mediaMatch[1];

  const imgMatch = /<img\b[^>]*src=["']([^"']+)["']/i.exec(rawContent || "");
  if (imgMatch && !imgMatch[1].includes("tracking") && !imgMatch[1].includes("beacon") && !imgMatch[1].includes("pixel")) {
    return imgMatch[1];
  }

  return null;
}

function extractTag(block, tagName) {
  const escapedTagName = tagName.replace(":", "\\:");
  const re = new RegExp(`<${escapedTagName}\\b[^>]*>([\\s\\S]*?)<\\/${escapedTagName}>`, "i");
  const m = re.exec(block);
  if (!m) return "";
  let content = m[1];
  const cdataMatch = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(content);
  return cdataMatch ? cdataMatch[1] : content;
}

function stripTags(str) {
  if (!str) return "";
  return str
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ");
}

function decodeEntities(str) {
  return str
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function normalizeDate(raw) {
  if (!raw) return "";
  const d = new Date(raw);
  return isNaN(d.getTime()) ? raw : d.toISOString();
}
