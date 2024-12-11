export const decodeAttr = (x: Uint8Array | string) => {
  return Buffer.from(x).toString();
};
