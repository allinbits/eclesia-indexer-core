import {
  Mocks, pubKeyAddress,
} from "@eclesia/chain-gno";
import {
  describe, expect, it,
} from "vitest";

import {
  SessionsModule,
} from "../sessions/index.js";
import {
  harness, install,
} from "./harness.js";

describe("SessionsModule", () => {
  it("records a created session with its derived address, limits and expiry", async () => {
    const h = harness();
    install(h, new SessionsModule());

    await h.processBlock(3, {
      node: {
        txPerBlock: 9,
      },
    });

    const [row] = h.calls("add-session");
    expect(row[0]).toBe(pubKeyAddress(Mocks.mockSessionKey()));
    expect(row[0]).toMatch(/^g1/);
    expect(row[1]).toBe(Mocks.syntheticAddress(1));
    expect(row[2]).toBe("/tm.PubKeySecp256k1");
    expect(row[3]).toBe(Buffer.from(new Uint8Array(33).fill(3)).toString("base64"));
    expect(row[4]).toBe(3);
    expect((row[6] as Date).toISOString()).toBe("2027-01-15T08:00:00.000Z");
    expect(row[7]).toEqual([Mocks.MOCK_REALM]);
    expect(row[8]).toBe("1000000ugnot");
    expect(row[9]).toBe("86400");
  });

  it("revokes by key and revokes all, only for the master's active sessions", async () => {
    const h = harness();
    install(h, new SessionsModule());

    await h.processBlock(3, {
      node: {
        txPerBlock: 9,
      },
    });

    const key = Buffer.from(new Uint8Array(33).fill(3)).toString("base64");
    expect(h.calls("revoke-session")).toEqual([[Mocks.syntheticAddress(1), key, 3, expect.stringMatching(/^[0-9A-F]{64}$/)]]);
    expect(h.calls("revoke-all-sessions")).toEqual([[Mocks.syntheticAddress(1), 3, expect.stringMatching(/^[0-9A-F]{64}$/)]]);
  });
});
