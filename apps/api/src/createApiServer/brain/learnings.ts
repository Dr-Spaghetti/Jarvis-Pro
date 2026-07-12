import { join } from "node:path";

import { deleteLearning, initDb, listAllLearnings } from "../db";
import type { ApiRouteHandler } from "../routeHelpers";
import { writeJson, writeMethodNotAllowed } from "../routeHelpers";

const LIST_PATTERN = /^\/api\/brain\/learnings$/;
const ITEM_PATTERN = /^\/api\/brain\/learnings\/([^/]+)$/;

export const handleBrainLearningsRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { projectStateDir },
) => {
  const itemMatch = requestUrl.pathname.match(ITEM_PATTERN);
  const isList = LIST_PATTERN.test(requestUrl.pathname);
  if (!isList && !itemMatch) return false;

  initDb(join(projectStateDir, "state"));

  if (isList) {
    if (request.method !== "GET") { writeMethodNotAllowed(response, corsOrigin); return true; }
    writeJson(response, 200, { learnings: listAllLearnings() }, corsOrigin);
    return true;
  }

  // Item route — DELETE /:id
  const id: string = itemMatch![1] as string;
  if (request.method !== "DELETE") { writeMethodNotAllowed(response, corsOrigin); return true; }
  const deleted = deleteLearning(id);
  writeJson(response, deleted ? 200 : 404, deleted ? { ok: true } : { error: "Learning not found" }, corsOrigin);
  return true;
};
