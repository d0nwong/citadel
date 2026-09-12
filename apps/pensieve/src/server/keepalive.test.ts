import { describe, expect, test } from "bun:test";
import { withKeepalive } from "./keepalive";

const enc = new TextEncoder();
const dec = new TextDecoder();

/** A text/event-stream response that sends `frames` with `gapMs` of silence between them. */
const streaming = (frames: string[], gapMs: number, onCancel?: () => void) =>
  new Response(
    new ReadableStream<Uint8Array>({
      cancel: onCancel,
      async start(c) {
        for (const [i, f] of frames.entries()) {
          if (i > 0) {
            await Bun.sleep(gapMs);
          }
          c.enqueue(enc.encode(f));
        }
        c.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" }, status: 200 }
  );

const readAll = async (res: Response) => {
  const reader = res.body?.getReader();
  if (!reader) {
    throw new Error("no body");
  }
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      return out;
    }
    out += dec.decode(value, { stream: true });
  }
};

describe("withKeepalive", () => {
  test("pings through a quiet stretch and leaves the frames intact and in order", async () => {
    const res = withKeepalive(
      streaming(["data: a\n\n", "data: b\n\n"], 70),
      20
    );
    const out = await readAll(res);
    const a = out.indexOf("data: a\n\n");
    const b = out.indexOf("data: b\n\n");
    const ping = out.indexOf(": ping\n\n");
    expect(a).toBe(0);
    expect(ping).toBeGreaterThan(a);
    expect(ping).toBeLessThan(b);
    expect(out.endsWith("data: b\n\n")).toBe(true);
    // every byte is either a frame or a ping
    expect(out.replaceAll(": ping\n\n", "")).toBe("data: a\n\ndata: b\n\n");
  });

  test("stops pinging once the upstream closes", async () => {
    const res = withKeepalive(streaming(["data: a\n\n"], 0), 10);
    const out = await readAll(res);
    expect(out).toBe("data: a\n\n");
    // a timer left running would throw into the void or keep the loop alive; give it a chance
    await Bun.sleep(40);
  });

  test("keeps the status and headers", () => {
    const res = withKeepalive(streaming([], 0));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
  });

  test("cancelling the wrapped body cancels the upstream", async () => {
    let cancelled = false;
    const res = withKeepalive(
      streaming(["data: a\n\n", "data: b\n\n"], 500, () => {
        cancelled = true;
      }),
      1000
    );
    const reader = res.body?.getReader();
    await reader?.read();
    await reader?.cancel("stop");
    expect(cancelled).toBe(true);
  });

  test("a response without a body is returned as is", () => {
    const res = new Response(null, { status: 204 });
    expect(withKeepalive(res)).toBe(res);
  });
});
