/**
 * Converts an object containing BigInt values to a plain JavaScript object
 * BigInt values are converted to strings to maintain precision in JSON serialization
 * @param obj - Object that may contain BigInt values
 * @returns Plain object with BigInt values converted to strings
 */
const toPlainObject = (obj: unknown) => {
  return JSON.parse(JSON.stringify(obj,
    (key, value) => (typeof value === "bigint" ? value.toString() : value), // return everything else unchanged
  ));
};
export {
  toPlainObject,
};
