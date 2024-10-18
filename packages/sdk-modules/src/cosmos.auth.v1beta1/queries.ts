import { Utils } from "@eclesia/indexer";
import { ModuleAccount } from "cosmjs-types/cosmos/auth/v1beta1/auth";
import {
  QueryModuleAccountByNameRequest,
  QueryModuleAccountByNameResponse,
} from "cosmjs-types/cosmos/auth/v1beta1/query";

const getModuleAccount = async (name: string) => {
  const q = QueryModuleAccountByNameRequest.fromJSON({ name });
  const mod = QueryModuleAccountByNameRequest.encode(q).finish();
  const modq = await Utils.callABCI(
    "/cosmos.auth.v1beta1.Query/ModuleAccountByName",
    mod
  );
  const acc = ModuleAccount.decode(
    QueryModuleAccountByNameResponse.decode(modq).account?.value ??
      new Uint8Array()
  ).baseAccount?.address;

  return acc;
};

export { getModuleAccount };
