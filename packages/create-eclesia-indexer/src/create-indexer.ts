import enquirer from "enquirer";
const {
  prompt,
} = enquirer;
import fse from "fs-extra";
const {
  ensureDirSync, copySync, writeFileSync, readFileSync,
} = fse;
import {
  randomBytes,
} from "node:crypto";
import path, {
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

/** Chain families the scaffolder can generate a project for */
export type ChainFamily = "cosmos" | "gno";

export interface ProjectConfig {
  projectName: string
  chain: ChainFamily
  chainName: string
  description: string
  rpcEndpoint: string
  chainPrefix: string
  minimal: boolean
  startHeight: number
  queueSize: number
  logLevel: string
  processGenesis: boolean
  genesisPath: string | null
  enableHealthcheck: boolean
  healthCheckPort: number
  enablePrometheus: boolean
  prometheusPort: number
  modules: string[]
  packageManager: "npm" | "yarn" | "pnpm"
}

/** npm package name rules, restricted to what also works as a directory and a bin name */
const PROJECT_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,212}[a-z0-9])?$/;
const CHAIN_PREFIX_PATTERN = /^[a-z][a-z0-9]*$/;
const CHAIN_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._-]*$/;

export function validateProjectName(value: string): true | string {
  if (!PROJECT_NAME_PATTERN.test(value)) {
    return "Use lowercase letters, digits, dots, hyphens or underscores (an npm package name without a scope); no slashes or spaces.";
  }
  return true;
}

/** Random secret safe for .env files and connection strings (URL-safe base64, no padding) */
function generateSecret(bytes: number): string {
  return randomBytes(bytes).toString("base64url");
}

const cosmosModules = [
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
    hint: "Validator and delegation data (full mode, genesis from height 1)",
  },
];

const gnoModules = [
  {
    name: "Messages",
    value: "messages",
    hint: "Bank sends, realm calls, deployments, runs and every chain event",
  },
  {
    name: "Packages",
    value: "packages",
    hint: "Registry of packages and realms with their sources",
  },
  {
    name: "Validators",
    value: "validators",
    hint: "Validator set and voting power history (full mode)",
  },
  {
    name: "Sessions",
    value: "sessions",
    hint: "Session keys: creation, limits and revocation",
  },
  {
    name: "Bank",
    value: "bank",
    hint: "Transfers and exact balances read from the node (full mode)",
  },
];

/** Per-chain defaults and prompt wording */
const CHAINS: Record<ChainFamily, {
  label: string
  chainName: string
  description: string
  rpcEndpoint: string
  chainPrefix: string
}> = {
  cosmos: {
    label: "Cosmos SDK (CometBFT)",
    chainName: "cosmos-hub",
    description: "A custom Cosmos SDK chain indexer",
    rpcEndpoint: "https://rpc.cosmos.network",
    chainPrefix: "cosmos",
  },
  gno: {
    label: "gno.land (Tendermint2)",
    chainName: "gno.land",
    description: "A custom gno.land indexer",
    rpcEndpoint: "http://127.0.0.1:26657",
    chainPrefix: "g",
  },
};

/** Modules offered for a chain, given the indexing mode. Full-mode modules disappear in minimal mode. */
export function modulesFor(chain: ChainFamily, minimal: boolean, processGenesis: boolean, startHeight: number): typeof cosmosModules {
  if (chain === "gno") {
    return minimal ? gnoModules.filter(m => m.value !== "validators" && m.value !== "bank") : gnoModules;
  }
  const staking = startHeight == 1 && !minimal && processGenesis;
  return staking ? cosmosModules : cosmosModules.filter(m => m.value !== "staking");
}

export async function createIndexer(initialProjectName?: string): Promise<void> {
  if (initialProjectName !== undefined) {
    const valid = validateProjectName(initialProjectName);
    if (valid !== true) {
      throw new Error("Invalid project name '" + initialProjectName + "': " + valid);
    }
  }
  const config = await gatherProjectInfo(initialProjectName);
  const targetDir = resolve(process.cwd(), config.projectName);
  await scaffold(config, targetDir);

  console.log();
  console.log(colors.green("🎉 Your indexer is ready!"));
  console.log();
  console.log("Next steps:");
  console.log(colors.cyan(`  cd ${config.projectName}`));
  console.log(colors.cyan(`  ${config.packageManager} local-dev:start # To run a self-contained local development environment with Postgres`));
  console.log();
  console.log("Credentials for the local environment (Postgres password, Hasura admin secret) were generated into .env. To use an external Postgres instead, change PG_CONNECTION_STRING there.");
  if (config.chain === "cosmos" && config.modules.includes("Bank") && !config.processGenesis) {
    console.log(colors.yellow("Bank module without genesis processing: balances are tracked as changes since the start height, not absolute amounts."));
  }
  console.log();
  console.log(colors.cyan(`  ${config.packageManager} start # To run the indexer`));
  console.log();
  console.log("Happy indexing!");
  console.log();
}

