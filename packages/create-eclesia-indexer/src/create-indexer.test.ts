import * as fs from "node:fs";
import * as path from "node:path";
import {
  fileURLToPath,
} from "node:url";

import {
  describe, expect, it,
} from "vitest";

import {
  generateModulesArray, generateModulesImport, generateModulesInstantiation, modulesFor, ProjectConfig,
} from "./create-indexer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const templates = path.resolve(__dirname, "..", "templates");

const base = (overrides: Partial<ProjectConfig>): ProjectConfig => ({
  projectName: "x",
  chain: "cosmos",
  chainName: "test",
  description: "d",
  rpcEndpoint: "http://localhost:26657",
  chainPrefix: "cosmos",
  minimal: false,
  startHeight: 1,
  queueSize: 10,
  logLevel: "info",
  processGenesis: true,
  genesisPath: null,
  enableHealthcheck: false,
  healthCheckPort: 8888,
  enablePrometheus: false,
  prometheusPort: 9090,
  modules: [],
  packageManager: "pnpm",
  ...overrides,
});

describe("module offers", () => {
  it("offers staking to Cosmos only in full mode with genesis from height 1", () => {
    expect(modulesFor("cosmos", false, true, 1).map(m => m.value)).toEqual(["auth", "bank", "staking"]);
    expect(modulesFor("cosmos", true, true, 1).map(m => m.value)).toEqual(["auth", "bank"]);
    expect(modulesFor("cosmos", false, false, 1).map(m => m.value)).toEqual(["auth", "bank"]);
    expect(modulesFor("cosmos", false, true, 100).map(m => m.value)).toEqual(["auth", "bank"]);
  });

  it("offers validators to gno only in full mode", () => {
    expect(modulesFor("gno", false, false, 500).map(m => m.value)).toEqual(["messages", "packages", "validators"]);
    expect(modulesFor("gno", true, false, 1).map(m => m.value)).toEqual(["messages", "packages"]);
  });
});

describe("generated wiring", () => {
  it("wires Cosmos modules with the protobuf registry", () => {
    const config = base({
      modules: ["Auth", "Bank", "Staking"],
    });
    expect(generateModulesImport(config)).toContain("@eclesia/cosmos-modules-pg");
    expect(generateModulesInstantiation(config)).toContain("new Blocks.FullBlocksModule(registry)");
    expect(generateModulesInstantiation(config)).toContain("new StakingModule(registry)");
    expect(generateModulesArray(config)).toBe("[blocksModule, authModule, bankModule, stakingModule]");
  });

  it("wires gno modules without a registry and drops validators in minimal mode", () => {
    const config = base({
      chain: "gno",
      modules: ["Messages", "Packages", "Validators"],
    });
    expect(generateModulesImport(config)).toBe("import {\n  Blocks,\n  MessagesModule,\n  PackagesModule,\n  ValidatorsModule\n} from \"@eclesia/gno-modules-pg\";\n");
    expect(generateModulesInstantiation(config)).toBe("const blocksModule = new Blocks.FullBlocksModule();\nconst messagesModule = new MessagesModule();\nconst packagesModule = new PackagesModule();\nconst validatorsModule = new ValidatorsModule();");
    expect(generateModulesArray(config)).toBe("[blocksModule, messagesModule, packagesModule, validatorsModule]");

    const minimal = base({
      chain: "gno",
      minimal: true,
      modules: ["Messages", "Validators"],
    });
    expect(generateModulesInstantiation(minimal)).toBe("const blocksModule = new Blocks.MinimalBlocksModule();\nconst messagesModule = new MessagesModule();");
    expect(generateModulesArray(minimal)).toBe("[blocksModule, messagesModule]");
  });
});

