import { readGmailConnectionStatus } from "../../gmail/gmailAuth";
import { readBriefConfig } from "../briefScheduler";
import type { ApiRouteHandler } from "../routeHelpers";
import { writeJson, writeMethodNotAllowed } from "../routeHelpers";
import { resolveVaultDir } from "./vault";

export type HealthStatus = "ok" | "not-configured" | "error";

export type HealthItem = {
  id: string;
  title: string;
  status: HealthStatus;
  detail: string;
};

const keyPresent = (name: string): boolean => {
  const value = process.env[name]?.trim();
  return Boolean(value && value.length > 0);
};

export const computeJarvisHealth = (projectStateDir?: string): { items: HealthItem[] } => {
  const vaultDir = resolveVaultDir();
  const gmail = readGmailConnectionStatus();
  const agentmail = keyPresent("AGENTMAIL_API_KEY") && keyPresent("AGENTMAIL_INBOX");
  const anthropic = keyPresent("ANTHROPIC_API_KEY");
  const openai = keyPresent("OPENAI_API_KEY");
  const deepgram = keyPresent("DEEPGRAM_API_KEY");
  const perplexity = keyPresent("PERPLEXITY_API_KEY");
  const authRequired = keyPresent("OCTOGENT_AUTH_TOKEN");
  const brief = projectStateDir ? readBriefConfig(projectStateDir) : null;

  const items: HealthItem[] = [
    {
      id: "vault",
      title: "Brain (vault)",
      status: vaultDir ? "ok" : "not-configured",
      detail: vaultDir
        ? "Obsidian vault is connected."
        : "Set OBSIDIAN_VAULT_PATH in .env to enable memory, tasks, and notes.",
    },
    {
      id: "brain",
      title: "Ask model",
      status: anthropic || openai ? "ok" : "not-configured",
      detail: anthropic
        ? `Claude ready${perplexity ? " · web search on" : " · add PERPLEXITY_API_KEY for live web"}`
        : openai
          ? "OpenAI ready"
          : "Set ANTHROPIC_API_KEY in .env so Ask can answer.",
    },
    {
      id: "voice",
      title: "Voice",
      status: deepgram || openai ? "ok" : "not-configured",
      detail: deepgram
        ? "Deepgram transcription/TTS configured."
        : openai
          ? "OpenAI Whisper/TTS configured."
          : "Add DEEPGRAM_API_KEY (or OPENAI_API_KEY) for voice.",
    },
    {
      id: "gmail",
      title: "Gmail",
      status: gmail.connected ? "ok" : "not-configured",
      detail: gmail.connected
        ? `Connected as ${gmail.email}`
        : "Connect Gmail in Settings to enable mail.",
    },
    {
      id: "calendar",
      title: "Calendar",
      status: gmail.connected ? "ok" : "not-configured",
      detail: gmail.connected
        ? "Uses the Gmail connection. Reconnect Gmail if agenda asks for access."
        : "Connect Gmail in Settings to enable calendar.",
    },
    {
      id: "email-ingest",
      title: "Email ingest",
      status: agentmail ? "ok" : "not-configured",
      detail: agentmail
        ? "AgentMail inbox is configured."
        : "Set AGENTMAIL_API_KEY and AGENTMAIL_INBOX to capture links from your phone.",
    },
    {
      id: "brief",
      title: "Morning brief",
      status: brief?.enabled ? "ok" : "not-configured",
      detail: brief?.enabled
        ? `Enabled at ${brief.time}${brief.lastBriefDate ? ` · last ${brief.lastBriefDate}` : ""}`
        : "Enable the morning brief in Settings → Brain.",
    },
    {
      id: "auth",
      title: "Unlock token",
      status: authRequired ? "ok" : "not-configured",
      detail: authRequired
        ? "Unlock token is set (value is never shown here)."
        : "OCTOGENT_AUTH_TOKEN is unset — fine for local-only, required for remote access.",
    },
  ];

  return { items };
};

export const handleBrainHealthRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { projectStateDir },
) => {
  if (requestUrl.pathname !== "/api/brain/health") return false;
  if (request.method !== "GET") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }
  writeJson(response, 200, computeJarvisHealth(projectStateDir), corsOrigin);
  return true;
};
