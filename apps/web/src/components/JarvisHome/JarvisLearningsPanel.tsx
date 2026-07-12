import { useCallback, useEffect, useState } from "react";

import { apiFetch } from "../../runtime/apiClient";
import { buildBrainLearningDeleteUrl, buildBrainLearningsUrl } from "../../runtime/runtimeEndpoints";

type Learning = {
  id: string;
  content: string;
  timestamp: number;
};

export const JarvisLearningsPanel = () => {
  const [learnings, setLearnings] = useState<Learning[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await apiFetch(buildBrainLearningsUrl());
      if (!res.ok) { setLoadError(true); return; }
      const data = (await res.json()) as { learnings: Learning[] };
      setLearnings(data.learnings ?? []);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleDelete = useCallback(
    async (id: string) => {
      setDeleting(id);
      try {
        await apiFetch(buildBrainLearningDeleteUrl(id), { method: "DELETE" });
        setLearnings((prev) => prev.filter((l) => l.id !== id));
      } catch {
        // ignore
      } finally {
        setDeleting(null);
      }
    },
    [],
  );

  return (
    <div className="nc-hq-learnings-panel">
      <div className="nc-hq-learnings-header">
        <span className="nc-hq-learnings-title">WHAT JARVIS KNOWS ABOUT YOU</span>
        <span className="nc-hq-learnings-count">{learnings.length} facts</span>
      </div>
      {loading ? (
        <div className="nc-hq-learnings-empty">Loading...</div>
      ) : loadError ? (
        <div className="nc-hq-learnings-error">
          Failed to load.{" "}
          <button type="button" className="nc-hq-learnings-retry" onClick={() => void load()}>Retry</button>
        </div>
      ) : learnings.length === 0 ? (
        <div className="nc-hq-learnings-empty">No learned facts yet — Jarvis learns automatically from your conversations.</div>
      ) : (
        <ul className="nc-hq-learnings-list">
          {learnings.map((l) => (
            <li key={l.id} className="nc-hq-learnings-item">
              <span className="nc-hq-learnings-text">{l.content}</span>
              <button
                type="button"
                className="nc-hq-learnings-delete"
                disabled={deleting === l.id}
                onClick={() => void handleDelete(l.id)}
                title="Delete this fact"
              >
                {deleting === l.id ? "..." : "✕"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
