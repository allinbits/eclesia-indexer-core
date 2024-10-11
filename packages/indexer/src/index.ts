import { Command } from "commander";
import figlet from "figlet";
import { bus } from "./bus";
import pkg from "../package.json";
import { start } from "./indexer";
import { LogEvent } from "./types";
import Logger from "./utils/logger";
import { health } from "./healthcheck";

const runIndexer = (
  init: () => Promise<void>,
  modules: string[],
  defaultPath: string
) => {
  const indexer = new Command();

  console.log(figlet.textSync("Cosmos TS Indexer"));

  const logger = new Logger();
  process.env.LOG_LEVEL
    ? logger.setLogLevel(parseInt(process.env.LOG_LEVEL))
    : logger.setLogLevel(1);

  const logHandler = (logEvent: LogEvent) => {
    logger[logEvent.type](logEvent.message);
  };

  bus.on("log", (event: LogEvent) => {
    logHandler(event);
  });

  health();

  indexer
    .name("ts-indexer")
    .version(pkg.version)
    .description("A Cosmos SDK indexer built with TS");

  indexer
    .command("start")
    .description("Start the indexer")
    .argument("[genesis]", "Path to genesis file", defaultPath)
    .action(async (genesisPath) => {
      try {
        await start(genesisPath, init, modules);
      } catch (e) {
        console.error("" + e);
      }
    });
  indexer.parse(process.argv);
};
export { runIndexer };
