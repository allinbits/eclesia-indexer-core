import {
  bench, describe,
} from "vitest";

/**
 * Benchmarks for utility functions
 * Measures performance of common operations
 */

describe("String Operations", () => {
  bench("String concatenation - 1000 operations", () => {
    for (let i = 0; i < 1000; i++) {
      const result = "prefix" + i + "suffix";
      void result;
    }
  });

  bench("Template literals - 1000 operations", () => {
    for (let i = 0; i < 1000; i++) {
      const result = `prefix${i}suffix`;
      void result;
    }
  });

  bench("String splitting - 1000 operations", () => {
    const testString = "cosmos.staking.v1beta1.MsgDelegate";

    for (let i = 0; i < 1000; i++) {
      testString.split(".");
    }
  });

  bench("RegExp matching - 1000 operations", () => {
    const regex = /^cosmos1[a-z0-9]{38}$/;
    const validAddress = "cosmos1" + "a".repeat(38);

    for (let i = 0; i < 1000; i++) {
      regex.test(validAddress);
    }
  });
});

describe("Number Operations", () => {
  bench("BigInt arithmetic - 1000 operations", () => {
    let sum = 0n;

    for (let i = 0; i < 1000; i++) {
      sum = sum + BigInt(i);
    }

    return sum;
  });

  bench("Number arithmetic - 1000 operations", () => {
    let sum = 0;

    for (let i = 0; i < 1000; i++) {
      sum = sum + i;
    }

    return sum;
  });

  bench("BigInt string conversion - 1000 operations", () => {
    for (let i = 0; i < 1000; i++) {
      const bigNum = BigInt(i * 1000000);
      bigNum.toString();
    }
  });
});

describe("Object Operations", () => {
  bench("Object spread - 1000 operations", () => {
    const base = {
      a: 1, b: 2, c: 3, d: 4,
    };

    for (let i = 0; i < 1000; i++) {
      const result = {
        ...base, e: i,
      };
      void result;
    }
  });

  bench("Object.assign - 1000 operations", () => {
    const base = {
      a: 1, b: 2, c: 3, d: 4,
    };

    for (let i = 0; i < 1000; i++) {
      const result = Object.assign({}, base, {
        e: i,
      });
      void result;
    }
  });

  bench("JSON parse/stringify - 1000 operations", () => {
    const obj = {
      height: 12345,
      time: "2021-01-01T00:00:00Z",
      chainId: "test-chain",
      hash: "a".repeat(64),
    };

    for (let i = 0; i < 1000; i++) {
      const str = JSON.stringify(obj);
      JSON.parse(str);
    }
  });
});
