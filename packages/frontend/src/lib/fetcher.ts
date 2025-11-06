export async function parseApiResponse(res: Response) {
  // If non-2xx, try to extract message from JSON or text
  if (!res.ok) {
    let body;
    try {
      body = await res.json();
    } catch (e) {
      try { body = await res.text(); } catch { body = null; }
    }
    const message = body && (body.message || body.error) || res.statusText || 'Request failed';
    const err = new Error(message);
    // attach useful info for caller
    (err as any).status = res.status;
    (err as any).body = body;
    throw err;
  }

  // Successful response: parse JSON and unwrap .data if present
  let body;
  try {
    body = await res.json();
  } catch (e) {
    const text = await res.text().catch(() => '');
    throw new Error(`Invalid JSON: ${String(text).slice(0,300)}`);
  }

  // Unwrap common backend shapes: prefer `data`, then `details`, otherwise return body
  if (body && Object.prototype.hasOwnProperty.call(body, 'data')) return body.data;
  if (body && Object.prototype.hasOwnProperty.call(body, 'details')) return body.details;
  return body;
}

export default parseApiResponse;
