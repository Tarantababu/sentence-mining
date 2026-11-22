export function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { "cache-control": "private, no-store" },
  });
}

export function errorJson(message: string, status: number): Response {
  return json({ error: message }, status);
}
