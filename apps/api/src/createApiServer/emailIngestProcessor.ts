import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type UrlResearchResult, saveAnalysis } from "./analyzerRoutes.js";
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

const isNoiseUrl = (u: string): boolean => {
  try {
    const parsed = new URL(u);
    if (IMAGE_EXTENSIONS.test(parsed.pathname)) return true;
    const host = parsed.hostname.toLowerCase();
    return [...NOISE_DOMAINS].some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return true;
  }
};

const extractUrls = (text: string, html: string): string[] => {
  // Prefer text body URLs — they're intentional. HTML adds extras from signatures/formatting.
  const textUrls = text.match(URL_REGEX) ?? [];
  const htmlUrls = html.match(URL_REGEX) ?? [];
  const raw = textUrls.length > 0 ? textUrls : htmlUrls;
  const seen = new Set<string>();
  return raw.filter((u) => {
    try {
      new URL(u);
    } catch {
      return false;
    }
    if (seen.has(u)) return false;
    seen.add(u);
    return !isNoiseUrl(u);
  });
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
  },
): Promise<EmailIngestResult> => {
  const result: EmailIngestResult = { analysisCount: 0, errors: [] };
  const emailMeta = {
    source: "email" as const,
    emailFrom: opts.from,
    emailSubject: opts.subject,
    emailMessageId: opts.messageId,
  };

  const urls = extractUrls(opts.text, opts.html);

  for (const url of urls) {
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

  const state = readEmailIngestState(projectStateDir);
  writeEmailIngestState(projectStateDir, {
    ...state,
    processedCount: state.processedCount + 1,
    lastReceivedAt: new Date().toISOString(),
    lastErrors: result.errors.slice(-10),
  });

  return result;
};