describe("templates", () => {
  it("has a manifest and entry point per chain, and the shared files in basic", () => {
    for (const chain of ["cosmos", "gno"]) {
      expect(fs.existsSync(path.join(templates, chain, "package.json.template"))).toBe(true);
      expect(fs.existsSync(path.join(templates, chain, "src", "index.ts.template"))).toBe(true);
    }
    expect(fs.existsSync(path.join(templates, "basic", "package.json.template"))).toBe(false);
    for (const shared of ["tsconfig.json.template", "docker-compose.yml.template", "README.md.template", ".env.template", "_gitignore", "Dockerfile.pnpm"]) {
      expect(fs.existsSync(path.join(templates, "basic", shared))).toBe(true);
    }
  });

  it("uses the chain adapter in both entry points and valid JSON in both manifests", () => {
    const cosmosEntry = fs.readFileSync(path.join(templates, "cosmos", "src", "index.ts.template"), "utf-8");
    expect(cosmosEntry).toContain("chain: cosmos()");
    expect(cosmosEntry).toContain("PgIndexerConfig<CosmosAdapter>");
    const gnoEntry = fs.readFileSync(path.join(templates, "gno", "src", "index.ts.template"), "utf-8");
    expect(gnoEntry).toContain("chain: gno(");
    expect(gnoEntry).toContain("usePolling: true");
    for (const chain of ["cosmos", "gno"]) {
      const manifest = fs.readFileSync(path.join(templates, chain, "package.json.template"), "utf-8")
        .replace(/{{PROJECT_NAME}}/g, "p").replace(/{{DESCRIPTION}}/g, "d").replace(/{{PACKAGE_MANAGER}}/g, "pnpm").replace(/{{CHAIN_NAME}}/g, "c").replace(/{{CHAIN_FAMILY}}/g, chain);
      const parsed = JSON.parse(manifest) as {
        dependencies: Record<string, string>
      };
      expect(parsed.dependencies["@eclesia/chain-" + chain]).toBeDefined();
    }
  });
});

describe("scaffold", () => {
  it("generates a gno project from a configuration without prompting", async () => {
    const os = await import("node:os");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eclesia-scaffold-"));
    const target = path.join(dir, "gno-project");
    const {
      scaffold,
    } = await import("./create-indexer.js");
    await scaffold(base({
      projectName: "gno-project",
      chain: "gno",
      chainName: "gno.land",
      rpcEndpoint: "http://127.0.0.1:26657",
      chainPrefix: "g",
      modules: ["Messages", "Packages", "Validators"],
      processGenesis: false,
    }), target, {
      install: false,
      build: false,
    });
    try {
      const entry = fs.readFileSync(path.join(target, "src", "index.ts"), "utf-8");
      expect(entry).toContain("chain: gno(");
      expect(entry).toContain("new ValidatorsModule()");
      expect(entry).not.toContain("{{");
      const manifest = JSON.parse(fs.readFileSync(path.join(target, "package.json"), "utf-8")) as {
        name: string
        dependencies: Record<string, string>
        keywords: string[]
      };
      expect(manifest.name).toBe("gno-project");
      expect(manifest.dependencies["@eclesia/gno-modules-pg"]).toBeDefined();
      expect(manifest.dependencies["@cosmjs/stargate"]).toBeUndefined();
      expect(manifest.keywords).toContain("gno");
      const env = fs.readFileSync(path.join(target, ".env"), "utf-8");
      expect(env).toContain("RPC_ENDPOINT=http://127.0.0.1:26657");
      expect(env).toContain("PROCESS_GENESIS=false");
      // Without genesis processing the compose file must not mount a genesis file
      expect(fs.readFileSync(path.join(target, "docker-compose.yml"), "utf-8")).not.toContain("genesis.json");
      for (const file of [".gitignore", "Dockerfile", "tsconfig.json", "README.md", "eslint.config.mjs", "pnpm-workspace.yaml"]) {
        expect(fs.existsSync(path.join(target, file))).toBe(true);
      }
    }
    finally {
      fs.rmSync(dir, {
        recursive: true,
        force: true,
      });
    }
  });
});
