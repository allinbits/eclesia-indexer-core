import {
  ConfigurationError,
} from "@eclesia/indexer-engine";
import {
  beforeEach, describe, expect, it, vi,
} from "vitest";

import {
  PgIndexer,
} from "../index";
import {
  createMockModule,
  createTestConfig, MockClient,
} from "./test-setup";

/**
 * Tests for PgIndexer constructor, validation, and module management
 */

// Create shared mock client instance
const mockClient: MockClient = {
  connect: vi.fn().mockResolvedValue(undefined),
  query: vi.fn(),
  end: vi.fn().mockResolvedValue(undefined),
  on: vi.fn(),
};

// Mock the pg Client
vi.mock("pg", () => ({
  Client: vi.fn(function () { return mockClient; }),
}));

// Mock the EclesiaIndexer
vi.mock("@eclesia/indexer-engine", async () => {
  const actual = await vi.importActual<typeof import("@eclesia/indexer-engine")>("@eclesia/indexer-engine");
  return {
    ...actual,
    EclesiaIndexer: vi.fn().mockImplementation(function () {
      return {
        log: {
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
          verbose: vi.fn(),
          debug: vi.fn(),
          silly: vi.fn(),
        },
        connect: vi.fn().mockResolvedValue(true),
        start: vi.fn().mockResolvedValue(undefined),
        whenStopped: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
      };
    }),
  };
});

describe("PgIndexer Constructor and Validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClient.connect.mockResolvedValue(undefined);
    mockClient.query.mockResolvedValue({
      rows: [],
      rowCount: 0,
    });
    mockClient.end.mockResolvedValue(undefined);
  });

  describe("Constructor", () => {
    it("should create a PgIndexer instance with valid config", () => {
      const config = createTestConfig();
      const indexer = new PgIndexer(config);
      expect(indexer).toBeInstanceOf(PgIndexer);
      expect(indexer.modules).toBeDefined();
      expect(indexer.indexer).toBeDefined();
    });

    it("should throw ConfigurationError for invalid connection string", () => {
      const config = createTestConfig();
      const invalidConfig = {
        ...config,
        dbConnectionString: "invalid-connection-string",
      };
      expect(() => new PgIndexer(invalidConfig)).toThrow(ConfigurationError);
    });

    it("should throw ConfigurationError for empty connection string", () => {
      const config = createTestConfig();
      const invalidConfig = {
        ...config,
        dbConnectionString: "",
      };
      expect(() => new PgIndexer(invalidConfig)).toThrow(ConfigurationError);
    });

    it("should accept postgresql:// prefix in connection string", () => {
      const config = createTestConfig();
      const validConfig = {
        ...config,
        dbConnectionString: "postgresql://user:pass@localhost:5432/testdb",
      };
      expect(() => new PgIndexer(validConfig)).not.toThrow();
    });

    it("should accept postgres:// prefix in connection string", () => {
      const config = createTestConfig();
      const validConfig = {
        ...config,
        dbConnectionString: "postgres://user:pass@localhost:5432/testdb",
      };
      expect(() => new PgIndexer(validConfig)).not.toThrow();
    });

    it("should register event listeners on database client", () => {
      const config = createTestConfig();
      new PgIndexer(config);
      expect(mockClient.on).toHaveBeenCalledWith("end", expect.any(Function));
      expect(mockClient.on).toHaveBeenCalledWith("error", expect.any(Function));
    });
  });

  describe("Module Management", () => {
    it("should initialize modules passed in constructor", () => {
      const config = createTestConfig();
      const mockModule = createMockModule("test-module");

      const indexer = new PgIndexer(config, [mockModule]);
      expect(mockModule.init).toHaveBeenCalledWith(indexer);
      expect(indexer.modules["test-module"]).toBe(mockModule);
    });

    it("should add modules via addModules method", () => {
      const config = createTestConfig();
      const indexer = new PgIndexer(config);
      const mockModule = createMockModule("test-module");

      indexer.addModules([mockModule]);
      expect(mockModule.init).toHaveBeenCalledWith(indexer);
      expect(indexer.modules["test-module"]).toBe(mockModule);
    });

    it("should initialize multiple modules", () => {
      const config = createTestConfig();
      const mockModule1 = createMockModule("module-1");
      const mockModule2 = createMockModule("module-2");

      const indexer = new PgIndexer(config, [mockModule1, mockModule2]);
      expect(mockModule1.init).toHaveBeenCalledWith(indexer);
      expect(mockModule2.init).toHaveBeenCalledWith(indexer);
      expect(indexer.modules["module-1"]).toBe(mockModule1);
      expect(indexer.modules["module-2"]).toBe(mockModule2);
    });

    it("should create indexer with modules using withModules factory", () => {
      const config = createTestConfig();
      const mockModule = createMockModule("test-module");

      const indexer = PgIndexer.withModules(config, [mockModule]);
      expect(mockModule.init).toHaveBeenCalledWith(indexer);
      expect(indexer.modules["test-module"]).toBe(mockModule);
    });
  });

  describe("module registration guards", () => {
    it("rejects a duplicate module name", () => {
      const indexer = new PgIndexer(createTestConfig(), [createMockModule("dup")]);
      expect(() => indexer.addModules([createMockModule("dup")])).toThrow("already registered");
    });

    it("rejects modules added after setup()", async () => {
      const indexer = new PgIndexer(createTestConfig(), [createMockModule("early")]);
      await indexer.setup();
      expect(() => indexer.addModules([createMockModule("late")])).toThrow("before setup()");
    });
  });
});
