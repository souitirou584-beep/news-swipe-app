// src/index.js
// Single Cloudflare Worker: serves the static frontend (via the "assets"
// binding) AND handles /api/news server-side, so there's no separate
// "Pages Functions" concept involved at all — just one Worker.

const RSS_URL = "https://news.yahoo.co.jp/rss/topics/top-picks.xml";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/news") {
      if (request.method === "OPTIONS") return handleOptions();
      return handleNews();
    }

    // Everything else falls through to the static assets (public/ folder).
    return env.ASSETS.fetch(request);
  },
};

async function handleNews() {
  try {
    const rssResponse = await fetch(RSS_URL, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; NewsSwipeBot/1.0; +https://workers.dev)",
        Accept: "application/rss+xml, application/xml, text/xml, */*",
      },
      cf: {
        cacheTtl: 300,
        cacheEverything: true,
      },
    });

    if (!rssResponse.ok) {
      return jsonResponse(
        { error: `Upstream RSS fetch failed with status ${rssResponse.status}` },
        502
      );
    }

    const xmlText = await rssResponse.text();
    const articles = parseRss(xmlText);

    return jsonResponse({ articles, fetchedAt: new Date().toISOString() }, 200, {
      "Cache-Control": "s-maxage=300, stale-while-revalidate=600",
    });
  } catch (err) {
    return jsonResponse({ error: `Failed to fetch or parse RSS: ${err.message}` }, 500);
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

// --- Minimal, dependency-free RSS/XML item parser -------------------------
// The Workers runtime has no DOM parser, so we extract <item>...</item>
// blocks and their child tags with regular expressions. This is intentionally
// lightweight rather than a full XML parser.

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
      items.push({ title: title.trim(), description, link, pubDate });
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