export type ScaffoldOptions = {
  install?: boolean // Run the package manager's install in the project (default: true)
  build?: boolean // Run the project's build after installing (default: true)
};

/**
 * Generates a project from a complete configuration, without prompting: creates the directory,
 * copies the shared and chain-specific templates, fills in the placeholders, and by default
 * installs dependencies and builds. The interactive CLI gathers the configuration and calls
 * this; scripts and tests can call it directly.
 * @param config - Answers the CLI would have collected
 * @param targetDir - Directory to create the project in
 * @param options - Skip the install or build steps
 */
export async function scaffold(config: ProjectConfig, targetDir: string, options: ScaffoldOptions = {
}): Promise<void> {
  console.log(colors.blue("📁 Creating project directory..."));
  ensureDirSync(targetDir);

  console.log(colors.blue("📋 Copying files..."));
  await copyTemplateFiles(config, targetDir);

  console.log(colors.blue("🔧 Processing template variables..."));
  await processTemplates(config, targetDir);

  if (options.install !== false) {
    console.log(colors.blue("📦 Installing dependencies..."));
    await installDependencies(config, targetDir);
  }

  if (options.install !== false && options.build !== false) {
    console.log(colors.blue("📦 Building..."));
    await buildProject(config, targetDir);
  }
}

async function gatherProjectInfo(initialProjectName?: string): Promise<ProjectConfig> {
  const chainAnswer = await prompt([
    {
      type: "select",
      name: "chain",
      message: "Chain family:",
      choices: [
        {
          name: "cosmos",
          message: CHAINS.cosmos.label,
          hint: "any Cosmos SDK chain, CometBFT 0.34 to 0.38",
        },
        {
          name: "gno",
          message: CHAINS.gno.label,
          hint: "gno.land and other Tendermint2 chains",
        },
      ],
      initial: 0,
    },
  ]) as {
    chain: ChainFamily
  };
  const chain = chainAnswer.chain;
  const defaults = CHAINS[chain];
  const questions1 = [
    {
      type: "input",
      name: "projectName",
      message: "Project name:",
      initial: initialProjectName || "my-indexer",
      skip: !!initialProjectName,
      validate: validateProjectName,
    },
    {
      type: "input",
      name: "chainName",
      message: "Chain name:",
      initial: defaults.chainName,
      validate: (value: string) => CHAIN_NAME_PATTERN.test(value) || "Use letters, digits, spaces, dots, hyphens or underscores.",
    },
    {
      type: "input",
      name: "chainPrefix",
      message: "Chain address prefix:",
      initial: defaults.chainPrefix,
      // gno.land addresses always use the g prefix
      skip: chain === "gno",
      validate: (value: string) => CHAIN_PREFIX_PATTERN.test(value) || "A bech32 prefix is lowercase letters and digits, starting with a letter.",
    },
    {
      type: "input",
      name: "description",
      message: "Description:",
      initial: defaults.description,
      validate: (value: string) => !/[\r\n]/.test(value) || "Keep the description on one line.",
    },
    {
      type: "input",
      name: "rpcEndpoint",
      message: "RPC endpoint:",
      initial: defaults.rpcEndpoint,
      validate: (value: string) => {
        try {
          const url = new URL(value);
          if (url.protocol === "http:" || url.protocol === "https:" || url.protocol === "ws:" || url.protocol === "wss:") {
            return true;
          }
          return "Please enter a valid HTTP/HTTPS/WS/WSS URL.";
        }
        catch (err) {
          return "Please enter a valid URL: " + err;
        }
      },
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
  answers1.chain = chain;
  if (chain === "gno") {
    answers1.chainPrefix = defaults.chainPrefix;
  }
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
    answers1.processGenesis = false;
  }
  if (answers1.processGenesis) {
    const genesisPathQuestion = await prompt([
      {
        type: "input",
        name: "genesisPath",
        message: "Path to genesis file:",
        initial: "./genesis.json",
        validate: (value: string) => {
          try {
            fse.accessSync(value, fse.constants.R_OK);
            return true;
          }
          catch (err) {
            return "File not found or not readable. Please enter a valid path: " + err;
          }
        },
      },
    ]) as ProjectConfig;
    answers1.genesisPath = genesisPathQuestion.genesisPath ? path.resolve(genesisPathQuestion.genesisPath) : null;
  }
  else {
    answers1.genesisPath = null;
  }
  const offered = modulesFor(chain, answers1.minimal, answers1.processGenesis, answers1.startHeight);
  const questions2 = [
    {
      type: "multiselect",
      name: "modules",
      message: "Select modules to include:",
      choices: offered,
      initial: offered.map((_m, i) => i),
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
      initial: 4,
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
  // Shared files live in basic; the manifest and entry point come from the chain's own folder
  const chainTemplatesDir = resolve(__dirname, "..", "templates", config.chain);
  if (config.genesisPath) {
    console.log(colors.blue("📋 Copying genesis file..."));
    copySync(config.genesisPath, targetDir + "/genesis.json");
  }

  console.log(colors.blue("📋 Copying template files..."));
  copySync(templatesDir, targetDir, {
    filter: (src) => {
      if (src.includes(".template")) {
        return false;
      }
      if (config.packageManager !== "pnpm" && src.includes("pnpm-workspace")) {
        return false;
      }
      if (src.includes("Dockerfile")) {
        return false;
      }
      if (src.endsWith("_gitignore")) {
        return false;
      }
      return true;
    },
  });
  copySync(resolve(templatesDir, "Dockerfile." + config.packageManager), targetDir + "/Dockerfile");
  // Stored without the leading dot so npm does not rewrite it when the CLI is published
  copySync(resolve(templatesDir, "_gitignore"), targetDir + "/.gitignore");
  // Copy template files
  const templateFiles = ["package.json.template", "src/index.ts.template", "tsconfig.json.template", "docker-compose.yml.template", "README.md.template", ".env.template"];
  const chainOwned = ["package.json.template", "src/index.ts.template"];

  templateFiles.forEach((templateFile) => {
    const srcPath = resolve(chainOwned.includes(templateFile) ? chainTemplatesDir : templatesDir, templateFile);
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
  let polling = false;
  config.enableHealthcheck = false;
  config.healthCheckPort = 8888;
  config.enablePrometheus = false;
  config.prometheusPort = 9090;
  const url = new URL(config.rpcEndpoint);
  if (url.protocol === "http:" || url.protocol === "https:") {
    polling = true;
  }
  // Generated once per project and written only to .env, which is git-ignored
  const postgresPassword = generateSecret(18);
  const hasuraAdminSecret = generateSecret(24);
  const templateVars = {
    PROJECT_NAME: config.projectName,
    CHAIN_FAMILY: config.chain,
    CHAIN_NAME: config.chainName,
    DESCRIPTION: config.description,
    RPC_ENDPOINT: config.rpcEndpoint,
    PG_CONNECTION_STRING: "postgres://postgres:" + postgresPassword + "@localhost:5432/indexer",
    POSTGRES_PASSWORD: postgresPassword,
    HASURA_ADMIN_SECRET: hasuraAdminSecret,
    LOG_LEVEL: config.logLevel,
    QUEUE_SIZE: config.queueSize.toString(),
    USE_POLLING: polling ? "true" : "false",
    PROCESS_GENESIS: config.processGenesis + "",
    GENESIS_PATH: path.resolve(targetDir, "genesis.json"),
    MINIMAL: config.minimal ? "true" : "false",
    START_HEIGHT: config.startHeight.toString(),
    CHAIN_PREFIX: config.chainPrefix,
    ENABLE_HEALTHCHECK: config.enableHealthcheck ? "true" : "false",
    HEALTH_CHECK_PORT: config.healthCheckPort.toString(),
    ENABLE_PROMETHEUS: config.enablePrometheus ? "true" : "false",
    PROMETHEUS_PORT: config.prometheusPort.toString(),
    MODULES_IMPORT: generateModulesImport(config),
    PACKAGE_MANAGER: config.packageManager,
    MODULES_INSTANTIATION: generateModulesInstantiation(config),
    MODULES_ARRAY: generateModulesArray(config),
  };

  const filesToProcess = ["package.json", "src/index.ts", "tsconfig.json", "docker-compose.yml", "README.md", "pnpm-workspace.yaml", ".env"];

  filesToProcess.forEach((file) => {
    const filePath = resolve(targetDir, file);

    try {
      let content = readFileSync(filePath, "utf-8");

      // Without genesis processing there is no genesis.json to mount; binding a missing host
      // path would make Docker create an empty directory under that name
      if (file === "docker-compose.yml" && !config.processGenesis) {
        content = content.replace(/\n {4}volumes:\n {6}- \{\{GENESIS_PATH\}\}:[^\n]*\n/, "\n");
      }

      Object.entries(templateVars).forEach(([key, value]) => {
        const regex = new RegExp(`{{${key}}}`, "g");
        // Placeholders in package.json sit inside JSON strings; escape for that context. A
        // replacer function keeps "$&"-style patterns in user input literal.
        const replacement = file === "package.json" ? JSON.stringify(value).slice(1, -1) : value;
        content = content.replace(regex, () => replacement);
      });

      writeFileSync(filePath, content);
    }
    catch (_error) {
      // File might not exist, that's okay
    }
  });
}

export function generateModulesImport(config: ProjectConfig): string {
  const imports: string[] = [];

  imports.push("  Blocks");
  if (config.chain === "gno") {
    if (config.modules.includes("Messages")) {
      imports.push("  MessagesModule");
    }
    if (config.modules.includes("Packages")) {
      imports.push("  PackagesModule");
    }
    if (config.modules.includes("Validators") && !config.minimal) {
      imports.push("  ValidatorsModule");
    }
    if (config.modules.includes("Sessions")) {
      imports.push("  SessionsModule");
    }
    if (config.modules.includes("Bank") && !config.minimal) {
      imports.push("  BankModule");
    }
    return `import {\n${imports.join(",\n")}\n} from "@eclesia/gno-modules-pg";\n`;
  }
  if (config.modules.includes("Auth")) {
    imports.push("  AuthModule");
  }
  if (config.modules.includes("Bank")) {
    imports.push("  BankModule");
  }
  if (config.modules.includes("Staking") && !config.minimal) {
    imports.push("  StakingModule");
  }

  return `import {\n${imports.join(",\n")}\n} from "@eclesia/cosmos-modules-pg";\n`;
}

export function generateModulesInstantiation(config: ProjectConfig): string {
  const instantiations: string[] = [];

  if (config.chain === "gno") {
    instantiations.push(config.minimal ? "const blocksModule = new Blocks.MinimalBlocksModule();" : "const blocksModule = new Blocks.FullBlocksModule();");
    if (config.modules.includes("Messages")) {
      instantiations.push("const messagesModule = new MessagesModule();");
    }
    if (config.modules.includes("Packages")) {
      instantiations.push("const packagesModule = new PackagesModule();");
    }
    if (config.modules.includes("Validators") && !config.minimal) {
      instantiations.push("const validatorsModule = new ValidatorsModule();");
    }
    if (config.modules.includes("Sessions")) {
      instantiations.push("const sessionsModule = new SessionsModule();");
    }
    if (config.modules.includes("Bank") && !config.minimal) {
      instantiations.push("// Collectors receive fees and deposits without a transfer event; list them in BANK_TRACK_ADDRESSES");
      instantiations.push("const bankModule = new BankModule({\n  trackAddresses: (process.env.BANK_TRACK_ADDRESSES ?? \"\").split(\",\").map(a => a.trim()).filter(Boolean),\n});");
    }
    return instantiations.join("\n");
  }
  if (config.minimal) {
    instantiations.push("const blocksModule = new Blocks.MinimalBlocksModule(registry);");
  }
  else {
    instantiations.push("const blocksModule = new Blocks.FullBlocksModule(registry);");
  }
  if (config.modules.includes("Auth")) {
    instantiations.push("const authModule = new AuthModule(registry);");
  }
  if (config.modules.includes("Bank")) {
    instantiations.push("const bankModule = new BankModule(registry);");
  }
  if (config.modules.includes("Staking") && !config.minimal) {
    instantiations.push("const stakingModule = new StakingModule(registry);");
  }

  return instantiations.join("\n");
}

export function generateModulesArray(config: ProjectConfig): string {
  const moduleNames: string[] = [];

  moduleNames.push("blocksModule");
  if (config.chain === "gno") {
    if (config.modules.includes("Messages")) {
      moduleNames.push("messagesModule");
    }
    if (config.modules.includes("Packages")) {
      moduleNames.push("packagesModule");
    }
    if (config.modules.includes("Validators") && !config.minimal) {
      moduleNames.push("validatorsModule");
    }
    if (config.modules.includes("Sessions")) {
      moduleNames.push("sessionsModule");
    }
    if (config.modules.includes("Bank") && !config.minimal) {
      moduleNames.push("bankModule");
    }
    return `[${moduleNames.join(", ")}]`;
  }

  if (config.modules.includes("Auth")) {
    moduleNames.push("authModule");
  }
  if (config.modules.includes("Bank")) {
    moduleNames.push("bankModule");
  }
  if (config.modules.includes("Staking") && !config.minimal) {
    moduleNames.push("stakingModule");
  }
  return `[${moduleNames.join(", ")}]`;
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

async function buildProject(config: ProjectConfig, targetDir: string): Promise<void> {
  const {
    spawn,
  } = await import("node:child_process");

  return new Promise((resolve, reject) => {
    const child = spawn(config.packageManager, ["run", "build"], {
      cwd: targetDir,
      stdio: "inherit",
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Build failed with code ${code}`));
      }
      else {
        resolve();
      }
    });
  });
}
