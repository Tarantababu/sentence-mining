import "server-only";

import { requireIdentity } from "../cursor/identity";
import { errorJson } from "./http";

export type Viewer = {
  sub: string;
  name: string;
  kind: string;
  ownerId: string;
};

export async function requireViewer(request: Request): Promise<Viewer | Response> {
  const identity = await requireIdentity(request);
  if (identity instanceof Response) {
    const body = await identity.text();
    return new Response(body || JSON.stringify({ error: "unauthorized" }), {
      status: identity.status,
      headers: {
        "content-type": identity.headers.get("content-type") || "application/json",
        "cache-control": "private, no-store",
      },
    });
  }
  if (!identity.sub) return errorJson("unauthorized", 401);
  return {
    sub: identity.sub,
    name: identity.name || "",
    kind: identity.kind,
    ownerId: `${identity.sub}:${identity.stage}`,
  };
}
