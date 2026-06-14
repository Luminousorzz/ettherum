import { Hono } from "hono";
import { db } from "../db/index";
import { proxyPool } from "../db/schema";
import { eq, desc, sql, inArray } from "drizzle-orm";
import {
  getNextProxy,
  markProxySuccess,
  markProxyFail,
  checkProxyHealth,
  invalidateProxyCache,
} from "../services/proxy-pool";
import {
  scrapeProxies,
  verifyProxies,
  COUNTRIES,
  type ScrapeSource,
  type ScrapeProtocol,
} from "../services/proxy-scraper";

export const proxyPoolRouter = new Hono();

proxyPoolRouter.get("/pool", async (c) => {
  const proxies = await db
    .select()
    .from(proxyPool)
    .orderBy(desc(proxyPool.createdAt));

  return c.json({
    count: proxies.length,
    activeCount: proxies.filter((p) => p.status === "active").length,
    proxies,
  });
});

proxyPoolRouter.post("/pool", async (c) => {
  const body = await c.req.json<{ proxies: string[] }>();
  if (!Array.isArray(body.proxies) || body.proxies.length === 0) {
    return c.json({ error: "proxies must be a non-empty array of URLs" }, 400);
  }

  let added = 0;
  for (const url of body.proxies) {
    const trimmed = url.trim();
    if (!trimmed) continue;

    const type = trimmed.startsWith("socks5://") ? "socks5" : "http";
    const label = new URL(trimmed).hostname || trimmed;

    await db.insert(proxyPool).values({ url: trimmed, type, label });
    added++;
  }

  invalidateProxyCache();
  return c.json({ added });
});

proxyPoolRouter.put("/pool/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json<{ status?: string; label?: string }>();

  const updates: Record<string, any> = { updatedAt: new Date() };
  if (body.status) updates.status = body.status;
  if (body.label !== undefined) updates.label = body.label;

  await db.update(proxyPool).set(updates).where(eq(proxyPool.id, id));
  invalidateProxyCache();

  return c.json({ success: true });
});

proxyPoolRouter.delete("/pool/:id", async (c) => {
  const id = Number(c.req.param("id"));
  await db.delete(proxyPool).where(eq(proxyPool.id, id));
  invalidateProxyCache();
  return c.json({ success: true });
});

proxyPoolRouter.delete("/pool", async (c) => {
  await db.delete(proxyPool);
  invalidateProxyCache();
  return c.json({ success: true });
});

