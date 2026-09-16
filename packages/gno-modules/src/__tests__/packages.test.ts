import {
  Mocks,
} from "@eclesia/chain-gno";
import {
  describe, expect, it,
} from "vitest";

import {
  PackagesModule,
} from "../packages/index.js";
import {
  harness, install,
} from "./harness.js";

describe("PackagesModule", () => {
  it("registers a deployed realm with its sources", async () => {
    const h = harness();
    install(h, new PackagesModule());

    await h.processBlock(9);

    const [pkg] = h.calls("add-package");
    expect(pkg[0]).toBe(Mocks.MOCK_REALM + "_9");
    expect(pkg[1]).toBe("counter");
    expect(pkg[2]).toBe(Mocks.syntheticAddress(3));
    expect(pkg[3]).toBe(true);
    expect(pkg[4]).toBe(9);
    expect(pkg[5]).toMatch(/^[0-9A-F]{64}$/);
    expect(pkg[6]).toBe(0);
    expect(pkg[7]).toBe(false);
    expect(pkg[8]).toBeNull();
    expect(pkg[10]).toBe("1000000ugnot");
    expect(pkg[11]).toBe(1);

    const [files] = h.calls("add-package-files");
    expect(files[0]).toBe(Mocks.MOCK_REALM + "_9");
    expect(files[1]).toEqual(["counter.gno"]);
    expect((files[2] as string[])[0]).toContain("package counter");
  });

  it("does not store sources for a path that already existed", async () => {
    const h = harness();
    install(h, new PackagesModule());
    h.query.mockResolvedValue({
      rows: [],
      rowCount: 0,
    });

    await h.processBlock(9);

    expect(h.calls("add-package").length).toBe(1);
    expect(h.calls("add-package-files").length).toBe(0);
  });

  it("registers genesis deployments from amino JSON with their metadata", async () => {
    const h = harness();
    install(h, new PackagesModule({
      storeFiles: false,
    }));

    await h.dispatch("gentx/vm.m_addpkg", {
      value: {
        msg: {
          "@type": "/vm.m_addpkg",
          creator: Mocks.syntheticAddress(5),
          package: {
            name: "hello",
            path: "gno.land/p/demo/hello",
            files: [
              {
                name: "hello.gno",
                body: "package hello",
              },
            ],
          },
          send: "",
          max_deposit: "",
        },
        msgIndex: 2,
        tx: {
        },
        metadata: {
          timestamp: "1700000000",
          block_height: "12345",
        },
      },
    });

    const [pkg] = h.calls("add-package");
    expect(pkg[0]).toBe("gno.land/p/demo/hello");
    expect(pkg[3]).toBe(false);
    expect(pkg[4]).toBeNull();
    expect(pkg[5]).toBeNull();
    expect(pkg[6]).toBe(2);
    expect(pkg[7]).toBe(true);
    expect(pkg[8]).toBe(12345);
    expect(pkg[11]).toBe(1);
    expect((pkg[12] as Date).toISOString()).toBe("2023-11-14T22:13:20.000Z");
    expect(h.calls("add-package-files").length).toBe(0);
  });
});
