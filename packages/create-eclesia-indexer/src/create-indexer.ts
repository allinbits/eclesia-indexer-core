import enquirer from "enquirer";
const {
  prompt,
} = enquirer;
import fse from "fs-extra";
const {
  ensureDirSync, copySync, writeFileSync, readFileSync,
} = fse;
import {
  resolve,
} from "node:path";
import {
  dirname,
} from "node:path";
import {
  fileURLToPath,
} from "node:url";

import colors from "picocolors";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface ProjectConfig {
  projectName: string
  chainName: string
  description: string
  rpcEndpoint: string
  chainPrefix: string
  minimal: string
  startHeight: number
  queueSize: number
  logLevel: string
  processGenesis: string
  genesisPath: string | null
  modules: string[]
  packageManager: "npm" | "yarn" | "pnpm"
}

const availableModules = [
  {
    name: "Auth",
    value: "auth",
    hint: "Account and authentication data",
  },
  {
    name: "Bank",
    value: "bank",
    hint: "Token transfers and balances",
  },
  {
    name: "Staking",
    value: "staking",
    hint: "Validator and delegation data",
  },
];

const minimalAvailableModules = [
  {
    name: "Auth",
    value: "auth",
    hint: "Account and authentication data",
  },
  {
    name: "Bank",
    value: "bank",
    hint: "Token transfers and balances",
  },
];

export async function createIndexer(initialProjectName?: string): Promise<void> {
  const config = await gatherProjectInfo(initialProjectName);
  const targetDir = resolve(process.cwd(), config.projectName);

  console.log(colors.blue("📁 Creating project directory..."));
  ensureDirSync(targetDir);

  console.log(colors.blue("📋 Copying template files..."));
  await copyTemplateFiles(config, targetDir);

  console.log(colors.blue("🔧 Processing template variables..."));
  await processTemplates(config, targetDir);

  console.log(colors.blue("📦 Installing dependencies..."));
  await installDependencies(config, targetDir);

  console.log();
  console.log(colors.green("🎉 Your indexer is ready!"));
  console.log();
  console.log("Next steps:");
  console.log(colors.cyan(`  cd ${config.projectName}`));
  console.log(colors.cyan(`  ${config.packageManager} run build`));
  console.log(colors.cyan(`  ${config.packageManager} start`));
  console.log();
}

async function gatherProjectInfo(initialProjectName?: string): Promise<ProjectConfig> {
  const questions1 = [
    {
      type: "input",
      name: "projectName",
      message: "Project name:",
      initial: initialProjectName || "my-indexer",
      skip: !!initialProjectName,
    },
    {
      type: "input",
      name: "chainName",
      message: "Chain name:",
      initial: "cosmos-hub",
    },
    {
      type: "input",
      name: "chainPrefix",
      message: "Chain address prefix:",
      initial: "cosmos",
    },
    {
      type: "input",
      name: "description",
      message: "Description:",
      initial: "A custom Cosmos SDK chain indexer",
    },
    {
      type: "input",
      name: "rpcEndpoint",
      message: "RPC endpoint:",
      initial: "https://rpc.cosmos.network",
    },
    {
      type: "toggle",
      name: "minimal",
      message: "Minimal block indexing? (Only stores heights)",
      enabled: "Yes",
      disabled: "No",
      initial: false,
    },
    {
      type: "number",
      name: "queueSize",
      message: "Number of blocks to keep prefetched (queue size):",
      initial: 200,
    },
    {
      type: "number",
      name: "startHeight",
      message: "Height to start indexing from (>1 not compatible with standard modules):",
      initial: 1,
    },
  ];
  const answers1 = await prompt(questions1) as ProjectConfig;
  if (answers1.startHeight == 1) {
    const genesisQuestion = await prompt([
      {
        type: "toggle",
        name: "processGenesis",
        message: "Process genesis file?",
        enabled: "Yes",
        disabled: "No",
      },
    ]) as ProjectConfig;
    answers1.processGenesis = genesisQuestion.processGenesis;
  }
  else {
    answers1.processGenesis = "No";
  }
  if (answers1.processGenesis) {
    const genesisPathQuestion = await prompt([
      {
        type: "input",
        name: "genesisPath",
        message: "Path to genesis file:",
        initial: "./genesis.json",
      },
    ]) as ProjectConfig;
    answers1.genesisPath = genesisPathQuestion.genesisPath;
  }
  else {
    answers1.genesisPath = null;
  }
  const questions2 = [
    {
      type: "multiselect",
      name: "modules",
      message: "Select modules to include:",
      choices: answers1.startHeight == 1 && !answers1.minimal && answers1.processGenesis ? availableModules : minimalAvailableModules,
      initial: answers1.startHeight == 1 && !answers1.minimal && answers1.processGenesis ? [0, 1, 2] : [0, 1],
    },
    {
      type: "select",
      name: "packageManager",
      message: "Package manager:",
      choices: [
        {
          name: "pnpm",
          hint: "recommended",
        },
        {
          name: "npm",
        },
        {
          name: "yarn",
        },
      ],
      initial: 0,
    },
    {
      type: "select",
      name: "logLevel",
      message: "Log level:",
      choices: ["error", "warn", "info", "verbose", "debug", "silly"],
      initial: 0,
    },
  ];
  const answers2 = await prompt(questions2) as ProjectConfig;
  return {
    ...answers1,
    ...answers2,
  };
}

