import {
  OP,
  RESEARCH_CONTROL_UUID,
  RESEARCH_RESPONSE_UUID,
  command,
  parseResponse,
  type ResearchResponse,
} from "@skate-route-mapper/shared/xiaoResearch";
import type { BluetoothCharacteristicLike, BluetoothServiceLike } from "./browserHardware";

const sleep = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));
let requestSerial = 0;

export class ResearchClient {
  private control: BluetoothCharacteristicLike | null = null;
  private response: BluetoothCharacteristicLike | null = null;
  private active = true;

  constructor(private readonly service: BluetoothServiceLike) {}

  close() {
    this.active = false;
  }

  async request(op: number, captureId = 0, argument = 0): Promise<ResearchResponse> {
    if (!this.active) throw new Error("BLE connection changed; reconnect and check the recorder");
    if (!this.control || !this.response) {
      [this.control, this.response] = await Promise.all([
        this.service.getCharacteristic(RESEARCH_CONTROL_UUID),
        this.service.getCharacteristic(RESEARCH_RESPONSE_UUID),
      ]);
    }

    const requestId = (++requestSerial) & 0xffff;
    let lastError: unknown = new Error("Board response timed out");
    const attempts = op === OP.START ? 1 : 3;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        await this.control.writeValueWithResponse(command(op, requestId, captureId, argument));
        const deadline = performance.now() + 5000;
        while (performance.now() < deadline) {
          if (!this.active) throw new Error("BLE disconnected; reconnect and retrieve again");
          const value = await this.response.readValue();
          const result = parseResponse(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
          if (result.request === requestId && result.op === op) {
            if (result.flags) throw new Error(`Board rejected request (${result.flags}); check recording state and capacity`);
            if ([OP.RAW, OP.SUMMARIES].includes(op as 3 | 4)
              && (result.captureId !== captureId || result.offset !== argument)) {
              throw new Error("Recording page identity mismatch");
            }
            return result;
          }
          await sleep(30);
        }
        throw new Error("Board response timed out");
      } catch (error) {
        lastError = error;
        if (!this.active) break;
        await sleep(150);
      }
    }
    throw lastError;
  }
}
