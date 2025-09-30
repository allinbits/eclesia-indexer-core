import {
  defineConfig,
} from "tsdown";

/**
 * TSDown build configuration for basic-indexer-pg package
 * PostgreSQL integration layer with indexer-engine dependency
 */
export default defineConfig([
  {
    entry: ["./src/index.ts"],                    // Entry point
    unbundle: true,                               // Keep modules separate
    attw: true,                                  // Type checking
    platform: "node",                            // Node.js target
    nodeProtocol: "strip",                       // Strip node: prefix
    target: "es2020",                             // ES2020 target
    outDir: "./dist",                             // Output directory
    clean: true,                                 // Clean before build
    sourcemap: true,                             // Generate sourcemaps
    dts: true,                                   // Generate .d.ts files
    format: ["cjs"],                             // CommonJS format
    external: ["@eclesia/indexer-engine"],       // External dependency
  },
  {
    entry: ["./src/index.ts"],                    // Entry point
    unbundle: true,                               // Keep modules separate
    attw: true,                                  // Type checking
    platform: "node",                            // Node.js target
    target: "es2020",                             // ES2020 target
    outDir: "./dist",                             // Output directory
    clean: true,                                 // Clean before build
    sourcemap: true,                             // Generate sourcemaps
    dts: true,                                   // Generate .d.ts files
    format: ["esm"],                             // ES Module format
    external: ["@eclesia/indexer-engine"],       // External dependency
  },
]);
