const JARVIS = "http://localhost:8787";
const MAX_CTX = 800;

let panel = null;
let answerText = "";

function getContext() {
  const sel = (window.getSelection()?.toString() ?? "").trim();
  const title = (document.title ?? "").trim();
  const url = location.href;
  return [sel, title, url].filter(Boolean).join("\n").slice(0, MAX_CTX);
}

function buildPanel() {
  const el = document.createElement("div");
  el.id = "jarvis-ext-panel";
  el.className = "jarvis-hidden";
  el.innerHTML = `
    <div class="j-header">
      <span>JARVIS</span>
      <button class="j-close" title="Close (Esc)">✕</button>
    </div>
    <textarea class="j-context" rows="3" placeholder="Page context (editable)…"></textarea>
    <div class="j-input-row">
      <input class="j-input" type="text" placeholder="Ask Jarvis…" />
      <button class="j-send" disabled>SEND</button>
    </div>
    <div class="j-answer"></div>
    <div class="j-footer" style="display:none">
      <button class="j-play">🔊</button>
      <a class="j-open" href="${JARVIS}" target="_blank" rel="noopener">Open in Jarvis →</a>
    </div>
  `;
  document.body.appendChild(el);

  el.querySelector(".j-close").addEventListener("click", hidePanel);

  const input = el.querySelector(".j-input");
  const send = el.querySelector(".j-send");
  input.addEventListener("input", () => { send.disabled = !input.value.trim(); });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !send.disabled) sendQuestion(); });
  send.addEventListener("click", sendQuestion);
  el.querySelector(".j-play").addEventListener("click", playAnswer);

  return el;
}

function showPanel() {
  if (!panel) panel = buildPanel();
  panel.classList.remove("jarvis-hidden");
  panel.querySelector(".j-context").value = getContext();
  panel.querySelector(".j-input").focus();
}

function hidePanel() {
  panel?.classList.add("jarvis-hidden");
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") hidePanel();
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== "toggle") return;
  if (!panel || panel.classList.contains("jarvis-hidden")) {
    showPanel();
  } else {
    hidePanel();
  }
});

async function sendQuestion() {
  const input = panel.querySelector(".j-input");
  const send = panel.querySelector(".j-send");
  const answerEl = panel.querySelector(".j-answer");
  const footer = panel.querySelector(".j-footer");
  const ctx = panel.querySelector(".j-context").value.trim();
  const question = input.value.trim();
  if (!question) return;

  send.disabled = true;
  answerEl.className = "j-answer j-thinking";
  answerEl.textContent = "Thinking…";
  footer.style.display = "none";
  answerText = "";

  try {
    const body = { question };
    if (ctx) body.clipboardContext = ctx;
    const res = await fetch(`${JARVIS}/api/brain/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error("Jarvis is offline — start it first.");
    const data = await res.json();
    answerEl.className = "j-answer";
    if (data.available && data.answer) {
      // Strip markdown bold/italic for clean display
      answerText = data.answer.replace(/\*\*/g, "").replace(/\*/g, "").replace(/^#+\s/gm, "");
      answerEl.textContent = answerText;
      footer.style.display = "flex";
    } else {
      answerEl.textContent = data.hint ?? "No answer model available — check your API keys in Jarvis Settings.";
    }
  } catch {
    answerEl.className = "j-answer";
    answerEl.textContent = "Jarvis is offline — start it first.";
  } finally {
    send.disabled = false;
  }
}

async function playAnswer() {
  if (!answerText) return;
  const playBtn = panel.querySelector(".j-play");
  playBtn.textContent = "⏳";
  playBtn.disabled = true;
  // Claim the user-gesture autoplay token before the async fetch boundary.
  // Without this, Chrome blocks audio.play() because the gesture is consumed.
  const unlock = new Audio("data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAAAAAAAARQAABQAAAAAAAABAAEAIlYAAJSsAACABAAA");
  unlock.volume = 0;
  void unlock.play().catch(() => {});
  let url;
  try {
    const res = await fetch(`${JARVIS}/api/voice/speak`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: answerText, provider: "deepgram", model: "aura-2-odysseus-en" }),
    });
    if (!res.ok) throw new Error("speak failed");
    const blob = await res.blob();
    url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.addEventListener("ended", () => URL.revokeObjectURL(url), { once: true });
    await audio.play();
  } catch {
    URL.revokeObjectURL(url);
  } finally {
    playBtn.textContent = "🔊";
    playBtn.disabled = false;
  }
}
