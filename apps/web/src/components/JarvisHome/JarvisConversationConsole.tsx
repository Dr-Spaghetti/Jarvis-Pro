import { useEffect, useRef } from "react";

import type { ConversationTurn } from "./types";
import type { MemoryProposal } from "./useJarvisAsk";

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
  proposedMemories: MemoryProposal[];
  onKeepMemory: (proposal: MemoryProposal) => void;
  onSkipMemory: (proposal: MemoryProposal) => void;
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
  proposedMemories,
  onKeepMemory,
  onSkipMemory,
}: Props) => {
  const consoleScrollRef = useRef<HTMLDivElement | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional one-shot
  useEffect(() => {
    if (consoleScrollRef.current) {
      consoleScrollRef.current.scrollTop = consoleScrollRef.current.scrollHeight;
    }
  }, [conversation.length]);

  return (
    <div className="nc-hq-console hud-panel">
      <div className="nc-hq-console-hdr">
        <span className="nc-hq-console-hdr-left">
          <span className="nc-hq-console-hdr-dot" aria-hidden="true" />
          Ask Jarvis
        </span>
        <span className="nc-hq-console-hdr-right">
          <span className="nc-hq-console-turns">
            {conversation.length} {conversation.length === 1 ? "turn" : "turns"}
          </span>
          {conversation.length > 0 && (
            <button type="button" className="nc-hq-new-chat" onClick={onNewChat}>
              New chat
            </button>
          )}
        </span>
      </div>

      <div className="nc-hq-console-msgs" ref={consoleScrollRef}>
        {conversation.length === 0 && (
          <div className="nc-hq-empty">
            Ask anything — a note, a task, or what’s on your plate today.
          </div>
        )}
        {conversation.map((turn, i) => (
          <div className="nc-hq-turn" key={`${turn.time}-${i}`}>
            <div className="nc-hq-msg nc-hq-msg--you">
              <div className="nc-hq-msg-who">You · {turn.time}</div>
              <div className="nc-hq-msg-text">{turn.question}</div>
            </div>
            <div className="nc-hq-msg nc-hq-msg--jarvis">
              <div className="nc-hq-msg-who">Jarvis</div>
              <div className="nc-hq-msg-text">{turn.answer.replace(/\[\d+\]/g, "")}</div>
            </div>
          </div>
        ))}
        {isThinking && <div className="nc-hq-thinking">Thinking…</div>}
        {proposedMemories.length > 0 && !asking && (
          <div className="nc-hq-memory-propose" aria-label="Proposed memories">
            {proposedMemories.map((proposal) => (
              <div className="nc-hq-memory-chip" key={`${proposal.section}:${proposal.text}`}>
                <span>
                  Remember ({proposal.section}): {proposal.text}
                </span>
                <button type="button" onClick={() => onKeepMemory(proposal)}>
                  Keep
                </button>
                <button type="button" onClick={() => onSkipMemory(proposal)}>
                  Skip
                </button>
              </div>
            ))}
          </div>
        )}
        {askNote && !asking && <div className="nc-hq-ask-note">⚠ {askNote}</div>}
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
          placeholder="Ask Jarvis…"
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
