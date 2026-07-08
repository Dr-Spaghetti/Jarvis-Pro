import { useEffect, useRef } from "react";

import type { ConversationTurn } from "./types";

type Props = {
  conversation: ConversationTurn[];
  isThinking: boolean;
  asking: boolean;
  ask: string;
  setAsk: (v: string) => void;
  askNote: string | null;
  answerVia: string | null;
  answerSources: { title: string; path: string }[];
  answerCitations: { title: string; url: string }[];
  sourcesExpanded: boolean;
  setSourcesExpanded: (v: boolean) => void;
  submitAsk: () => void;
  onNewChat: () => void;
};

export const JarvisConversationConsole = ({
  conversation,
  isThinking,
  asking,
  ask,
  setAsk,
  askNote,
  answerVia,
  answerSources,
  answerCitations,
  sourcesExpanded,
  setSourcesExpanded,
  submitAsk,
  onNewChat,
}: Props) => {
  const consoleScrollRef = useRef<HTMLDivElement | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional one-shot
  useEffect(() => {
    if (consoleScrollRef.current) {
      consoleScrollRef.current.scrollTop = consoleScrollRef.current.scrollHeight;
    }
  }, [conversation.length]);

  return (
    <div className="nc-hq-console">
      <div className="nc-hq-console-hdr">
        <span className="nc-hq-console-hdr-left">
          <span className="nc-hq-console-hdr-dot" aria-hidden="true" />
          DIRECT_LINK · JARVIS
        </span>
        <span
          className="nc-hq-console-hdr-right"
          style={{ display: "flex", alignItems: "center", gap: 10 }}
        >
          <span
            style={{
              fontSize: 9,
              letterSpacing: ".18em",
              color: "var(--text-secondary)",
              textTransform: "uppercase",
            }}
          >
            CTX · {conversation.length * 2} TURNS
          </span>
          {conversation.length > 0 && (
            <button
              type="button"
              onClick={onNewChat}
              style={{
                background: "none",
                border: "1px solid rgba(57,255,20,0.18)",
                color: "rgba(57,255,20,0.38)",
                fontFamily: "var(--font-display)",
                fontSize: 8,
                letterSpacing: ".14em",
                textTransform: "uppercase",
                padding: "2px 7px",
                cursor: "pointer",
              }}
            >
              NEW CHAT
            </button>
          )}
        </span>
      </div>

      <div className="nc-hq-console-msgs" ref={consoleScrollRef}>
        {conversation.length === 0 && (
          <div
            style={{
              color: "var(--text-secondary)",
              fontSize: 11,
              letterSpacing: ".08em",
              padding: "8px 0",
            }}
          >
            AWAITING DIRECTIVE<span className="nc-blink">_</span>
          </div>
        )}
        {conversation.map((turn) => (
          <div className="nc-hq-turn" key={`${turn.time}-${turn.question}`}>
            <div className="nc-hq-msg nc-hq-msg--you">
              <div className="nc-hq-msg-who">USR_CMD · {turn.time}</div>
              <div className="nc-hq-msg-text">{turn.question}</div>
            </div>
            <div className="nc-hq-msg nc-hq-msg--jarvis">
              <div className="nc-hq-msg-who">JARVIS</div>
              <div className="nc-hq-msg-text">{turn.answer}</div>
            </div>
          </div>
        ))}
        {isThinking && (
          <div className="nc-hq-thinking">
            PROCESSING<span className="nc-blink">_</span>
          </div>
        )}
        {askNote && !asking && (
          <div
            style={{
              color: "var(--term-red, #ff4444)",
              fontSize: 11,
              letterSpacing: ".08em",
              padding: "6px 0",
              marginTop: 4,
              lineHeight: 1.5,
            }}
          >
            ⚠ {askNote}
          </div>
        )}
        {answerVia && !asking && (
          <div className="nc-hq-attribution">
            <button
              type="button"
              className="nc-hq-attribution-line"
              onClick={() => setSourcesExpanded(!sourcesExpanded)}
            >
              via {answerVia}
              {answerSources.length > 0 &&
                ` · ${answerSources.length} note${answerSources.length !== 1 ? "s" : ""}`}
              {answerCitations.length > 0 && " · web"}
              <span className="nc-hq-attribution-arrow">{sourcesExpanded ? "▴" : "▾"}</span>
            </button>
            {sourcesExpanded && (answerSources.length > 0 || answerCitations.length > 0) && (
              <div className="nc-hq-attribution-detail">
                {answerSources.map((s) => (
                  <div key={s.path} className="nc-hq-attribution-item">
                    ◆ {s.title}
                  </div>
                ))}
                {answerCitations.map((c) => (
                  <a
                    key={c.url}
                    className="nc-hq-attribution-cite"
                    href={c.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    ◆ {c.title || c.url}
                  </a>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="nc-hq-console-input">
        <span className="nc-hq-prompt" aria-hidden="true">
          &gt;
        </span>
        <input
          className="nc-hq-input"
          type="text"
          placeholder="Issue a directive to JARVIS…"
          value={ask}
          aria-label="Send a message to Jarvis"
          onChange={(e) => setAsk(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submitAsk();
          }}
        />
        <button
          type="button"
          className="nc-hq-send"
          disabled={asking || ask.trim().length === 0}
          onClick={submitAsk}
        >
          {asking ? "…" : "SEND"}
        </button>
      </div>
    </div>
  );
};
