// src/index.js
const RSS_URLS = [
  "https://news.google.com/rss?hl=ja&gl=JP&ceid=JP:ja",
  "https://news.livedoor.com/topics/rss/top.xml",
  "https://news.livedoor.com/topics/rss/dom.xml",
  "https://news.livedoor.com/topics/rss/trend.xml",
  "https://news.biglobe.ne.jp/news_rss.xml",
  "https://www.excite.co.jp/rss/news_editor.xml",
  "https://news.goo.ne.jp/rss/index.rdf",
  "https://jp.reuters.com/rssFeed/topNews/",
  "https://feeds.bbci.co.uk/japanese/rss.xml",
  "https://feeds.feedburner.com/cnn-co-jp",
  "https://newsdig.tbs.co.jp/list/feed/rss",
  "https://www.nhk.or.jp/rss/news/cat0.xml",
  "https://www.nhk.or.jp/rss/news/cat1.xml",
  "https://toyokeizai.net/list/feed/rss",
  "https://diamond.jp/list/feed/rss",
  "https://prtimes.jp/index.rdf",
  "https://gigazine.net/news/rss_2.0/",
  "https://www.lifehacker.jp/feed/index.xml",
  "https://omocoro.jp/feed/",
  "https://dailyportalz.jp/feed/headline",
  "https://natalie.mu/all/feed/news",
  "https://sorae.info/feed",
  "https://nazology.kusuguru.co.jp/feed/",
  "https://www.roomie.jp/feed/",
  "https://www.niigata-nippo.co.jp/list/feed/rss"
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
                  || extractTag(block, "summary");

    const description = decodeEntities(stripTags(rawContent)).trim();

    // 画像URLの抽出（enclosure / media:content / media:thumbnail / <img> タグ）
    let imageUrl = extractImageUrl(block, rawContent);

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
        imageUrl: imageUrl || null,
      });
    }
  }

  return items;
}

function extractImageUrl(block, rawContent) {
  // 1. enclosure タグ
  const enclosureMatch = /<enclosure\b[^>]*url=["']([^"']+\.(?:jpe?g|png|webp|gif)[^"']*)["']/i.exec(block);
  if (enclosureMatch) return enclosureMatch[1];

  // 2. media:content / media:thumbnail
  const mediaMatch = /<media:(?:content|thumbnail)\b[^>]*url=["']([^"']+)["']/i.exec(block);
  if (mediaMatch) return mediaMatch[1];

  // 3. 本文中の img タグ
  const imgMatch = /<img\b[^>]*src=["']([^"']+)["']/i.exec(rawContent || "");
  if (imgMatch && !imgMatch[1].includes("tracking") && !imgMatch[1].includes("beacon")) {
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
