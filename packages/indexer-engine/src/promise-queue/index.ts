/**
 * Implements an "infinite" FIFO queue of fixed size using promises
 * - await `continue()` before enqueing items to ensure fixed size (resolves when space available)
 * - await `dequeue()` to pop an item (resolves when next item is available)
 * - size() is always at minimum 1 item which is the promise for the next enqueued item
 */
export class PromiseQueue<T> {
  /** Array of promises representing queued items */
  private items: Array<Promise<T>>;

  /** Function to resolve the next enqueued promise */
  private enqueuer!: (val: T | PromiseLike<T>) => void;

  /** Function to resolve the continue promise when space is available */
  private batcher!: (val: boolean) => void;

  /** Flag indicating if the queue is synced with the data source */
  public synced = false;

  /** Maximum number of items to keep in the queue */
  private batchSize: number;

  /** Promise that resolves when it's safe to enqueue more items */
  private continuePromise: Promise<boolean>;

  constructor(batchSize: number) {
    const nextVal = new Promise<T>((resolve, _reject) => {
      this.enqueuer = resolve;
    });
    this.batchSize = batchSize;
    this.continuePromise = new Promise<boolean>((resolve, _reject) => {
      this.batcher = resolve;
    });
    this.batcher(true);
    this.items = [nextVal];
  }

  enqueue(item: T | PromiseLike<T>) {
    try {
      this.enqueuer(item);
      const nextVal = new Promise<T>((resolve, _reject) => {
        this.enqueuer = resolve;
      });
      this.items.push(nextVal);
      if (this.size() > this.batchSize) {
        this.continuePromise = new Promise<boolean>((resolve, _reject) => {
          this.batcher = resolve;
        });
      }
    }
    catch (e) {
      console.error("Enqueing rejected data: " + e);
    }
  }

  clear() {
    const nextVal = new Promise<T>((resolve, _reject) => {
      this.enqueuer = resolve;
    });
    this.continuePromise = new Promise<boolean>((resolve, _reject) => {
      this.batcher = resolve;
    });
    this.batcher(true);
    this.items = [nextVal];
  }

  dequeue() {
    const item = this.items.shift();
    if (this.size() <= this.batchSize) {
      this.batcher(true);
    }

    return item as Promise<T>;
  }

  continue() {
    return this.continuePromise;
  }

  setSynced() {
    this.synced = true;
  }

  isEmpty() {
    if (this.items.length == 0) {
      return true;
    }
    else {
      return false;
    }
  }

  size() {
    return this.items.length;
  }
}

/**
 * Circular buffer implementation using promises for efficient memory usage
 * Reuses array slots in a circular fashion to maintain constant memory footprint
 * Used by the indexer for managing block processing queues
 */
export class CircularBuffer<T> {
  /** Fixed-size array of promises representing buffered items */
  private items: Array<Promise<T>>;

  /** Function to resolve the next enqueued promise */
  private enqueuer!: (val: T | PromiseLike<T>) => void;

  /** Current number of items in the buffer */
  private count: number = 0;

  /** Index of the next item to dequeue */
  private next: number = 0;

  /** Function to resolve the continue promise when space is available */
  private batcher!: (val: boolean) => void;

  /** Flag indicating if the buffer is synced with the data source */
  public synced = false;

  /** Maximum number of items the buffer can hold */
  private batchSize: number;

  /** Promise that resolves when it's safe to enqueue more items */
  private continuePromise: Promise<boolean>;

  /** Index of the next available slot for enqueueing */
  private nextAvail: number = 0;

  constructor(batchSize: number) {
    if (batchSize <= 1) {
      throw new Error("Batch size must be greater than 1");
    }
    const nextVal = new Promise<T>((resolve, _reject) => {
      this.enqueuer = resolve;
    });
    this.items = new Array<Promise<T>>(batchSize);
    this.batchSize = batchSize;
    this.items[this.nextAvail] = nextVal;
    this.count = 1;
    this.nextAvail++;
    if (this.nextAvail >= this.batchSize) {
      this.nextAvail = 0;
    }

    this.continuePromise = new Promise<boolean>((resolve, _reject) => {
      this.batcher = resolve;
    });
    this.batcher(true);
  }

  enqueue(item: T | PromiseLike<T>) {
    try {
      this.enqueuer(item);
      const nextVal = new Promise<T>((resolve, _reject) => {
        this.enqueuer = resolve;
      });
      this.items[this.nextAvail] = nextVal;
      this.count++;
      this.nextAvail++;
      if (this.nextAvail >= this.batchSize) {
        this.nextAvail = 0;
      }

      if (this.nextAvail == this.next) {
        this.continuePromise = new Promise<boolean>((resolve, _reject) => {
          this.batcher = resolve;
        });
      }
    }
    catch (e) {
      console.error("Enqueing rejected data: " + e);
    }
  }

  dequeue() {
    const item = this.items[this.next];
    this.next++;
    this.count--;
    if (this.next >= this.batchSize) {
      this.next = 0;
    }
    if (this.count <= this.batchSize) {
      this.batcher(true);
    }
    return item;
  }

  clear() {
    this.next = 0;
    this.nextAvail = 0;
    const nextVal = new Promise<T>((resolve, _reject) => {
      this.enqueuer = resolve;
    });
    this.items = new Array<Promise<T>>(this.batchSize);
    this.items[this.nextAvail] = nextVal;
    this.synced = false;
    this.count = 1;
    this.nextAvail++;
    if (this.nextAvail >= this.batchSize) {
      this.nextAvail = 0;
    }

    this.continuePromise = new Promise<boolean>((resolve, _reject) => {
      this.batcher = resolve;
    });
    this.batcher(true);
  }

  continue() {
    return this.continuePromise;
  }

  setSynced() {
    this.synced = true;
  }

  isEmpty() {
    if (this.count == 0) {
      return true;
    }
    else {
      return false;
    }
  }

  size() {
    return this.count;
  }
}