async function copyTemplateFiles(config: ProjectConfig, targetDir: string): Promise<void> {
  const templatesDir = resolve(__dirname, "..", "templates", "basic");
  copySync(templatesDir, targetDir, {
    filter: src => !src.includes(".template"),
  });

  // Copy template files
  const templateFiles = ["package.json.template", "src/index.ts.template", "tsconfig.json.template", "docker-compose.yml.template", "README.md.template", ".env.template"];

  templateFiles.forEach((templateFile) => {
    const srcPath = resolve(templatesDir, templateFile);
    const destPath = resolve(targetDir, templateFile.replace(".template", ""));

    try {
      copySync(srcPath, destPath);
    }
    catch (_error) {
      // Template file might not exist, that's okay
    }
  });
}

async function processTemplates(config: ProjectConfig, targetDir: string): Promise<void> {
  const templateVars = {
    PROJECT_NAME: config.projectName,
    CHAIN_NAME: config.chainName,
    DESCRIPTION: config.description,
    RPC_ENDPOINT: config.rpcEndpoint,
    PG_CONNECTION_STRING: "postgres://postgres:password@postgres:5432/indexer",
    LOG_LEVEL: config.logLevel,
    QUEUE_SIZE: config.queueSize.toString(),
    PROCESS_GENESIS: config.processGenesis + "",
    GENESIS_PATH: config.genesisPath || "",
    MINIMAL: config.minimal ? "true" : "false",
    START_HEIGHT: config.startHeight.toString(),
    CHAIN_PREFIX: config.chainName.split("-")[0] || "cosmos",
    MODULES_IMPORT: generateModulesImport(config),
    MODULES_INSTANTIATION: generateModulesInstantiation(config),
    MODULES_ARRAY: generateModulesArray(config),
  };

  const filesToProcess = ["package.json", "src/index.ts", "tsconfig.json", "docker-compose.yml", "README.md", "pnpm-workspace.yaml", ".env"];

  filesToProcess.forEach((file) => {
    const filePath = resolve(targetDir, file);

    try {
      let content = readFileSync(filePath, "utf-8");

      Object.entries(templateVars).forEach(([key, value]) => {
        const regex = new RegExp(`{{${key}}}`, "g");
        content = content.replace(regex, value);
      });

      writeFileSync(filePath, content);
    }
    catch (_error) {
      // File might not exist, that's okay
    }
  });
}

function generateModulesImport(config: ProjectConfig): string {
  const imports: string[] = [];

  imports.push("  Blocks");
  if (config.modules.includes("Auth")) {
    imports.push("  AuthModule");
  }
  if (config.modules.includes("Bank") && config.startHeight === 1 && config.processGenesis) {
    imports.push("  BankModule");
  }
  if (config.modules.includes("Staking") && !config.minimal) {
    imports.push("  StakingModule");
  }

  return `import {\n${imports.join(",")}\n} from "@eclesia/core-modules-pg";\n`;
}

function generateModulesInstantiation(config: ProjectConfig): string {
  const instantiations: string[] = [];

  if (config.minimal) {
    instantiations.push("const blocksModule = new Blocks.MinimalBlocksModule(registry);");
  }
  else {
    instantiations.push("const blocksModule = new Blocks.FullBlocksModule(registry);");
  }
  if (config.modules.includes("Auth")) {
    instantiations.push("const authModule = new AuthModule(registry);");
  }
  if (config.modules.includes("Bank") && config.startHeight === 1 && config.processGenesis) {
    instantiations.push("const bankModule = new BankModule(registry);");
  }
  if (config.modules.includes("Staking") && !config.minimal) {
    instantiations.push("const stakingModule = new StakingModule(registry);");
  }

  return instantiations.join("\n");
}

function generateModulesArray(config: ProjectConfig): string {
  const moduleNames: string[] = [];

  moduleNames.push("blocksModule");

  if (config.modules.includes("Auth")) {
    moduleNames.push("authModule");
  }
  if (config.modules.includes("Bank") && config.startHeight === 1 && config.processGenesis) {
    moduleNames.push("bankModule");
  }
  if (config.modules.includes("Staking") && !config.minimal) {
    moduleNames.push("stakingModule");
  }
  return `[${moduleNames.filter(m => !m.includes("//")).join(", ")}]`;
}

async function installDependencies(config: ProjectConfig, targetDir: string): Promise<void> {
  const {
    spawn,
  } = await import("node:child_process");

  return new Promise((resolve, reject) => {
    const child = spawn(config.packageManager, ["install"], {
      cwd: targetDir,
      stdio: "inherit",
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Package installation failed with code ${code}`));
      }
      else {
        resolve();
      }
    });
  });
}
