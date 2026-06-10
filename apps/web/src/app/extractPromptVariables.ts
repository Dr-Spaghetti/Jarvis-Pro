const VARIABLE_PATTERN = /\{\{(\w+)\}\}/g;

/**
 * Extract unique variable names from `{{var}}` placeholders in a template string.
 * Returns names in the order they first appear.
 */
export const extractPromptVariables = (content: string): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const match of content.matchAll(VARIABLE_PATTERN)) {
    const name = match[1];
    if (name && !seen.has(name)) {
      seen.add(name);
      result.push(name);
    }
  }
  return result;
};

/**
 * Interpolate `{{var}}` placeholders with values. Unknown placeholders stay as-is.
 */
export const interpolatePromptVariables = (
  template: string,
  variables: Record<string, string>,
): string => template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => variables[key] ?? match);
