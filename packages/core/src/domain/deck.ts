export type DeckTentacleStatus = "idle" | "active" | "blocked" | "needs-review";

export type DeckOctopusAppearance = {
  animation: string | null;
  /** Valid: "normal" | "happy" | "angry" | "surprised". "sleepy" is reserved for idle state — never assign on creation. */
  expression: string | null;
  accessory: string | null;
  hairColor: string | null;
};

export type DeckAvailableSkill = {
  name: string;
  description: string;
  /**
   * Where the skill comes from:
   * - "project": installed in the workspace's `.claude/skills/`
   * - "user": installed in the user's global Claude skills
   * - "bundled": shipped with Octogent's skills catalog and always available
   *   inside the dashboard without being copied into the workspace
   */
  source: "project" | "user" | "bundled";
  /** Environment variables the skill needs to function (bundled skills only). */
  requiredEnv?: string[];
  /** Subset of `requiredEnv` that is currently unset in the API process. */
  missingEnv?: string[];
};

export type DeckTentacleSummary = {
  tentacleId: string;
  displayName: string;
  description: string;
  status: DeckTentacleStatus;
  color: string | null;
  octopus: DeckOctopusAppearance;
  scope: {
    paths: string[];
    tags: string[];
  };
  vaultFiles: string[];
  todoTotal: number;
  todoDone: number;
  todoItems: { text: string; done: boolean }[];
  suggestedSkills: string[];
  lastOpenedAt?: string | null;
  openCount?: number;
  pinned?: boolean;
};
