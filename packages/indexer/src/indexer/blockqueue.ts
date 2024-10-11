/*
  This implements an "infinite" FIFO queue of fixed size.
  await `continue()` before enqueing items to ensure fixed size (as it only resolves when space available)
  await `dequeue()` to pop an item  as it will only resolve if the next item is available
  size() is always at minimum 1 item which is the promise that will resolve to the next item whenever it is enqueued
*/

export default class Queue<T> {
  private items: Array<Promise<T>>;
  private enqueuer!: (val: T | PromiseLike<T>) => void;
  private batcher!: (val: boolean) => void;
  public synced = false;
  private batchSize: number;
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
    this.enqueuer(item);
    const nextVal = new Promise<T>((resolve, _reject) => {
      this.enqueuer = resolve;
    });
    this.items.unshift(nextVal);
    if (this.size() >= this.batchSize) {
      this.continuePromise = new Promise<boolean>((resolve, _reject) => {
        this.batcher = resolve;
      });
    }
  }
  dequeue() {
    const item = this.items.pop();
    if (this.size() < this.batchSize) {
      this.batcher(true);
    }

    return item as Promise<T>;
  }
  head() {
    return this.items[this.items.length - 1];
  }
  tail() {
    return this.items[0];
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
    } else {
      return false;
    }
  }
  size() {
    return this.items.length;
  }
}
