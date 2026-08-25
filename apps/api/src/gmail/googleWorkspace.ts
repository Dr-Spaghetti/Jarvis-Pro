import { refreshAccessToken } from "./gmailAuth";

export type MailMessage = {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  date: string;
  snippet: string;
  unread: boolean;
};

export type CalendarEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  location?: string;
};

export type GoogleListResult<T> =
  | { status: "ok"; items: T[]; unread?: number }
  | { status: "not-configured"; items: T[]; detail: string }
  | { status: "error"; items: T[]; detail: string }
  | { status: "needs-reconnect"; items: T[]; detail: string };

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
const CALENDAR_API = "https://www.googleapis.com/calendar/v3/calendars/primary";

export const encodeRfc822 = (fields: {
  to: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string;
}): string => {
  const lines = [
    `To: ${fields.to}`,
    `Subject: ${fields.subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
  ];
  if (fields.inReplyTo) lines.push(`In-Reply-To: ${fields.inReplyTo}`);
  if (fields.references) lines.push(`References: ${fields.references}`);
  lines.push("", fields.body.replace(/\r?\n/g, "\r\n"));
  return Buffer.from(lines.join("\r\n")).toString("base64url");
};

export const headerMap = (
  headers: Array<{ name?: string; value?: string }>,
): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const header of headers) {
    const name = header.name?.toLowerCase();
    if (name && typeof header.value === "string") out[name] = header.value;
  }
  return out;
};

const googleGet = async (
  url: string,
  accessToken: string,
): Promise<{ ok: boolean; status: number; json: Record<string, unknown> | null }> => {
  try {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    const json = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    return { ok: response.ok, status: response.status, json };
  } catch {
    return { ok: false, status: 0, json: null };
  }
};

const notConfigured = <T>(kind: string): GoogleListResult<T> => ({
  status: "not-configured",
  items: [],
  detail: `Connect Gmail in Settings to enable ${kind}.`,
});

export const listInbox = async (limit = 8): Promise<GoogleListResult<MailMessage>> => {
  if (!process.env.GMAIL_REFRESH_TOKEN?.trim()) return notConfigured("mail");
  const accessToken = await refreshAccessToken();
  if (!accessToken) {
    return {
      status: "error",
      items: [],
      detail: "Could not refresh Gmail. Reconnect in Settings.",
    };
  }

  const unreadRes = await googleGet(`${GMAIL_API}/labels/UNREAD`, accessToken);
  const unread =
    unreadRes.ok && typeof unreadRes.json?.messagesUnread === "number"
      ? unreadRes.json.messagesUnread
      : undefined;

  const listUrl = `${GMAIL_API}/messages?maxResults=${Math.min(limit, 12)}&q=${encodeURIComponent("in:inbox newer_than:14d")}`;
  const listed = await googleGet(listUrl, accessToken);
  if (listed.status === 401 || listed.status === 403) {
    return {
      status: "needs-reconnect",
      items: [],
      detail: "Gmail access expired. Reconnect in Settings.",
    };
  }
  if (!listed.ok || !listed.json) {
    return { status: "error", items: [], detail: "Could not read the inbox.", unread };
  }
  const refs = Array.isArray(listed.json.messages)
    ? (listed.json.messages as Array<{ id?: string; threadId?: string }>)
        .map((row) => ({ id: row.id ?? "", threadId: row.threadId ?? "" }))
        .filter((row) => row.id)
    : [];

  const messages = (
    await Promise.all(
      refs.map(async (ref) => {
        const url = `${GMAIL_API}/messages/${encodeURIComponent(ref.id)}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date&metadataHeaders=Message-ID`;
        const got = await googleGet(url, accessToken);
        if (!got.ok || !got.json) return null;
        const payload = Array.isArray(
          (got.json.payload as { headers?: unknown } | undefined)?.headers,
        )
          ? (got.json.payload as { headers: Array<{ name?: string; value?: string }> }).headers
          : [];
        const headers = headerMap(payload);
        const labelIds = Array.isArray(got.json.labelIds) ? (got.json.labelIds as string[]) : [];
        const message: MailMessage = {
          id: ref.id,
          threadId: typeof got.json.threadId === "string" ? got.json.threadId : ref.threadId,
          from: headers.from ?? "",
          subject: headers.subject ?? "(no subject)",
          date: headers.date ?? "",
          snippet: typeof got.json.snippet === "string" ? got.json.snippet : "",
          unread: labelIds.includes("UNREAD"),
        };
        return message;
      }),
    )
  ).filter((row): row is MailMessage => row !== null);

  return { status: "ok", items: messages, unread };
};

export const sendMail = async (fields: {
  to: string;
  subject: string;
  body: string;
  threadId?: string;
  inReplyTo?: string;
  references?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> => {
  const accessToken = await refreshAccessToken();
  if (!accessToken) return { ok: false, error: "Gmail token refresh failed." };
  const raw = encodeRfc822(fields);
  try {
    const response = await fetch(`${GMAIL_API}/messages/send`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(fields.threadId ? { raw, threadId: fields.threadId } : { raw }),
    });
    if (!response.ok) {
      return { ok: false, error: `Gmail send failed (${response.status}).` };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "Gmail send failed." };
  }
};

export const archiveMail = async (
  messageId: string,
): Promise<{ ok: true } | { ok: false; error: string }> => {
  const accessToken = await refreshAccessToken();
  if (!accessToken) return { ok: false, error: "Gmail token refresh failed." };
  try {
    const response = await fetch(`${GMAIL_API}/messages/${encodeURIComponent(messageId)}/modify`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ removeLabelIds: ["INBOX", "UNREAD"] }),
    });
    if (!response.ok) return { ok: false, error: `Archive failed (${response.status}).` };
    return { ok: true };
  } catch {
    return { ok: false, error: "Archive failed." };
  }
};

export const listAgenda = async (limit = 8): Promise<GoogleListResult<CalendarEvent>> => {
  if (!process.env.GMAIL_REFRESH_TOKEN?.trim()) return notConfigured("calendar");
  const accessToken = await refreshAccessToken();
  if (!accessToken) {
    return {
      status: "error",
      items: [],
      detail: "Could not refresh Google access. Reconnect in Settings.",
    };
  }
  const now = new Date();
  const until = new Date(now.getTime() + 48 * 60 * 60 * 1000);
  const params = new URLSearchParams({
    singleEvents: "true",
    orderBy: "startTime",
    timeMin: now.toISOString(),
    timeMax: until.toISOString(),
    maxResults: String(Math.min(limit, 12)),
  });
  const listed = await googleGet(`${CALENDAR_API}/events?${params.toString()}`, accessToken);
  if (listed.status === 401 || listed.status === 403) {
    return {
      status: "needs-reconnect",
      items: [],
      detail: "Reconnect Gmail in Settings to grant Calendar access.",
    };
  }
  if (!listed.ok || !listed.json) {
    return { status: "error", items: [], detail: "Could not read the calendar." };
  }
  const items = Array.isArray(listed.json.items) ? listed.json.items : [];
  const events: CalendarEvent[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const event = raw as Record<string, unknown>;
    const start = event.start as { dateTime?: string; date?: string } | undefined;
    const end = event.end as { dateTime?: string; date?: string } | undefined;
    const id = typeof event.id === "string" ? event.id : "";
    if (!id) continue;
    events.push({
      id,
      title: typeof event.summary === "string" ? event.summary : "(no title)",
      start: start?.dateTime ?? start?.date ?? "",
      end: end?.dateTime ?? end?.date ?? "",
      ...(typeof event.location === "string" ? { location: event.location } : {}),
    });
  }
  return { status: "ok", items: events };
};

export const createCalendarEvent = async (fields: {
  title: string;
  start: string;
  end: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> => {
  const accessToken = await refreshAccessToken();
  if (!accessToken) return { ok: false, error: "Google token refresh failed." };
  try {
    const response = await fetch(`${CALENDAR_API}/events`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        summary: fields.title,
        start: { dateTime: fields.start },
        end: { dateTime: fields.end },
      }),
    });
    if (response.status === 401 || response.status === 403) {
      return { ok: false, error: "Reconnect Gmail in Settings to grant Calendar access." };
    }
    if (!response.ok) return { ok: false, error: `Calendar create failed (${response.status}).` };
    const data = (await response.json()) as { id?: string };
    return { ok: true, id: data.id ?? "" };
  } catch {
    return { ok: false, error: "Calendar create failed." };
  }
};

export const LIFE_LIVE_PATTERN =
  /\b(email|inbox|gmail|mail|calendar|meeting|schedule|agenda|what's on|whats on)\b/i;

export const formatLifeContext = async (question: string): Promise<string> => {
  if (!LIFE_LIVE_PATTERN.test(question)) return "";
  const [mail, agenda] = await Promise.all([listInbox(6), listAgenda(6)]);
  const lines: string[] = [];
  if (mail.status === "ok") {
    lines.push("INBOX:");
    if (mail.items.length === 0) lines.push("- (empty)");
    for (const message of mail.items) {
      lines.push(`- ${message.unread ? "[unread] " : ""}${message.from} — ${message.subject}`);
    }
  } else {
    lines.push(`INBOX: ${mail.detail ?? mail.status}`);
  }
  if (agenda.status === "ok") {
    lines.push("AGENDA (next 48h):");
    if (agenda.items.length === 0) lines.push("- (nothing scheduled)");
    for (const event of agenda.items) {
      lines.push(`- ${event.start} ${event.title}`);
    }
  } else {
    lines.push(`AGENDA: ${agenda.detail ?? agenda.status}`);
  }
  return lines.join("\n");
};
