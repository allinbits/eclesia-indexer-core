import { connectComet } from "@cosmjs/tendermint-rpc";
export const tmClient = connectComet(process.env.RPC_ENDPOINT?.replace("/websocket", "") || "");
