import { useMemo } from "react";

import {
  GITHUB_SPARKLINE_HEIGHT,
  GITHUB_SPARKLINE_WIDTH,
} from "../constants";
import {
  buildGitHubCommitSeries,
  buildGitHubCommitSparkPoints,
  buildGitHubSparkPolylinePoints,
} from "../githubMetrics";
import type { GitHubRepoSummarySnapshot } from "../types";

export const useGitHubSparkline = (githubRepoSummary: GitHubRepoSummarySnapshot | null): string => {
  const commitSeries = useMemo(
    () => buildGitHubCommitSeries(githubRepoSummary),
    [githubRepoSummary],
  );
  const sparklineSeries = useMemo(
    () => buildGitHubCommitSparkPoints(commitSeries, GITHUB_SPARKLINE_WIDTH, GITHUB_SPARKLINE_HEIGHT),
    [commitSeries],
  );
  return useMemo(() => buildGitHubSparkPolylinePoints(sparklineSeries), [sparklineSeries]);
};
