/**
 * SingleFlight utility for Request Coalescing.
 * Prevents Cache Stampede by ensuring that for a given key,
 * only one asynchronous execution runs at a time while concurrent callers share the result.
 */
export class SingleFlight {
  private inFlight = new Map<string, Promise<any>>();

  /**
   * Executes or coalesces the provided async function for the given key.
   */
  async do<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key);
    if (existing) {
      return existing as Promise<T>;
    }

    const promise = (async () => {
      try {
        return await fn();
      } finally {
        this.inFlight.delete(key);
      }
    })();

    this.inFlight.set(key, promise);
    return promise;
  }
}
