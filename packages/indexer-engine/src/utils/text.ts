export const decodeAttr = (x: Uint8Array | string) => {
  if (typeof x === "string") {
    return x;
  }
  else if (x instanceof Uint8Array) {
    return Buffer.from(x).toString();
  }
  else {
    return "";
  }
};
