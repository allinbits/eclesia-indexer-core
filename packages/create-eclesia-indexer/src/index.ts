import {
  existsSync,
} from "node:fs";
import {
  dirname, resolve,
} from "node:path";
import {
  fileURLToPath,
} from "node:url";

import colors from "picocolors";

import {
  createIndexer,
} from "./create-indexer.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function main() {
  console.log();
  console.log(colors.cyan("🚀 Welcome to create-eclesia-indexer!"));
  console.log(colors.gray("Scaffolding a new Cosmos SDK chain indexer..."));
  console.log();

  try {
    const projectName = process.argv[2];

    if (projectName && existsSync(resolve(process.cwd(), projectName))) {
      console.log(colors.red(`❌ Directory '${projectName}' already exists.`));
      process.exit(1);
    }

    await createIndexer(projectName);

    console.log();
    console.log(colors.green("✅ Indexer created successfully!"));
    console.log();
  }
  catch (error) {
    console.error(colors.red("❌ Error creating indexer:"), error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
