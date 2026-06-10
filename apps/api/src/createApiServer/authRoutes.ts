import type { ApiRouteHandler } from "./routeHelpers";
import { writeJson, writeMethodNotAllowed, writeNoContent } from "./routeHelpers";

// Public (exempt from the auth gate) so the web UI can discover whether it
// needs to prompt for a token before any authorized call is possible.
export const handleAuthStatusRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { authToken },
) => {
  if (requestUrl.pathname !== "/api/auth/status") {
    return false;
  }

  if (request.method !== "GET") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  writeJson(response, 200, { authRequired: authToken !== null }, corsOrigin);
  return true;
};

// Sits behind the auth gate: reaching this handler proves the supplied
// credentials are valid (or that auth is disabled), so it always replies 204.
// Invalid tokens are rejected with 401 by the gate before routing.
export const handleAuthVerifyRoute: ApiRouteHandler = async ({
  request,
  response,
  requestUrl,
  corsOrigin,
}) => {
  if (requestUrl.pathname !== "/api/auth/verify") {
    return false;
  }

  if (request.method !== "POST") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  writeNoContent(response, 204, corsOrigin);
  return true;
};
