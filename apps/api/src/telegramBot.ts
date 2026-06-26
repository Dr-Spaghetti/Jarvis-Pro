const JARVIS_PORT = process.env.OCTOGENT_API_PORT ?? "8787";
const JARVIS_URL = `http://127.0.0.1:${JARVIS_PORT}/api/brain/ask`;

function stripMarkdown(text: string): string {
  return text
    .replace(/#{1,6}\s+/g, "") // headers
    .replace(/\*\*(.+?)\*\*/g, "$1") // bold
    .replace(/\*(.+?)\*/g, "$1") // italic
    .replace(/__(.+?)__/g, "$1") // bold underscore
    .replace(/_(.+?)_/g, "$1") // italic underscore
    .replace(/~~(.+?)~~/g, "$1") // strikethrough
    .replace(/`{1,3}[^`]*`{1,3}/g, "") // inline + block code
    .replace(/\[(.+?)\]\(.+?\)/g, "$1") // links — keep label
    .replace(/!\[.*?\]\(.*?\)/g, "") // images
    .replace(/^>\s+/gm, "") // blockquotes
    .replace(/^[-*+]\s+/gm, "") // unordered list bullets
    .replace(/^\d+\.\s+/gm, "") // ordered list numbers
    .replace(/^---+$/gm, "") // horizontal rules
    .replace(/[{}[\]]/g, "") // curly/square braces
    .replace(/\n{3,}/g, "\n\n") // collapse excess blank lines
    .trim();
}

function telegramApi(
  method: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; result: unknown }> {
  const token = process.env.TELEGRAM_BOT_TOKEN as string;
  return fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => r.json() as Promise<{ ok: boolean; result: unknown }>);
}

async function sendMessage(chatId: number, text: string): Promise<void> {
  await telegramApi("sendMessage", {
    chat_id: chatId,
    text: text.slice(0, 4096),
  });
}

async function sendTyping(chatId: number): Promise<void> {
  await telegramApi("sendChatAction", { chat_id: chatId, action: "typing" });
}

async function askJarvis(question: string): Promise<string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (process.env.OCTOGENT_AUTH_TOKEN) {
    headers.Authorization = `Bearer ${process.env.OCTOGENT_AUTH_TOKEN}`;
  }
  const res = await fetch(JARVIS_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ question, source: "telegram" }),
  });
  const data = (await res.json()) as { available?: boolean; answer?: string; reason?: string };
  if (data.available === false) return data.reason ?? "Jarvis could not answer that right now.";
  return data.answer ?? "No response from Jarvis.";
}

async function handleUpdate(update: Record<string, unknown>): Promise<void> {
  const message = update.message as Record<string, unknown> | undefined;
  if (!message) return;

  const chat = message.chat as Record<string, unknown>;
  const from = message.from as Record<string, unknown>;
  const chatId = chat.id as number;
  const userId = String(from.id);
  const text = (message.text as string | undefined) ?? "";

  const allowedId = process.env.TELEGRAM_ALLOWED_USER_ID;

  if (allowedId && userId !== allowedId) {
    await sendMessage(chatId, "Unauthorized.");
    return;
  }

  if (text === "/start" || text.startsWith("/start ")) {
    if (!allowedId) {
      await sendMessage(
        chatId,
        `Hi! I'm Jarvis.\n\nYour Telegram user ID is: ${userId}\n\nAdd this line to your .env file:\nTELEGRAM_ALLOWED_USER_ID=${userId}\n\nThen restart Jarvis — you'll be fully authorized.`,
      );
    } else {
      await sendMessage(chatId, "Jarvis online. Send me any question or task.");
    }
    return;
  }

  if (!text.trim()) return;

  void sendTyping(chatId);

  try {
    const answer = await askJarvis(text);
    await sendMessage(chatId, stripMarkdown(answer));
  } catch {
    await sendMessage(
      chatId,
      "Jarvis is not responding. Make sure the server is running on your PC.",
    );
  }
}

export async function startTelegramBot(): Promise<void> {
  if (!process.env.TELEGRAM_BOT_TOKEN) return;

  console.log("[telegram] Bot polling started — message your bot to control Jarvis from anywhere");

  let offset = 0;
  for (;;) {
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getUpdates?offset=${offset}&timeout=30&allowed_updates=["message"]`,
      );
      const data = (await res.json()) as { ok: boolean; result: Array<Record<string, unknown>> };
      if (data.ok) {
        for (const update of data.result) {
          offset = (update.update_id as number) + 1;
          void handleUpdate(update);
        }
      }
    } catch {
      await new Promise<void>((r) => setTimeout(r, 5_000));
    }
  }
}
