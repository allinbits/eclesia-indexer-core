import { vi, describe, it, expect } from "vitest";
import { callABCI } from "./abci";
import { setStatus } from "../healthcheck";
import { tmClient } from "../ws";

// filepath: /Users/clockwork/Documents/Tendermint/eclesia-indexer-core/packages/indexer/src/utils/abci.test.ts

vi.mock("../healthcheck", () => ({
  setStatus: vi.fn()
}));

vi.mock("../ws", () => ({
  tmClient: Promise.resolve({
    abciQuery: vi.fn()
  })
}));

describe("callABCI", () => {
  it("should return the value from abciQuery on success", async () => {
    const mockAbciQuery = vi.fn().mockResolvedValue({ value: "mockValue" });
    (await tmClient).abciQuery = mockAbciQuery;

    const result = await callABCI("mockPath", new Uint8Array([1, 2, 3]), 123);
    expect(result).toBe("mockValue");
    expect(mockAbciQuery).toHaveBeenCalledWith({
      path: "mockPath",
      data: new Uint8Array([1, 2, 3]),
      height: 123
    });
  });

  it("should throw an error and set status to FAILED on timeout", async () => {
    const mockAbciQuery = vi.fn().mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 5000)) // Simulate delay
    );
    (await tmClient).abciQuery = mockAbciQuery;

    await expect(
      callABCI("mockPath", new Uint8Array([1, 2, 3]))
    ).rejects.toThrow("ws not responding");
    expect(setStatus).toHaveBeenCalledWith("ws", "FAILED");
  });

  it("should throw an error and set status to FAILED if abciQuery returns undefined", async () => {
    const mockAbciQuery = vi.fn().mockResolvedValue(undefined);
    (await tmClient).abciQuery = mockAbciQuery;

    await expect(
      callABCI("mockPath", new Uint8Array([1, 2, 3]))
    ).rejects.toThrow("ws not responding");
    expect(setStatus).toHaveBeenCalledWith("ws", "FAILED");
  });
}, {
  timeout: 6000 // Increase timeout for the test suite
});