proxyPoolRouter.post("/pool/:id/check", async (c) => {
  const id = Number(c.req.param("id"));
  const [proxy] = await db.select().from(proxyPool).where(eq(proxyPool.id, id));
  if (!proxy) return c.json({ error: "Proxy not found" }, 404);

  const result = await checkProxyHealth(proxy.url);

  await db
    .update(proxyPool)
    .set({
      status: result.ok ? "active" : "error",
      errorMessage: result.error || null,
      latencyMs: result.latencyMs,
      lastCheckedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(proxyPool.id, id));

  invalidateProxyCache();
  return c.json({ id, ...result });
});

proxyPoolRouter.post("/pool/check-all", async (c) => {
  const proxies = await db
    .select()
    .from(proxyPool)
    .where(inArray(proxyPool.status, ["active", "error"]));

  if (proxies.length === 0) {
    return c.json({ checked: 0, results: [] });
  }

  const concurrency = 10; // Max 10 parallel checks to prevent STB CPU overload & Webshare rate limits
  let cursor = 0;
  const results: any[] = [];

  async function worker() {
    while (cursor < proxies.length) {
      const idx = cursor++;
      const proxy = proxies[idx];
      if (!proxy) break;

      const result = await checkProxyHealth(proxy.url);
      await db
        .update(proxyPool)
        .set({
          status: result.ok ? "active" : "error",
          errorMessage: result.error || null,
          latencyMs: result.latencyMs,
          lastCheckedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(proxyPool.id, proxy.id));

      results.push({ id: proxy.id, url: proxy.url, ...result });
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, proxies.length) }, worker);
  await Promise.all(workers);

  invalidateProxyCache();
  return c.json({
    checked: proxies.length,
    results,
  });
});

// List the regions available for scraping (for the dashboard dropdown).
proxyPoolRouter.get("/scrape/countries", (c) => {
  return c.json({ countries: COUNTRIES });
});

// Scrape proxies from free sources, optionally filtered by region/protocol,
// optionally health-verified, then add the survivors to the pool.
proxyPoolRouter.post("/scrape", async (c) => {
  const body = await c.req.json<{
    source?: ScrapeSource;
    country?: string;
    protocol?: ScrapeProtocol;
    limit?: number;
    verify?: boolean;
  }>().catch(() => ({} as Record<string, never>));

  const source = (body.source ?? "all") as ScrapeSource;
  const country = body.country ?? "all";
  const protocol = (body.protocol ?? "all") as ScrapeProtocol;
  const limit = Math.min(Math.max(Number(body.limit) || 100, 1), 500);
  const verify = body.verify !== false; // verify by default

  let scraped = await scrapeProxies({ source, country, protocol, limit });
  const scrapedCount = scraped.length;

  if (scrapedCount === 0) {
    return c.json({ scraped: 0, verified: 0, added: 0, skipped: 0, proxies: [] });
  }

  // Health-check before adding so the pool only gets working proxies.
  let verifiedCount = scrapedCount;
  if (verify) {
    scraped = await verifyProxies(scraped);
    verifiedCount = scraped.length;
  }

  // Skip proxies already in the pool (dedupe by URL).
  const urls = scraped.map((p) => p.url);
  const existing =
    urls.length > 0
      ? await db
          .select({ url: proxyPool.url })
          .from(proxyPool)
          .where(inArray(proxyPool.url, urls))
      : [];
  const existingSet = new Set(existing.map((e) => e.url));

  const toInsert = scraped.filter((p) => !existingSet.has(p.url));
  if (toInsert.length > 0) {
    await db.insert(proxyPool).values(
      toInsert.map((p) => ({
        url: p.url,
        type: p.type,
        label: p.country ? `scraped:${p.country}` : "scraped",
      })),
    );
    invalidateProxyCache();
  }

  return c.json({
    scraped: scrapedCount,
    verified: verifiedCount,
    added: toInsert.length,
    skipped: verifiedCount - toInsert.length,
  });
});

function parseProxyLine(line: string, defaultProtocol: "http" | "socks5" = "http"): string | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//")) return null;

  // If already has a full protocol scheme
  if (/^(https?|socks[45]):\/\//i.test(trimmed)) {
    return trimmed;
  }

  // Parse ip:port:username:password or ip:port
  const parts = trimmed.split(":");
  if (parts.length === 4) {
    const [ip, port, user, pass] = parts;
    return `${defaultProtocol}://${user}:${pass}@${ip}:${port}`;
  } else if (parts.length === 2) {
    const [ip, port] = parts;
    return `${defaultProtocol}://${ip}:${port}`;
  }

  // Fallback if line contains both '@' and ':'
  if (trimmed.includes("@") && trimmed.includes(":")) {
    return `${defaultProtocol}://${trimmed}`;
  }

  return null;
}

proxyPoolRouter.post("/pool/import-url", async (c) => {
  const body = await c.req.json<{ url: string; defaultProtocol?: "http" | "socks5" }>();
  if (!body.url) {
    return c.json({ error: "url is required" }, 400);
  }

  const defaultProtocol = body.defaultProtocol || "http";

  try {
    const response = await fetch(body.url);
    if (!response.ok) {
      return c.json({ error: `Failed to fetch URL: ${response.statusText}` }, 400);
    }

    const text = await response.text();
    const lines = text.split(/\r?\n/);
    const parsedUrls: string[] = [];

    for (const line of lines) {
      const parsed = parseProxyLine(line, defaultProtocol);
      if (parsed) {
        parsedUrls.push(parsed);
      }
    }

    if (parsedUrls.length === 0) {
      return c.json({ error: "No valid proxies found in the response text" }, 400);
    }

    // Get existing proxies from database to deduplicate in memory
    const existing = await db.select({ url: proxyPool.url }).from(proxyPool);
    const existingSet = new Set(existing.map((e) => e.url));

    const uniqueImported = Array.from(new Set(parsedUrls));
    const toInsert = uniqueImported.filter((url) => !existingSet.has(url));

    let added = 0;
    if (toInsert.length > 0) {
      await db.insert(proxyPool).values(
        toInsert.map((url) => {
          const type = url.startsWith("socks5://") ? "socks5" : "http";
          let label = "webshare-import";
          try {
            label = new URL(url).hostname;
          } catch {}
          return {
            url,
            type,
            label,
            status: "active",
          };
        })
      );
      added = toInsert.length;
      invalidateProxyCache();
    }

    return c.json({
      success: true,
      found: uniqueImported.length,
      added,
      skipped: uniqueImported.length - added,
    });
  } catch (e: any) {
    return c.json({ error: `Error importing from URL: ${e.message}` }, 500);
  }
});

