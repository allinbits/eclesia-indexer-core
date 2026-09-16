/**
 * A minimal protobuf wire reader for the message types the published gno-types package does
 * not know yet. Tendermint2's amino binary encoding is proto3-compatible: struct fields are
 * numbered in declaration order, strings and addresses are length-delimited, integers are
 * varints. Enough to decode the flat VM messages added after gno-types 1.0.8.
 */

export type ProtoField = {
  number: number
  wireType: number
  bytes?: Uint8Array // wire type 2
  varint?: bigint // wire type 0
};

/** Splits a message into its top-level fields; unknown wire types stop the scan */
export function readFields(bytes: Uint8Array): ProtoField[] {
  const fields: ProtoField[] = [];
  let i = 0;
  const varint = (): bigint => {
    let result = 0n;
    let shift = 0n;
    for (;;) {
      if (i >= bytes.length) {
        throw new Error("Truncated varint");
      }
      const byte = bytes[i++];
      result |= BigInt(byte & 0x7f) << shift;
      if (byte < 0x80) {
        return result;
      }
      shift += 7n;
    }
  };
  while (i < bytes.length) {
    const tag = Number(varint());
    const number = tag >>> 3;
    const wireType = tag & 7;
    if (wireType === 0) {
      fields.push({
        number,
        wireType,
        varint: varint(),
      });
    }
    else if (wireType === 2) {
      const length = Number(varint());
      if (i + length > bytes.length) {
        throw new Error("Truncated field " + number);
      }
      fields.push({
        number,
        wireType,
        bytes: bytes.subarray(i, i + length),
      });
      i += length;
    }
    else if (wireType === 1) {
      i += 8;
      fields.push({
        number,
        wireType,
      });
    }
    else if (wireType === 5) {
      i += 4;
      fields.push({
        number,
        wireType,
      });
    }
    else {
      throw new Error("Unsupported wire type " + wireType + " for field " + number);
    }
  }
  return fields;
}

const utf8 = new TextDecoder();

/** The string in field `number`, or "" when absent */
export function stringField(fields: ProtoField[], number: number): string {
  const field = fields.find(f => f.number === number && f.bytes !== undefined);
  return field?.bytes ? utf8.decode(field.bytes) : "";
}

/** Every string in repeated field `number`, in order */
export function stringFields(fields: ProtoField[], number: number): string[] {
  return fields.filter(f => f.number === number && f.bytes !== undefined).map(f => utf8.decode(f.bytes!));
}

/** The varint in field `number`, or 0n when absent */
export function varintField(fields: ProtoField[], number: number): bigint {
  return fields.find(f => f.number === number && f.varint !== undefined)?.varint ?? 0n;
}
