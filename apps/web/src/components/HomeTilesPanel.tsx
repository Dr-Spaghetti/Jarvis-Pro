import { useCallback, useEffect, useState } from "react";

import { apiFetch } from "../runtime/apiClient";
import { buildTilesUrl } from "../runtime/runtimeEndpoints";
import { PanelState } from "./ui/PanelState";

type HomeTile = {
  id: string;
  title: string;
  status: "ok" | "not-configured" | "error";
  value: string | number | null;
  unit?: string;
  detail?: string;
};

type TilesResponse = { tiles: HomeTile[]; generatedAt: string };

const formatGeneratedAt = (iso: string): string => {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toLocaleTimeString();
};

const STATUS_TEXT: Record<HomeTile["status"], string> = {
  ok: "",
  "not-configured": "Not configured",
  error: "Unavailable",
};

export const HomeTilesPanel = () => {
  const [tiles, setTiles] = useState<HomeTile[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTiles = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await apiFetch(buildTilesUrl(), { headers: { Accept: "application/json" } });
      if (!response.ok) {
        setError("Failed to load home tiles.");
        return;
      }
      const data = (await response.json()) as Partial<TilesResponse>;
      setTiles(Array.isArray(data.tiles) ? data.tiles : []);
      setGeneratedAt(typeof data.generatedAt === "string" ? data.generatedAt : "");
    } catch {
      setError("Network error loading home tiles.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchTiles();
  }, [fetchTiles]);

  return (
    <section className="jarvis-panel jarvis-tiles" aria-label="Home tiles">
      <div className="jarvis-tiles-header">
        <p className="jarvis-panel-title">📊 Today</p>
        <div className="jarvis-tiles-meta">
          {generatedAt && !error ? (
            <span className="jarvis-tiles-fresh">as of {formatGeneratedAt(generatedAt)}</span>
          ) : null}
          <button
            aria-label="Refresh home tiles"
            className="jarvis-tiles-refresh"
            onClick={() => void fetchTiles()}
            type="button"
          >
            ↻
          </button>
        </div>
      </div>

      {isLoading && <PanelState state="loading" message="Loading tiles…" />}

      {!isLoading && error && (
        <PanelState state="error" message={error} onRetry={() => void fetchTiles()} />
      )}

      {!isLoading && !error && (
        <div className="jarvis-tiles-grid">
          {tiles.map((tile) => (
            <article
              className="jarvis-tile"
              data-status={tile.status}
              key={tile.id}
              title={tile.detail ?? undefined}
            >
              <span className="jarvis-tile-title">{tile.title}</span>
              {tile.status === "ok" ? (
                <span className="jarvis-tile-value">
                  {tile.value}
                  {tile.unit ? <span className="jarvis-tile-unit"> {tile.unit}</span> : null}
                </span>
              ) : (
                <span className="jarvis-tile-status">{STATUS_TEXT[tile.status]}</span>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
};
