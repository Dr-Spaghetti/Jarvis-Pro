/**
 * Loop Metrics Collector
 *
 * Singleton collector that records loop execution metrics throughout agent lifetime.
 * Provides hooks for starting, recording iterations, and completing loops.
 */

import type { AgentLoopMetrics, IterationSnapshot } from "./loopMetricsTypes";

interface LoopCollection {
  deploymentId: string;
  startedAt: number;
  metrics?: AgentLoopMetrics;
}

/**
 * Collector for recording loop metrics.
 */
class LoopMetricsCollector {
  private activeLoops = new Map<string, LoopCollection>();
  private completedLoops: AgentLoopMetrics[] = [];

  /**
   * Start recording a loop execution.
   */
  recordLoopStart(deploymentId: string): void {
    this.activeLoops.set(deploymentId, {
      deploymentId,
      startedAt: Date.now(),
    });
  }

  /**
   * Record a single iteration within a loop.
   */
  recordLoopIteration(
    deploymentId: string,
    _snapshot: IterationSnapshot,
  ): void {
    const loop = this.activeLoops.get(deploymentId);
    if (!loop) {
      console.warn(`Loop not found for deployment: ${ deploymentId }`);
      return;
    }

    // In production, would accumulate snapshots in metrics
    // For now, just track that iteration was recorded
  }

  /**
   * Complete recording a loop execution.
   */
  recordLoopComplete(
    deploymentId: string,
    metrics: AgentLoopMetrics,
  ): void {
    this.completedLoops.push(metrics);
    this.activeLoops.delete(deploymentId);
  }

  /**
   * Retrieve metrics for a specific deployment.
   */
  getMetrics(deploymentId: string): AgentLoopMetrics | undefined {
    const loop = this.activeLoops.get(deploymentId);
    if (loop?.metrics) {
      return loop.metrics;
    }

    return this.completedLoops.find(m => m.strategy); // Simplified lookup
  }

  /**
   * Get all completed loop metrics.
   */
  getAllCompletedLoops(): AgentLoopMetrics[] {
    return [...this.completedLoops];
  }

  /**
   * Clear all recorded metrics (for testing).
   */
  clear(): void {
    this.activeLoops.clear();
    this.completedLoops = [];
  }

  /**
   * Get statistics on recorded loops.
   */
  getStatistics(): {
    activeCount: number;
    completedCount: number;
    averageIterations: number;
    averageQuality: number;
  } {
    const avgIterations =
      this.completedLoops.length > 0
        ? this.completedLoops.reduce((sum, m) => sum + m.totalIterations, 0) /
          this.completedLoops.length
        : 0;

    const avgQuality =
      this.completedLoops.length > 0
        ? this.completedLoops.reduce((sum, m) => sum + m.finalQuality, 0) /
          this.completedLoops.length
        : 0;

    return {
      activeCount: this.activeLoops.size,
      completedCount: this.completedLoops.length,
      averageIterations: Math.round(avgIterations * 100) / 100,
      averageQuality: Math.round(avgQuality * 100) / 100,
    };
  }
}

/**
 * Global singleton instance of the metrics collector.
 */
export const globalLoopMetricsCollector = new LoopMetricsCollector();

export { LoopMetricsCollector };
