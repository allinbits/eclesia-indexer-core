import fs from "node:fs";

import { chain } from "stream-chain";
import { Parser, parser } from "stream-json";
import { pick } from "stream-json/filters/Pick";
import { streamArray } from "stream-json/streamers/StreamArray";
import { streamValues } from "stream-json/streamers/StreamValues";

import { log } from "../bus";

export class GenesisReader {
  genesisPath: string;

  constructor (genesisPath: string) {
    this.genesisPath = genesisPath;
  }

  readGenesis = (): Parser => {
    return fs.createReadStream(this.genesisPath).pipe(parser());
  };

  setArrayReader = (
    path: string,
    processor: (chunk: unknown) => Promise<void>
  ): Promise<boolean> => {
    const readPromise = new Promise<boolean>((resolve, reject) => {
      try {
        const filters = path.split(".");
        const pickers = filters.map((filter) => pick({ filter }));
        let counter = 0;
        chain([this.readGenesis(), ...pickers, streamArray(), processor])
          .on("data", (_data) => {
            counter++;
          })
          .on("end", () => {
            log.log(`Processed ${counter} entries`);
            resolve(true);
          });
      } catch (_e) {
        reject();
      }
    });

    return readPromise;
  };

  setValueReader = (
    path: string,
    processor: (chunk: unknown) => Promise<void>
  ): Promise<boolean> => {
    const readPromise = new Promise<boolean>((resolve, reject) => {
      try {
        const filters = path.split(".");
        const pickers = filters.map((filter) => pick({ filter }));

        let counter = 0;
        chain([this.readGenesis(), ...pickers, streamValues(), processor])
          .on("data", (_data) => {
            counter++;
          })
          .on("end", () => {
            log.log(`Processed ${counter} entries`);
            resolve(true);
          });
      } catch (_e) {
        reject();
      }
    });

    return readPromise;
  };
}
