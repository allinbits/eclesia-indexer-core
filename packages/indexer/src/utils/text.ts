export const decodeAttr = (x: Uint8Array | string) => {
  if (typeof x == "string") { // TsLint doesn't understand that Buffer.from() can take a string
    return Buffer.from(x).toString();
  }else{
    return Buffer.from(x).toString();
  }
};
