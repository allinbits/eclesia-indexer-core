/* eslint-disable @typescript-eslint/no-explicit-any */
import { asyncEmit, bus, log } from "../bus";
import { beginTransaction, endTransaction, setup } from "../db";
import { GenesisReader } from "../genesis-reader";

export const parseGenesis = async (
  genesisPath: string,
  init: () => Promise<void>
) => {
  log.log("Parsing genesis");
  try {
    await setup();
    log.log("Base db exists");
  } catch (_e) {
    log.info("Setting up db");
  }
  log.log("Initializing modules");
  await init();
  await beginTransaction();
  try {
    log.log("Starting genesis import");
    log.log("Importing genesis file...");

    const reader = new GenesisReader(genesisPath);

    for (const [key, _value] of bus.handled) {
      if (key.startsWith("genesis/")) {
        const genesisEntry = key.split("/");

        log.log("Importing " + key + "...");
        if (genesisEntry[1] == "array") {
          await reader.setArrayReader(genesisEntry[2], async (data: any) => {
            await asyncEmit(key as never, { value: data.value } as never);

            return data;
          });
        } else {
          await reader.setValueReader(genesisEntry[2], async (data: any) => {
            await asyncEmit(key as never, { value: data.value } as never);

            return data;
          });
        }
      }
    }

    log.log("Importing gen TXs...");
    await reader.setArrayReader(
      "app_state.genutil.gen_txs",
      async (data: any) => {
        for (let i = 0; i < data.value.body.messages.length; i++) {
          const msg = data.value.body.messages[i];
          await asyncEmit(
            ("gentx" + msg["@type"]) as never,
            { value: msg } as never
          );
        }

        return data;
      }
    );
    await endTransaction(true);

    log.log("Finished importing");
  } catch (e) {
    await endTransaction(false);
    log.log("Failed to import genesis");
    throw e;
  }
};
