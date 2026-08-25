import { resolve, sep } from "node:path";

const isInsideRoot = (root: string, candidate: string): boolean => {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  const prefix = resolvedRoot.endsWith(sep) ? resolvedRoot : `${resolvedRoot}${sep}`;
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(prefix);
};

/** Resolve a URL path to a file under webDistDir, or null if it would escape. */
export const resolveSafeStaticPath = (webDistDir: string, pathname: string): string | null => {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  const normalized = decoded.replace(/\\/g, "/");
  if (normalized.includes("\0")) {
    return null;
  }

  const segments = normalized.split("/").filter((segment) => segment.length > 0 && segment !== ".");
  if (segments.some((segment) => segment === "..")) {
    return null;
  }

  const root = resolve(webDistDir);
  const candidate =
    segments.length === 0 ? resolve(root, "index.html") : resolve(root, ...segments);
  if (!isInsideRoot(root, candidate)) {
    return null;
  }

  return candidate;
};
