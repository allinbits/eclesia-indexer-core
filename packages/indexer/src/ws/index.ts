import { CometClient, connectComet } from "@cosmjs/tendermint-rpc";

let clientInstance: CometClient;
export const getClient = async () => {
  if (!clientInstance) {
    try {
      clientInstance = await connectComet(process.env.RPC_ENDPOINT?.replace("/websocket", "") || "");
    }catch(e) {
      console.error("Error connecting to RPC endpoint: ", e);
      throw e;
    }
  }
  return clientInstance;
}
