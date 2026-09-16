import {
  describe, expect, it,
} from "vitest";

import {
  gnoAddress,
} from "../helpers.js";
import {
  ValidatorsModule,
} from "../validators/index.js";
import {
  harness, install,
} from "./harness.js";

const address = (index: number) => {
  const bytes = new Uint8Array(20);
  bytes[0] = 0xa0 + index;
  bytes[19] = 0x02;
  return gnoAddress(bytes);
};

describe("ValidatorsModule", () => {
  it("records every validator of a first block with its power", async () => {
    const h = harness();
    install(h, new ValidatorsModule());
    h.query.mockImplementation(async (sql: unknown) => ({
      rows: typeof sql === "string" && sql.startsWith("SELECT address, voting_power") ? [] : [],
      rowCount: 1,
    }));

    await h.processBlock(1);

    const upserts = h.calls("upsert-validator");
    expect(upserts.map(u => u[0])).toEqual([address(0), address(1), address(2)]);
    expect(upserts.map(u => u[2])).toEqual(["10", "20", "30"]);
    expect(upserts.every(u => u[3] === 1)).toBe(true);
    expect(JSON.parse(upserts[0][1] as string).algorithm).toBe("ed25519");
    expect(h.calls("add-validator-power").length).toBe(3);
    expect(h.calls("touch-validators")[0]).toEqual([[address(0), address(1), address(2)], 1]);
    expect(h.calls("deactivate-validator").length).toBe(0);
  });

  it("records only changes when the set is already known, and deactivates leavers", async () => {
    const h = harness();
    install(h, new ValidatorsModule());
    h.query.mockImplementation(async (sql: unknown) => ({
      rows: typeof sql === "string" && sql.startsWith("SELECT address, voting_power")
        ? [
          {
            address: address(0),
            voting_power: "10",
          },
          {
            address: address(1),
            voting_power: "25",
          },
          {
            address: address(9),
            voting_power: "5",
          },
        ]
        : [],
      rowCount: 1,
    }));

    await h.processBlock(8);

    // validator 0 unchanged, 1 changed power, 2 is new, 9 left
    expect(h.calls("upsert-validator").map(u => u[0])).toEqual([address(2)]);
    expect(h.calls("update-validator-power")).toEqual([[address(1), "20"]]);
    expect(h.calls("deactivate-validator")).toEqual([[address(9)]]);
    expect(h.calls("add-validator-power")).toEqual([[address(1), 8, "20"], [address(2), 8, "30"], [address(9), 8, "0"]]);
  });

  it("warns once and records nothing in minimal mode", async () => {
    const h = harness();
    install(h, new ValidatorsModule());

    await h.processBlock(2, {
      minimal: true,
    });
    await h.processBlock(3, {
      minimal: true,
    });

    expect(h.warn).toHaveBeenCalledTimes(1);
    expect(h.query).not.toHaveBeenCalled();
  });
});
