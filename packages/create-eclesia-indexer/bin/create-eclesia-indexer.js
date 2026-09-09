#!/usr/bin/env node

// This is a simple shim that points to the built CLI
// tsdown emits fixed extensions on the node platform (index.mjs / index.cjs)
import '../dist/index.mjs';