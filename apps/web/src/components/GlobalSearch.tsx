import { useCallback, useEffect, useRef, useState } from "react";

import type { PrimaryNavIndex } from "../app/constants";
import { apiFetch } from "../runtime/apiClient";
import { buildSearchUrl } from "../runtime/runtimeEndpoints";

type SearchResult = {
  type: "workflow" | "idea" | "conversation";
  id: string;
  title: string;
  snippet: string;
  navTarget: number;
};

type SearchResponse = {
  results: SearchResult[];
  query: string;
};

const TYPE_LABELS: Record<string, string> = {
  workflow: "WORKFLOW",
  idea: "IDEA",
  conversation: "CONVO",
};

const TYPE_ICONS: Record<string, string> = {
  workflow: "⟐",
  idea: "◆",
  conversation: "◈",
};

const GROUP_ORDER: SearchResult["type"][] = ["workflow", "idea", "conversation"];

const GROUP_LABELS: Record<string, string> = {
  workflow: "WORKFLOWS",
  idea: "IDEAS",
  conversation: "CONVERSATIONS",
};

type GlobalSearchProps = {
  onClose: () => void;
  onNavigate: (index: PrimaryNavIndex) => void;
};

export const GlobalSearch = ({ onClose, onNavigate }: GlobalSearchProps) => {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    if (query.trim().length < 2) {
      setResults([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    debounceRef.current = setTimeout(() => {
      void apiFetch(`${buildSearchUrl()}?q=${encodeURIComponent(query.trim())}`, { method: "GET" })
        .then(async (res) => {
          if (!res.ok) return;
          const data = (await res.json()) as SearchResponse;
          setResults(data.results ?? []);
          setHighlightedIndex(0);
        })
        .catch(() => {})
        .finally(() => setIsLoading(false));
    }, 220);
    return () => {
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const handleSelect = useCallback(
    (result: SearchResult) => {
      onNavigate(result.navTarget as PrimaryNavIndex);
      onClose();
    },
    [onNavigate, onClose],
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (results.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightedIndex((i) => (i + 1) % results.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightedIndex((i) => (i - 1 + results.length) % results.length);
      } else if (e.key === "Enter") {
        e.preventDefault();
        const result = results[highlightedIndex];
        if (result) handleSelect(result);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [results, highlightedIndex, onClose, handleSelect]);

  const grouped = GROUP_ORDER.map((type) => ({
    type,
    label: GROUP_LABELS[type] ?? type.toUpperCase(),
    items: results.filter((r) => r.type === type),
  })).filter((g) => g.items.length > 0);

  const flatResults = grouped.flatMap((g) => g.items);

  return (
    <>
      <div className="global-search-backdrop" onClick={onClose} aria-hidden="true" />
      <div
        className="global-search-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Global search"
      >
        <div className="global-search-input-row">
          <span className="global-search-icon">⌕</span>
          <input
            ref={inputRef}
            type="text"
            className="global-search-input"
            placeholder="Search workflows, ideas, conversations…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          {isLoading && <span className="global-search-spinner">◌</span>}
          <kbd className="global-search-hint-key">ESC</kbd>
        </div>

        {query.trim().length >= 2 ? (
          <div className="global-search-results" role="listbox">
            {grouped.length === 0 && !isLoading && (
              <div className="global-search-empty">
                NO RESULTS FOR &ldquo;{query.trim().toUpperCase()}&rdquo;
              </div>
            )}
            {grouped.map((group) => (
              <div key={group.type} className="global-search-group">
                <div className="global-search-group-title">{group.label}</div>
                {group.items.map((result) => {
                  const flatIdx = flatResults.indexOf(result);
                  return (
                    <button
                      key={result.id}
                      type="button"
                      role="option"
                      aria-selected={flatIdx === highlightedIndex}
                      className={`global-search-item${flatIdx === highlightedIndex ? " global-search-item--highlighted" : ""}`}
                      onClick={() => handleSelect(result)}
                      onMouseEnter={() => setHighlightedIndex(flatIdx)}
                    >
                      <span className="global-search-item-icon">
                        {TYPE_ICONS[result.type] ?? "◉"}
                      </span>
                      <div className="global-search-item-body">
                        <div className="global-search-item-title">{result.title}</div>
                        {result.snippet && (
                          <div className="global-search-item-snippet">{result.snippet}</div>
                        )}
                      </div>
                      <span className="global-search-item-type">
                        {TYPE_LABELS[result.type] ?? result.type.toUpperCase()}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        ) : (
          <div className="global-search-empty global-search-empty--hint">
            TYPE TO SEARCH · ENTER TO SELECT · ↑↓ TO NAVIGATE
          </div>
        )}
      </div>
    </>
  );
};
