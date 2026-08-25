import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type UrlResearchResult, ingestImageBuffer, saveAnalysis } from "./analyzerRoutes.js";
import { askViaPerplexity } from "./brain/ask.js";

// ─── State ────────────────────────────────────────────────────────────────────

type EmailIngestState = {
  enabled: boolean;
  processedCount: number;
  lastReceivedAt: string | null;
  lastErrors: string[];
};

const DEFAULT_STATE: EmailIngestState = {
  enabled: true,
  processedCount: 0,
  lastReceivedAt: null,
  lastErrors: [],
};

const getStatePath = (projectStateDir: string) =>
  join(projectStateDir, "state", "emailIngest.json");

export const readEmailIngestState = (projectStateDir: string): EmailIngestState => {
  try {
    const p = getStatePath(projectStateDir);
    if (!existsSync(p)) return { ...DEFAULT_STATE };
    return { ...DEFAULT_STATE, ...JSON.parse(readFileSync(p, "utf8")) };
  } catch {
    return { ...DEFAULT_STATE };
  }
};

export const writeEmailIngestState = (projectStateDir: string, state: EmailIngestState): void => {
  try {
    mkdirSync(join(projectStateDir, "state"), { recursive: true });
    writeFileSync(getStatePath(projectStateDir), JSON.stringify(state, null, 2), "utf8");
  } catch {
    /* non-fatal */
  }
};

// ─── URL extraction ───────────────────────────────────────────────────────────

