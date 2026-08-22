// src/index.js
// 全文（content:encoded）配信を行っているメディアを含むRSSリスト
const RSS_URLS = [
  "https://gigazine.net/news/rss_2.0/",                   // GIGAZINE（長文・全文配信）
  "https://www.publickey1.jp/atom.xml",                   // Publickey（IT・開発系、全文配信）
  "https://b.hatena.ne.jp/hotentry/it.rss",               // はてなブックマーク（IT人気記事）
  "https://rss.itmedia.co.jp/rss/2.0/news_bursts.xml",    // ITmedia
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
  // RSS <item> または Atom <entry> に対応
  const itemRegex = /<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[2];

    const title = decodeEntities(stripTags(extractTag(block, "title")));
    
    // 【重要】全文タグ (content:encoded / content) を最優先で取得し、無ければ description / summary を使用
    let rawContent = extractTag(block, "content:encoded") 
                  || extractTag(block, "content") 
                  || extractTag(block, "description") 
                  || extractTag(block, "summary");

    // HTMLタグや改行をクリーンアップして本文テキスト化
    const description = decodeEntities(stripTags(rawContent)).trim();

    // linkタグの抽出（RSS形式とAtom形式の両方に対応）
    let link = extractTag(block, "link");
    if (!link || link.includes("<")) {
      const linkHrefMatch = /<link\b[^>]*href=["']([^"']+)["']/i.exec(block);
      if (linkHrefMatch) link = linkHrefMatch[1];
    }
    link = decodeEntities(stripTags(link)).trim();

    const pubDateRaw = decodeEntities(stripTags(
      extractTag(block, "pubDate") || extractTag(block, "published") || extractTag(block, "updated")
    )).trim();
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
  // ネームスペース付きタグにもマッチする正規表現
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
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "") // scriptタグ除去
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")   // styleタグ除去
    .replace(/<[^>]*>/g, " ")                                          // 全HTMLタグ除去
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ");                                             // 連続空白を1つに統合
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
