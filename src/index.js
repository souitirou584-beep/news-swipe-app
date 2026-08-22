// src/index.js
// 複数の主要カテゴリRSSを並列取得して結合する
const RSS_URLS = [
  "https://www.nhk.or.jp/rss/news/cat0.xml", // 主要
  "https://www.nhk.or.jp/rss/news/cat1.xml", // 社会
  "https://www.nhk.or.jp/rss/news/cat3.xml", // 科学・文化
  "https://www.nhk.or.jp/rss/news/cat4.xml", // 政治
  "https://www.nhk.or.jp/rss/news/cat5.xml", // 経済
  "https://www.nhk.or.jp/rss/news/cat6.xml", // 国際
  "https://www.nhk.or.jp/rss/news/cat7.xml", // スポーツ
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
    // 複数URLを並列でフェッチ
    const fetchPromises = RSS_URLS.map(async (rssUrl) => {
      try {
        const res = await fetch(rssUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; NewsSwipeBot/1.0)",
            Accept: "application/rss+xml, application/xml, text/xml, */*",
          },
          cf: { cacheTtl: 300, cacheEverything: true },
        });
        if (!res.ok) return [];
        const xml = await res.text();
        return parseRss(xml);
      } catch {
        return [];
      }
    });

    const results = await Promise.all(fetchPromises);
    const flattened = results.flat();

    // 重複記事（同じURL）を除外し、日付順（新しい順）にソート
    const seenLinks = new Set();
    const uniqueArticles = [];

    for (const article of flattened) {
      if (!seenLinks.has(article.link)) {
        seenLinks.add(article.link);
        uniqueArticles.push(article);
      }
    }

    uniqueArticles.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

    return jsonResponse({ articles: uniqueArticles, fetchedAt: new Date().toISOString() }, 200, {
      "Cache-Control": "s-maxage=300, stale-while-revalidate=600",
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
  const itemRegex = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];

    const title = decodeEntities(stripTags(extractTag(block, "title")));
    const rawDescription = extractTag(block, "description");
    const description = decodeEntities(stripTags(rawDescription)).trim();
    const link = decodeEntities(stripTags(extractTag(block, "link"))).trim();
    const pubDateRaw = decodeEntities(stripTags(extractTag(block, "pubDate"))).trim();
    const pubDate = normalizeDate(pubDateRaw);

    if (title && link) {
      items.push({
        title: title.trim(),
        description: description || "（詳細情報は元記事をご確認ください）",
        link,
        pubDate,
      });
    }
  }

  return items;
}

function extractTag(block, tagName) {
  const re = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i");
  const m = re.exec(block);
  if (!m) return "";
  let content = m[1];
  const cdataMatch = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(content);
  return cdataMatch ? cdataMatch[1] : content;
}

function stripTags(str) {
  return str.replace(/<[^>]*>/g, "");
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