const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^[\]`]+/g;

const IMAGE_EXTENSIONS = /\.(png|jpg|jpeg|gif|webp|ico|svg|bmp|tiff|avif)(\?.*)?$/i;

const NOISE_DOMAINS = new Set([
  "wisestamp.com",
  "mailtrack.io",
  "sendgrid.net",
  "mandrillapp.com",
  "list-manage.com",
  "mktomail.com",
]);

const isNoiseHost = (u: string): boolean => {
  try {
    const host = new URL(u).hostname.toLowerCase();
    return [...NOISE_DOMAINS].some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return true;
  }
};

const isImageUrl = (u: string): boolean => {
  try {
    return IMAGE_EXTENSIONS.test(new URL(u).pathname);
  } catch {
    return false;
  }
};

export const extractEmailTargets = (
  text: string,
  html: string,
): { pageUrls: string[]; imageUrls: string[] } => {
  const textUrls = text.match(URL_REGEX) ?? [];
  const htmlUrls = html.match(URL_REGEX) ?? [];
  const raw = textUrls.length > 0 ? textUrls : htmlUrls;
  const seen = new Set<string>();
  const pageUrls: string[] = [];
  const imageUrls: string[] = [];
  for (const u of raw) {
    try {
      new URL(u);
    } catch {
      continue;
    }
    if (seen.has(u) || isNoiseHost(u)) continue;
    seen.add(u);
    if (isImageUrl(u)) imageUrls.push(u);
    else pageUrls.push(u);
  }
  return { pageUrls, imageUrls };
};

const mimeFromImageUrl = (u: string): string => {
  try {
    const path = new URL(u).pathname.toLowerCase();
    if (path.endsWith(".png")) return "image/png";
    if (path.endsWith(".gif")) return "image/gif";
    if (path.endsWith(".webp")) return "image/webp";
  } catch {
    /* ignore */
  }
  return "image/jpeg";
};

const ingestRemoteImage = async (
  url: string,
  emailMeta: {
    source: "email";
    emailFrom: string;
    emailSubject: string;
    emailMessageId: string;
  },
): Promise<boolean> => {
  if (isBlockedFetchUrl(url)) return false;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return false;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0 || buf.length > 20 * 1024 * 1024) return false;
  const mimeType = res.headers.get("content-type")?.split(";")[0]?.trim() || mimeFromImageUrl(url);
  if (!["image/jpeg", "image/png", "image/gif", "image/webp"].includes(mimeType)) return false;
  const ingested = await ingestImageBuffer(buf, mimeType, url.split("/").pop() || "email-image", {
    id: `analysis-${randomUUID()}`,
    sourceUrl: url,
    ...emailMeta,
  });
  return !("error" in ingested);
};

// ─── URL analysis ─────────────────────────────────────────────────────────────

const isBlockedFetchUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return true;
    const host = parsed.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "0.0.0.0") {
      return true;
    }
    if (/^(10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(host)) return true;
    return false;
  } catch {
    return true;
  }
};

const fetchUrlMetadata = async (url: string): Promise<{ title: string; description: string }> => {
  if (isBlockedFetchUrl(url)) {
    return { title: "", description: "" };
  }
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Jarvis/1.0)" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return { title: "", description: "" };
    const text = await res.text();
    const titleMatch = /<title[^>]*>([^<]*)<\/title>/i.exec(text);
    const descMatch =
      /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i.exec(text) ??
      /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i.exec(text);
    return {
      title: titleMatch?.[1]?.trim() ?? "",
      description: descMatch?.[1]?.trim() ?? "",
    };
  } catch {
    return { title: "", description: "" };
  }
};

const analyzeUrl = async (url: string): Promise<UrlResearchResult | null> => {
  if (isBlockedFetchUrl(url)) {
    return null;
  }
  try {
    const [meta, perplexityResult] = await Promise.all([
      fetchUrlMetadata(url),
      askViaPerplexity(
        `Research this thoroughly and summarize what it is, key information, and why it might be important: ${url}`,
        true,
      ),
    ]);
    return {
      url,
      title: meta.title,
      description: meta.description,
      research: perplexityResult?.answer ?? "",
      citations: perplexityResult?.citations.map((c) => c.url).filter(Boolean) ?? [],
      fetchedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
};

// ─── Main export ──────────────────────────────────────────────────────────────

export type EmailIngestResult = {
  analysisCount: number;
  errors: string[];
};

export const processEmailWebhook = async (
  projectStateDir: string,
  opts: {
    from: string;
    subject: string;
    messageId: string;
    text: string;
    html: string;
    attachments?: Array<{ filename?: string; contentType?: string; url?: string }>;
  },
): Promise<EmailIngestResult> => {
  const result: EmailIngestResult = { analysisCount: 0, errors: [] };
  const emailMeta = {
    source: "email" as const,
    emailFrom: opts.from,
    emailSubject: opts.subject,
    emailMessageId: opts.messageId,
  };

  const { pageUrls, imageUrls } = extractEmailTargets(opts.text, opts.html);

  for (const url of pageUrls) {
    try {
      const urlResult = await analyzeUrl(url);
      if (urlResult) {
        const id = `analysis-${randomUUID()}`;
        saveAnalysis(
          {
            id,
            type: "url",
            filename: urlResult.title || url,
            mimeType: "text/uri-list",
            created: new Date().toISOString(),
            sourceUrl: url,
            ...emailMeta,
          },
          urlResult,
        );
        result.analysisCount++;
      }
    } catch (e) {
      result.errors.push(`URL ${url}: ${String(e)}`);
    }
  }

  for (const url of imageUrls) {
    try {
      if (await ingestRemoteImage(url, emailMeta)) result.analysisCount++;
    } catch (e) {
      result.errors.push(`Image ${url}: ${String(e)}`);
    }
  }

  for (const attachment of opts.attachments ?? []) {
    const url = attachment.url?.trim();
    const mime = attachment.contentType ?? "";
    if (!url || !mime.startsWith("image/")) continue;
    try {
      if (await ingestRemoteImage(url, emailMeta)) result.analysisCount++;
    } catch (e) {
      result.errors.push(`Attachment ${attachment.filename ?? url}: ${String(e)}`);
    }
  }

  const state = readEmailIngestState(projectStateDir);
  writeEmailIngestState(projectStateDir, {
    ...state,
    processedCount: state.processedCount + 1,
    lastReceivedAt: new Date().toISOString(),
    lastErrors: result.errors.slice(-10),
  });

  return result;
};
