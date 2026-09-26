import {
  encodeStreamCommand,
  parseStreamResponse,
  STREAM_FLAG,
  XIAO_STREAM_CONTROL_UUID,
  XIAO_STREAM_RESPONSE_UUID,
  type StreamResponse,
} from "@skate-route-mapper/shared/xiaoStream";
import { XIAO_BLE_SERVICE_UUID } from "@skate-route-mapper/shared/xiaoBle";
import { base64ToBytes, bytesToBase64 } from "./base64";

/**
 * The one way to ask the board a question.
 *
 * The board answers by leaving a value on a single response characteristic
 * until the next command replaces it. That makes concurrency a correctness
 * problem rather than a performance one: two callers in flight at once and one
 * will read the other's answer, or overwrite the command it is still waiting
 * for. So every request in the app funnels through one channel per connection
 * and is serialised here.
 *
 * That is also why this is a channel rather than a function — research
 * transfers and ride backfill happen at the same time, and they have to take
 * turns.
 */

/** The slice of a `react-native-ble-plx` device this needs. */
export type CommandDevice = {
  writeCharacteristicWithResponseForService: (
    serviceUuid: string,
    characteristicUuid: string,
    valueBase64: string
  ) => Promise<unknown>;
  readCharacteristicForService: (
    serviceUuid: string,
    characteristicUuid: string
  ) => Promise<{ value: string | null }>;
};

export type CommandRequest = {
  op: number;
  streamId?: number;
  arg?: number;
  /**
   * How many times to send it. Defaults to 3.
   *
   * Only safe above 1 for requests that change nothing on the board. Reads are
   * idempotent by construction — a page is addressed by sequence, so asking
   * twice returns the same bytes — but anything that starts or alters
   * something must pass 1 and handle the failure itself.
   */
  attempts?: number;
  timeoutMs?: number;
  pollIntervalMs?: number;
};

export type CommandAttemptEvent = {
  op: number;
  streamId: number;
  arg: number;
  attempt: number;
  ms: number;
  polls: number;
  ok: boolean;
  flags?: number;
  records?: number;
  error?: unknown;
};

export type CommandChannel = {
  request: (request: CommandRequest) => Promise<StreamResponse>;
  /** True while a request is in flight, so probes can stay out of the way. */
  busy: () => boolean;
};

export type CommandChannelOptions = {
  /**
   * Told about every attempt, including the ones that fail.
   *
   * Injected rather than imported so this module can be exercised without the
   * diagnostics log, and with it the file system and the BLE stack.
   */
  onAttempt?: (event: CommandAttemptEvent) => void;
};

const defaultTimeoutMs = 5_000;
const defaultPollIntervalMs = 30;
const defaultAttempts = 3;
const retryBackoffMs = 150;

/** A board refusal, as opposed to a link failure. Carries the reason. */
export class StreamCommandError extends Error {
  readonly flags: number;
  readonly op: number;

  constructor(message: string, op: number, flags: number) {
    super(message);
    this.name = "StreamCommandError";
    this.op = op;
    this.flags = flags;
  }

  /** True when asking again cannot help, whatever the link does. */
  get permanent() {
    return (
      this.flags === STREAM_FLAG.EVICTED ||
      this.flags === STREAM_FLAG.NO_STREAM ||
      // Firmware older than the stream layer. Retrying will never make it
      // understand the op.
      this.flags === STREAM_FLAG.UNSUPPORTED
    );
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createCommandChannel(
  device: CommandDevice,
  options: CommandChannelOptions = {}
): CommandChannel {
  let requestId = 0;
  let inFlight = 0;
  // Requests queue behind one another on this chain rather than racing for the
  // response characteristic.
  let queue: Promise<unknown> = Promise.resolve();

  /** A response plus how many reads it took, which only the log cares about. */
  type Attempt = { response: StreamResponse; polls: number };

  async function attempt(request: CommandRequest, id: number): Promise<Attempt> {
    const timeoutMs = request.timeoutMs ?? defaultTimeoutMs;
    const pollIntervalMs = request.pollIntervalMs ?? defaultPollIntervalMs;

    await device.writeCharacteristicWithResponseForService(
      XIAO_BLE_SERVICE_UUID,
      XIAO_STREAM_CONTROL_UUID,
      bytesToBase64(
        encodeStreamCommand({
          op: request.op,
          request: id,
          streamId: request.streamId,
          arg: request.arg,
        })
      )
    );

    const deadline = Date.now() + timeoutMs;
    let polls = 0;

    while (Date.now() < deadline) {
      polls += 1;

      const characteristic = await device.readCharacteristicForService(
        XIAO_BLE_SERVICE_UUID,
        XIAO_STREAM_RESPONSE_UUID
      );

      if (characteristic.value) {
        const response = parseStreamResponse(base64ToBytes(characteristic.value));

        // A response for a different id is the previous command's answer,
        // still sitting there because the board has not processed ours yet.
        if (response && response.request === id && response.op === request.op) {
          return { response, polls };
        }
      }

      await sleep(pollIntervalMs);
    }

    throw new Error(`Board did not answer op ${request.op} within ${timeoutMs} ms`);
  }

  async function run(request: CommandRequest): Promise<StreamResponse> {
    const attempts = request.attempts ?? defaultAttempts;
    let lastError: unknown = null;

    for (let index = 0; index < attempts; index += 1) {
      const startedAt = Date.now();
      requestId = (requestId + 1) & 0xffff;

      try {
        const { response, polls } = await attempt(request, requestId);

        if (response.flags !== STREAM_FLAG.OK) {
          const error = new StreamCommandError(
            `Board refused op ${request.op} (flag ${response.flags})`,
            request.op,
            response.flags
          );

          options.onAttempt?.({
            op: request.op,
            streamId: request.streamId ?? 0,
            arg: request.arg ?? 0,
            attempt: index,
            ms: Date.now() - startedAt,
            polls,
            ok: false,
            flags: response.flags,
          });

          // A refusal is the board's considered answer, not a lost packet.
          // Retrying an eviction would loop forever against data that is gone.
          if (error.permanent) {
            throw error;
          }

          lastError = error;
        } else {
          options.onAttempt?.({
            op: request.op,
            streamId: request.streamId ?? 0,
            arg: request.arg ?? 0,
            attempt: index,
            ms: Date.now() - startedAt,
            polls,
            ok: true,
            flags: response.flags,
            records: response.records,
          });

          return response;
        }
      } catch (error) {
        if (error instanceof StreamCommandError && error.permanent) {
          throw error;
        }

        lastError = error;

        options.onAttempt?.({
          op: request.op,
          streamId: request.streamId ?? 0,
          arg: request.arg ?? 0,
          attempt: index,
          ms: Date.now() - startedAt,
          polls: 0,
          ok: false,
          error,
        });
      }

      if (index + 1 < attempts) {
        await sleep(retryBackoffMs);
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error(`Board request failed for op ${request.op}`);
  }

  return {
    request(request) {
      const result = queue.then(() => {
        inFlight += 1;
        return run(request).finally(() => {
          inFlight -= 1;
        });
      });

      // The queue must survive a failed request, or one error would wedge
      // every later one behind a rejected promise.
      queue = result.catch(() => undefined);

      return result;
    },

    busy() {
      return inFlight > 0;
    },
  };
}
