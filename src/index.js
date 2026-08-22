// src/index.js
// 多彩なジャンル（総合、社会、生活、エンタメ、ビジネス、テック等）を大量に網羅
const RSS_URLS = [
  // --- ポータル・総合速報（大幅拡充） ---
  "https://news.google.com/rss?hl=ja&gl=JP&ceid=JP:ja", // Googleニュース 主要
  "https://news.livedoor.com/topics/rss/top.xml",       // ライブドア 主要
  "https://news.livedoor.com/topics/rss/dom.xml",       // ライブドア 国内
  "https://news.livedoor.com/topics/rss/trend.xml",     // ライブドア トレンド
  "https://news.biglobe.ne.jp/news_rss.xml",           // BIGLOBE
  "https://www.excite.co.jp/rss/news_editor.xml",       // excite
  "https://news.goo.ne.jp/rss/index.rdf",               // goo
  "https://jp.reuters.com/rssFeed/topNews/",            // ロイター（国際・経済速報）
  "https://feeds.bbci.co.uk/japanese/rss.xml",         // BBC News Japan
  "https://feeds.feedburner.com/cnn-co-jp",             // CNN Japan
  "https://newsdig.tbs.co.jp/list/feed/rss",           // TBS NEWS DIG
  "https://www.nhk.or.jp/rss/news/cat0.xml",           // NHK 主要
  "https://www.nhk.or.jp/rss/news/cat1.xml",           // NHK 社会

  // --- 経済・ビジネス・トレンド ---
  "https://toyokeizai.net/list/feed/rss",              // 東洋経済
  "https://diamond.jp/list/feed/rss",                 // ダイヤモンド
  "https://prtimes.jp/index.rdf",                     // PR TIMES

  // --- カルチャー・読み物・ライフスタイル ---
  "https://gigazine.net/news/rss_2.0/",               // GIGAZINE
  "https://www.lifehacker.jp/feed/index.xml",         // ライフハッカー
  "https://omocoro.jp/feed/",                         // オモコロ
  "https://dailyportalz.jp/feed/headline",            // デイリーポータルZ
  "https://nazology.kusuguru.co.jp/feed/",             // ナゾロジー
  "https://natalie.mu/all/feed/news",                 // ナタリー

  // 科学・テクノロジー・生活
  "https://nazology.kusuguru.co.jp/feed/",             // ナゾロジー
  "https://sorae.info/feed",                          // sorae
  "https://gigazine.net/news/rss_2.0/",               // GIGAZINE
  "https://www.lifehacker.jp/feed/index.xml",         // ライフハッカー
  "https://www.roomie.jp/feed/",                      // ROOMIE

  // 地域ニュース
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
    // 全URLを並列でフェッチ（エラーや遅延が起きても他のフィードを落とさない設計）
    const fetchPromises = RSS_URLS.map(async (rssUrl) => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000); // 4秒タイムアウト

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

    // 重複除去（URLベース）
    const seenLinks = new Set();
    const uniqueArticles = [];

    for (const article of flattened) {
      if (!seenLinks.has(article.link)) {
        seenLinks.add(article.link);
        uniqueArticles.push(article);
      }
    }

    // 最新日付順にソート
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
  // RSS <item> または Atom <entry> にマッチ
  const itemRegex = /<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[2];

    const title = decodeEntities(stripTags(extractTag(block, "title")));
    
    // 【判定ロジック】
    // 全文タグ (content:encoded / content) を最優先で探し、無ければ description / summary を使用
    let rawContent = extractTag(block, "content:encoded") 
                  || extractTag(block, "content") 
                  || extractTag(block, "description") 
                  || extractTag(block, "summary");

    const description = decodeEntities(stripTags(rawContent)).trim();

    // リンク抽出（RSS形式・Atom形式の両対応）
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
