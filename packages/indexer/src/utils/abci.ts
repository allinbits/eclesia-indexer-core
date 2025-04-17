import { setStatus } from "../healthcheck";
import { getClient } from "../ws";

const callABCI = async (path: string, data: Uint8Array, height?: number) => {
  const ws = await getClient();
  const timeout: Promise<void> = new Promise((resolve) => {
    setTimeout(resolve, 30000);
  });
  const abciq = await Promise.race([
    ws.abciQuery({
      path,
      data,
      height: height,
    }),
    timeout,
  ]);
  if (abciq) {
    return abciq.value;
  } else {
    setStatus("ws", "FAILED");
    throw new Error("ws not responding");
  }
};
export { callABCI };
