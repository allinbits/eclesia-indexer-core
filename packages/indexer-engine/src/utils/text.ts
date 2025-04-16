export const decodeAttr = (x: Uint8Array | string) => {
  if (typeof x === "string") {
    return x;
  }
  if (x instanceof Uint8Array) {
    return Buffer.from(x).toString();
  }
};
