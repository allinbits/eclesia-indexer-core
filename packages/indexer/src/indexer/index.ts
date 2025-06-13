import { CometClient, toRfc3339WithNanoseconds } from "@cosmjs/tendermint-rpc";
import {
  BlockResponse,
  BlockResultsResponse,
} from "@cosmjs/tendermint-rpc";
import { Event } from "@cosmjs/tendermint-rpc/build/comet38";
import { MsgExec } from "cosmjs-types/cosmos/authz/v1beta1/tx"
import {
  QueryValidatorsRequest,
  QueryValidatorsResponse,
} from "cosmjs-types/cosmos/staking/v1beta1/query";
import { Tx } from "cosmjs-types/cosmos/tx/v1beta1/tx";

import { asyncEmit, log } from "../bus";
import { beginTransaction, endTransaction, setup } from "../db";
import { getNextHeight } from "../db/queries";
import { setStatus } from "../healthcheck";
import { parseGenesis } from "../parser";
import { decodeAttr } from "../utils";
import { callABCI } from "../utils/abci";
import { getClient } from "../ws";
import Queue from "./blockqueue";

let retries = 0;
const queueSize = process.env.QUEUE_SIZE
  ? parseInt(process.env.QUEUE_SIZE)
  : 500;
// eslint-disable-next-line max-lines-per-function
export const start = async (
  genesisPath: string,
  init: () => Promise<void>,
  modules: string[]
) => {
  /*
  First we try to configure the database.
  If the database does not exist, setup() will first create the base tables and we will then attempt to parse the genesis file.
  */
  try {
    const mustParseGenesis = await setup();
    if (mustParseGenesis) {
      await parseGenesis(genesisPath, init);
    }
  } catch (err) {
    log.error("Failed to set up db and/or parse genesis");
    throw new Error("" + err);
  }

  /*
  We connect to the FULL archive node's websocket rpc
  */
  let ws: CometClient;
  try {
    ws = await getClient();
    setStatus("ws", "OK");
  } catch (_e) {
    setStatus("ws", "FAILED");
    throw new Error("Could not connect to webseocket rpc");
  }
  log.log("Connected to RPC");

  const subscription = ws.subscribeNewBlock ? ws.subscribeNewBlock() : null;
  /*
  Wait for individual additional indexing modules to be initialized.
  If this is a first run where genesis was parsed they will have already been initialized
  */
  await init();

  log.info("Configured modules:" + modules);
  try {
    const status = await ws.status();
    let latestHeight = status.syncInfo.latestBlockHeight;

    log.info("Current chain height: " + latestHeight);
    const blocksToIndex = new Queue<
      [BlockResponse, BlockResultsResponse, Uint8Array]
    >(queueSize);
    const heightToProcess = await getNextHeight();

    log.info("Next height to process: " + heightToProcess);

    const newBlockReceived = (height: number) => {
      log.log("Received new block: " + height);

      // If we are synced, add to end of queue
      if (blocksToIndex.synced) {
        const q = QueryValidatorsRequest.fromPartial({});
        const vals = QueryValidatorsRequest.encode(q).finish();
        try {
          blocksToIndex.enqueue(
            Promise.all([
              ws.block(height) as Promise<BlockResponse>,
              ws.blockResults(height) as Promise<BlockResultsResponse>,
              callABCI("/cosmos.staking.v1beta1.Query/Validators", vals, height),
            ]).catch((_e) => {
              log.error("Error fetching block: " + height);

              return Promise.resolve([]);
            }) as Promise<[BlockResponse, BlockResultsResponse, Uint8Array]>
          );
        } catch (e) {
          log.error("" + e);
        }

        // else update latestHeight to ensure fetcher keeps running
      } else {
        latestHeight = height;
      }
    };

    const pollForBlock = async () => {
      const status = await ws.status();
      if (status.syncInfo.latestBlockHeight > latestHeight) {
        while (latestHeight < status.syncInfo.latestBlockHeight) {
          newBlockReceived(latestHeight + 1);
        }
      }
      setTimeout(pollForBlock, 15000);
    };

    // Set listener for new blocks
    const listener = {
      next: (data: { header: { height: number; }; }) => {
        newBlockReceived(data.header.height);
      },
    }
    if (process.env.USE_POLLING === "1") {
      pollForBlock();
    } else {
      if (subscription) {
        subscription.addListener(listener);
      } else {
        throw new Error("Could not subscribe to new blocks");
      }
    }

    // Create the fetcher "service" to enqueue blocks for indexing until data fetched to latest height
    // We also prefetch block_results and validator list for each height to increase performance
    // When we are synced, for-loop will complete and fetcher will exit
    const fetcher = async () => {
      let disconnected = false;
      for (let i = heightToProcess; i <= latestHeight; i++) {
        if (disconnected) {
          break;
        }
        log.verbose("Fetching: " + i);

        const q = QueryValidatorsRequest.fromPartial({ pagination: { limit: 1000n } });
        const vals = QueryValidatorsRequest.encode(q).finish();
        try {
          const toIndex = Promise.all([
            ws.block(i),
            ws.blockResults(i) as Promise<BlockResultsResponse>,
            callABCI("/cosmos.staking.v1beta1.Query/Validators", vals, i),
          ]).catch((_e) => {
            log.error("Error fetching block: " + i);
            disconnected = true;
            return Promise.resolve([]);
          }) as Promise<[BlockResponse, BlockResultsResponse, Uint8Array]>;
          blocksToIndex.enqueue(toIndex);
          await blocksToIndex.continue();
        } catch (e) {
          log.error("" + e);
          disconnected = true;
          break;
        }
      }
      if (!disconnected) {
        blocksToIndex.setSynced();
        log.info("Synced to latest height");
      }
    };

    // Run "faux"-concurrently by not awaiting. This will batch-fetch block data until synced in the "background"
    // but execution will continue here to the main processing loop which will run continuously

    fetcher();

    // Index blocks in queue
    // size is never 0 as there is always 1 promise in the queue that resolves if/when a new block is received making this run for ever
    const hrTime = process.hrtime();
    let ms = hrTime[0] * 1000000 + hrTime[1] / 1000;

    while (blocksToIndex.size() > 0) {
      // await the dequeued promise is essentially awaiting fetched data for that block
      try {
        // Index block inside a db transaction to ensure data consistency
        await beginTransaction();
        const toProcess = await blocksToIndex.dequeue();
        log.verbose("Retrieved block data");
        if (!toProcess || toProcess.length < 3) {
          throw new Error("Could not fetch block");
        }
        const block = toProcess[0];
        const block_results = toProcess[1];
        const validators = QueryValidatorsResponse.decode(
          toProcess[2]
        ).validators;

        log.verbose("Decoded block");

        const height = block.block.header.height;
        log.verbose("Processing block: " + height);

        log.verbose("Started db tx");

        // Initialize height & timestamp to be used for this block-processing run
        const timestamp = toRfc3339WithNanoseconds(block.block.header.time);

        // Use & await asyncEmit to ensure db insertions in order

        // Emit block information to any interested modules.
        // Primarily the required block module listens to this
        await asyncEmit("block", {
          value: { block, block_results },
          height,
          timestamp,
        });

        log.verbose("Modules handled block event");

        // Deal with begin_block events first
        await asyncEmit("begin_block", {
          value: { events: block_results.beginBlockEvents, validators },
          height,
          timestamp,
        });

        log.verbose("Modules handled begin_block events");

        // Then individual tx_events
        await asyncEmit("tx_events", {
          value: block_results.results,
          height,
          timestamp,
        });
        log.verbose("Modules handled tx events");

        // Emit details and result for each tx msg separately
        for (let t = 0; t < block.block.txs.length; t++) {
          const tx = Tx.decode(block.block.txs[t]);
          const result = block_results.results[t].code;
          const txlog = block_results.results[t].log;

          if (result != 0) {
            //  Tx failed. Ignore
            continue;
          }

          // parsing log rather than using events directly in order to have msg_index available to filter appropriate events for each msg
          const events: Array<{ msg_index?: number; events: Event[] }> = txlog
            ? JSON.parse(txlog)
            : [];
          const msgs = tx.body?.messages;

          if (msgs) {
            for (let i = 0; i < msgs.length; i++) {
              log.verbose(
                "Indexer broadcasting msg for handling: " + msgs[i].typeUrl
              );
              const msgevents =
                msgs.length > 1
                  ? events.find((x) => x.msg_index == i)?.events
                  : events[0].events;
              await asyncEmit(msgs[i].typeUrl as never, {
                value: { tx: msgs[i].value as never, events: msgevents } as never,
                height,
                timestamp,
              });
              if (msgs[i].typeUrl == '/cosmos.authz.v1beta1.MsgExec') {
                const authzMsgs = MsgExec.decode(msgs[i].value).msgs;
                if (authzMsgs) {
                  for (let r = 0; r < authzMsgs.length; r++) {
                    log.verbose(
                      "Indexer broadcasting msg for handling: " + authzMsgs[r].typeUrl
                    );
                    const authzMsgEvents = msgevents?.reduce((events, evt) => {
                      if (evt.attributes.filter(x => decodeAttr(x.key) == 'authz_msg_index' && decodeAttr(x.value) == '' + r).length > 0) {
                        events.push(evt);
                      }
                      return events;
                    }, [] as Event[]);
                    await asyncEmit(authzMsgs[r].typeUrl as never, {
                      value: { tx: authzMsgs[r].value as never, events: authzMsgEvents } as never,
                      height,
                      timestamp,
                    });
                  }
                }
              }
            }
          }
        }
        log.verbose("Modules handled msg events");

        // Then deal with end_block events
        await asyncEmit("end_block", {
          value: block_results.endBlockEvents,
          height,
          timestamp,
        });
        log.verbose("Modules handled end_block events");

        // Emit events to trigger periodic operations every 50, 100 and 1000 blocks
        if (height % 1000 == 0) {
          const hrTime = process.hrtime();
          const newms = hrTime[0] * 1000000 + hrTime[1] / 1000;
          const duration = newms - ms;
          ms = newms;
          const rate = 1000000000 / duration;
          log.log("Processing:" + rate.toFixed(2) + "blocks/sec");
          await asyncEmit("periodic/1000", { value: null, height, timestamp });
        }
        if (height % 100 == 0) {
          await asyncEmit("periodic/100", { value: null, height, timestamp });
        }
        if (height % 50 == 0) {
          await asyncEmit("periodic/50", { value: null, height, timestamp });
        }
        log.verbose("Handled periodic events");

        await endTransaction(true);

        log.verbose("Committed db tx");
      } catch (e) {
        log.error("" + e);
        setStatus("ws", "FAILED");
        await endTransaction(false);
        if (subscription) {
          subscription.removeListener(listener);
        }
        retries++;
        break;
      }
      retries = 0;
      setStatus("ws", "OK");
    }
  } catch (e) {
    log.error("Error in indexer: " + e);
    setStatus("ws", "FAILED");
  }
  if (retries < 3) {
    start(genesisPath, init, modules);
  }
};
