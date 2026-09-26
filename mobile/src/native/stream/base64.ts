/**
 * Base64 for BLE payloads.
 *
 * `react-native-ble-plx` hands characteristic values over as base64 strings, so
 * every byte in and out of the board passes through here. Hand-rolled because
 * Hermes has no `atob`/`btoa` and `Buffer` is a Node shim we would rather not
 * pull into the BLE path.
 */

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function base64ToBytes(value: string): Uint8Array {
  const clean = value.replace(/=+$/, "");
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;

  for (const char of clean) {
    const index = alphabet.indexOf(char);
    if (index < 0) {
      continue;
    }

    buffer = (buffer << 6) | index;
    bits += 6;

    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }

  return new Uint8Array(bytes);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let output = "";

  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const second = index + 1 < bytes.length ? bytes[index + 1] : 0;
    const third = index + 2 < bytes.length ? bytes[index + 2] : 0;
    const triplet = (first << 16) | (second << 8) | third;

    output += alphabet[(triplet >> 18) & 0x3f];
    output += alphabet[(triplet >> 12) & 0x3f];
    output += index + 1 < bytes.length ? alphabet[(triplet >> 6) & 0x3f] : "=";
    output += index + 2 < bytes.length ? alphabet[triplet & 0x3f] : "=";
  }

  return output;
}
