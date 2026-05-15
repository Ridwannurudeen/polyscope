import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchWithTimeout } from "./fetch-timeout";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("fetchWithTimeout", () => {
  it("returns the fetch response when the request completes", async () => {
    const response = new Response("ok", { status: 200 });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response),
    );

    await expect(fetchWithTimeout("/api/test", {}, 1_000)).resolves.toBe(
      response,
    );
  });

  it("rejects when the request exceeds the timeout", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("Aborted", "AbortError"));
            });
          }),
      ),
    );

    const promise = expect(
      fetchWithTimeout("/api/slow", {}, 1_000),
    ).rejects.toThrow("Request timed out after 1000ms");
    await vi.advanceTimersByTimeAsync(1_000);
    await promise;
  });
});
