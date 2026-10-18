import "server-only";

/**
 * A simple push/pull async queue — lets discovery push refs as it finds
 * them (page by page) while a pool of scrape workers consumes them
 * concurrently, instead of discovery fully finishing before any scraping
 * starts. For a large store that's the difference between "wait ~10s for
 * every products.json page, then start scraping" and "start scraping page
 * 1's products while page 2 is still being fetched" — a real end-to-end
 * speedup, not just a higher concurrency number.
 */
export class AsyncQueue<T> {
  private buffered: T[] = [];
  private waiters: ((result: IteratorResult<T>) => void)[] = [];
  private closed = false;

  push(item: T): void {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ value: item, done: false });
    } else {
      this.buffered.push(item);
    }
  }

  /** No more items will ever be pushed — every waiting/future `next()` resolves as done once the buffer drains. */
  close(): void {
    this.closed = true;
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift()!;
      waiter({ value: undefined as unknown as T, done: true });
    }
  }

  next(): Promise<IteratorResult<T>> {
    if (this.buffered.length > 0) {
      return Promise.resolve({ value: this.buffered.shift()!, done: false });
    }
    if (this.closed) {
      return Promise.resolve({ value: undefined as unknown as T, done: true });
    }
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return { next: () => this.next() };
  }
}

/**
 * Runs `limit` concurrent workers draining `queue`, each calling `fn` per
 * item — the consumer side of the discovery/scrape pipeline. `shouldStop`
 * is checked before each new item is picked up (not mid-item — an item
 * already being scraped finishes normally rather than being aborted
 * partway), so a cancellation request stops the queue from starting
 * anything NEW without cutting off in-flight work.
 */
export async function drainWithConcurrency<T>(
  queue: AsyncQueue<T>,
  limit: number,
  fn: (item: T) => Promise<void>,
  shouldStop?: () => boolean,
): Promise<void> {
  async function worker() {
    for await (const item of queue) {
      if (shouldStop?.()) break;
      await fn(item);
    }
  }
  await Promise.all(Array.from({ length: limit }, () => worker()));
}
