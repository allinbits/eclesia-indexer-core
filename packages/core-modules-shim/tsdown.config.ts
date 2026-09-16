/* eslint-disable @stylistic/no-multi-spaces */
import {
  defineConfig,
} from "tsdown";

/**
 * TSDown build configuration for core-modules-pg compatibility shim
 * Re-exports @eclesia/cosmos-modules-pg under the old package name
 */
export default defineConfig([
  {
    entry: ["./src/index.ts"],                                    // Entry point
    unbundle: true,                                               // Keep modules separate
    attw: true,                                                  // Type checking
    platform: "node",                                            // Node.js target
    nodeProtocol: "strip",                                       // Strip node: prefix
    target: "es2022",                                             // es2022 target
    outDir: "./dist",                                             // Output directory
    clean: true,                                                 // Clean before build
    sourcemap: true,                                             // Generate sourcemaps
    dts: true,                                                   // Generate .d.ts files
    format: ["cjs"],                                             // CommonJS format
    external: ["@eclesia/cosmos-modules-pg"], // External deps
  },
  {
    entry: ["./src/index.ts"],                                    // Entry point
    unbundle: true,                                               // Keep modules separate
    attw: true,                                                  // Type checking
    platform: "node",                                            // Node.js target
    target: "es2022",                                             // es2022 target
    outDir: "./dist",                                             // Output directory
    clean: true,                                                 // Clean before build
    sourcemap: true,                                             // Generate sourcemaps
    dts: true,                                                   // Generate .d.ts files
    format: ["esm"],                                             // ES Module format
    external: ["@eclesia/cosmos-modules-pg"], // External deps
  },
]);
