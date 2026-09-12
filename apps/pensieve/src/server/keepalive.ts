/**
 * SSE keepalive for Ask's streaming response. A run can go quiet for a long stretch — a
 * long generation, a slow tool — and anything between the browser and Bun with an idle
 * limit (a tailscale proxy, a load balancer) would close the socket and the page would
 * show "Stream response body read failed". A comment line (`: ping`) every `everyMs`
 * keeps bytes flowing; SSE clients ignore comments, so the chunk stream is unchanged.
 *
 * Bun's own limit is lifted in server.ts (`idleTimeout: 0`); this covers whatever sits
 * in front of it.
 */

export const KEEPALIVE_MS = 15_000;

const PING = new TextEncoder().encode(": ping\n\n");

/** The same response, its body interleaved with a `: ping` comment every `everyMs`. */
export function withKeepalive(
  response: Response,
  everyMs = KEEPALIVE_MS
): Response {
  const upstream = response.body;
  if (!upstream) {
    return response;
  }
  const reader = upstream.getReader();
  let timer: ReturnType<typeof setInterval> | undefined;
  const stop = () => {
    if (timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  };
  const body = new ReadableStream<Uint8Array>({
    cancel(reason) {
      stop();
      return reader.cancel(reason);
    },
    async pull(controller) {
      let result: Awaited<ReturnType<typeof reader.read>>;
      try {
        result = await reader.read();
      } catch (e) {
        stop();
        controller.error(e);
        return;
      }
      if (result.done) {
        stop();
        controller.close();
        return;
      }
      controller.enqueue(result.value);
    },
    start(controller) {
      timer = setInterval(() => {
        try {
          controller.enqueue(PING);
        } catch {
          // closed or errored between the check and the enqueue: nothing to keep alive
          stop();
        }
      }, everyMs);
    },
  });
  return new Response(body, {
    headers: response.headers,
    status: response.status,
    statusText: response.statusText,
  });
}
