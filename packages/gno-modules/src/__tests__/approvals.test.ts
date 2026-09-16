import {
  describe, expect, it,
} from "vitest";

import {
  MessagesModule,
} from "../messages/index.js";
import {
  PackagesModule,
} from "../packages/index.js";
import {
  harness, install,
} from "./harness.js";

const enableEvent = {
  value: {
    msg: {
      approver: "g1approver",
      pkgPath: "gno.land/r/demo/parked",
      pkgHash: "abc123",
      pkgHeight: 51996n,
    },
    txHash: "AA",
    msgIndex: 0,
    events: [],
    tx: {
    },
  },
  height: 800,
  timestamp: "2026-09-12T17:00:00.000Z",
};

const rejectEvent = {
  value: {
    msg: {
      sender: "g1approver",
      pkgPath: "gno.land/r/demo/bad",
    },
    txHash: "BB",
    msgIndex: 1,
    events: [],
    tx: {
    },
  },
  height: 801,
  timestamp: "2026-09-12T17:00:01.000Z",
};

describe("package approvals", () => {
  it("MessagesModule records enables and rejects in their own tables", async () => {
    const h = harness();
    install(h, new MessagesModule());

    await h.dispatch("/vm.m_enable_pkg", enableEvent);
    await h.dispatch("/vm.m_reject_pkg", rejectEvent);

    expect(h.calls("add-vm-enable-pkg")).toEqual([[800, "AA", 0, "g1approver", "gno.land/r/demo/parked", "abc123", "51996", "2026-09-12T17:00:00.000Z"]]);
    expect(h.calls("add-vm-reject-pkg")).toEqual([[801, "BB", 1, "g1approver", "gno.land/r/demo/bad", "2026-09-12T17:00:01.000Z"]]);
  });

  it("PackagesModule marks the parked package enabled or rejected", async () => {
    const h = harness();
    install(h, new PackagesModule());

    await h.dispatch("/vm.m_enable_pkg", enableEvent);
    await h.dispatch("/vm.m_reject_pkg", rejectEvent);

    expect(h.calls("enable-package")).toEqual([["gno.land/r/demo/parked", 800, "AA", "g1approver", "abc123", "51996"]]);
    expect(h.calls("reject-package")).toEqual([["gno.land/r/demo/bad", 801, "BB", "g1approver"]]);
  });

  it("stores an empty hash as null", async () => {
    const h = harness();
    install(h, new MessagesModule());
    await h.dispatch("/vm.m_enable_pkg", {
      ...enableEvent,
      value: {
        ...enableEvent.value,
        msg: {
          ...enableEvent.value.msg,
          pkgHash: "",
        },
      },
    });
    expect(h.calls("add-vm-enable-pkg")[0][5]).toBeNull();
  });
});
