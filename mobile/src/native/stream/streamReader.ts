import {
  createBoardClock,
  createStreamCursor,
  parseStreamInfo,
  splitStreamRecords,
  STREAM_OP,
  type StreamCursorOptions,
  type StreamDelivery,
  type StreamFrame,
  type StreamInfo,
  type StreamKind,
  type StreamLossReason,
} from "@skate-route-mapper/shared/xiaoStream";
import { StreamCommandError, type CommandChannel } from "./commandChannel";

/**
 * Reads one stream off the board and hands it on complete and in order.
 *
 * The consumer sees a single ordered sequence of records and is told about the
 * stretches that will never arrive. Which path a record took — notified live,
 * or read back out of the board's window afterwards — is not visible to it and
 * is not supposed to be.
 *
 * Two modes over the same machinery:
 *
 * - **live**: notified frames are the fast path and repair runs behind them.
 *   The map colours in at radio latency, and holes fill a few seconds later.
 * - **bulk**: nothing is notified; the window is read end to end. A research
 *   capture, where latency does not matter and completeness is the point.
 *
 * Storage is the acknowledgement. `onRecords` returning is what lets the board
 * be told the records are safe, so "delivered" means written down on the phone
 * rather than handed to a radio.
 */

export type DeliveredRecord<TRecord> = {
  seq: number;
  value: TRecord;
  /**
   * When the board measured it, on the phone's clock — null until the clock
   * offset has been observed at least once.
   *
   * This, not arrival time, is where a record belongs. A repaired record can
   * arrive a minute after the road it describes.
   */
  atMs: number | null;
  /** True when this came from the window rather than a live notification. */
  repaired: boolean;
};

export type StreamLoss = {
  from: number;
  to: number;
  reason: StreamLossReason;
};

export type StreamReaderStats = {
  deliveredThrough: number;
  live: number;
  repaired: number;
  lost: number;
  pending: number;
  holes: number;
  dropped: number;
  /** Times the board restarted under us, losing whatever it was holding. */
  restarts: number;
  clockOffsetMs: number | null;
};

export type StreamReaderOptions<TRecord> = {
  streamId: number;
  kind: StreamKind<TRecord>;
  channel: CommandChannel;
  mode?: "live" | "bulk";
  /**
   * Store these. Records are in order and never repeated.
   *
   * Awaited: if it rejects, nothing is released and the board keeps the
   * records, so a failed write is retried rather than silently dropped.
   */
  onRecords: (records: DeliveredRecord<TRecord>[]) => void | Promise<void>;
  onLoss?: (loss: StreamLoss) => void;
  onInfo?: (info: StreamInfo) => void;
  onError?: (error: unknown, phase: "info" | "read" | "release" | "store") => void;
  /** Board uptime in ms for a decoded record, if it carries one. */
  uptimeOf?: (value: TRecord) => number;
  /** How often to ask the board what it is holding while all is well. */
  infoIntervalMs?: number;
  /** How long to wait between repair passes while holes remain. */
  repairIntervalMs?: number;
  /** Ranges requested per pass. More means faster repair, less room for live. */
  maxRangesPerPass?: number;
  /**
   * Carry on from this sequence rather than the board's live edge.
   *
   * A reconnect builds a new reader, and starting fresh would discard exactly
   * the stretch the board kept while the link was down. Pass the previous
   * reader's `deliveredThrough + 1`.
   */
  resumeFrom?: number;
  cursor?: StreamCursorOptions;
};

export type StreamReader = {
  start: () => void;
  stop: () => void;
  /** Hand in a notified frame. Cheap, synchronous, safe to call at 50 Hz. */
  offerFrame: (frame: StreamFrame) => void;
  /** Read the window to its end. Resolves when nothing more is available. */
  drain: () => Promise<void>;
  info: () => StreamInfo | null;
  stats: () => StreamReaderStats;
};

const defaultInfoIntervalMs = 5_000;
const defaultRepairIntervalMs = 750;
const defaultMaxRanges = 3;

/**
 * How far behind the newest record a live reader stops repairing.
 *
 * Half a second at 50 Hz. Repair takes everything older and leaves the tail to
 * notifications, which will deliver it for the cost of one packet.
 */
const defaultLiveLagRecords = 25;

export function createStreamReader<TRecord>(
  options: StreamReaderOptions<TRecord>
): StreamReader {
  const mode = options.mode ?? "live";
  const cursor = createStreamCursor({
    // A bulk read has nothing notifying it, so there is no tail to leave.
    liveLagRecords: mode === "bulk" ? 0 : defaultLiveLagRecords,
    ...options.cursor,
    ...(options.resumeFrom === undefined ? {} : { startAt: options.resumeFrom }),
  });
  const clock = createBoardClock();
  const infoIntervalMs = options.infoIntervalMs ?? defaultInfoIntervalMs;
  const repairIntervalMs = options.repairIntervalMs ?? defaultRepairIntervalMs;
  const maxRanges = options.maxRangesPerPass ?? defaultMaxRanges;

  let running = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let latest: StreamInfo | null = null;
  let releasedThrough = -1;
  let lostRecords = 0;

  // Deliveries are produced synchronously by the cursor but stored
  // asynchronously, so they wait here rather than racing each other into the
  // consumer out of order.
  let outbox: StreamDelivery[] = [];
  let draining = false;
  /** Sequences that came from a repair, so delivery can say which path a record took. */
  const repairedSeqs = new Set<number>();

  function decode(delivery: Extract<StreamDelivery, { type: "record" }>, repaired: boolean) {
    const value = options.kind.decode(delivery.record, delivery.seq);
    const uptime = options.uptimeOf?.(value);

    return {
      seq: delivery.seq,
      value,
      atMs: uptime === undefined ? null : clock.toPhoneTime(uptime),
      repaired,
    } satisfies DeliveredRecord<TRecord>;
  }

  function enqueue(deliveries: StreamDelivery[]) {
    if (deliveries.length > 0) {
      outbox.push(...deliveries);
      void pump();
    }
  }

  async function pump() {
    if (draining || outbox.length === 0) {
      return;
    }

    draining = true;

    try {
      while (outbox.length > 0) {
        const batch = outbox;
        outbox = [];

        // Runs of records go to storage together; a loss breaks the run so the
        // consumer is told about the hole in the position it occupies.
        let records: DeliveredRecord<TRecord>[] = [];

        for (const delivery of batch) {
          if (delivery.type === "record") {
            records.push(decode(delivery, repairedSeqs.has(delivery.seq)));
            repairedSeqs.delete(delivery.seq);
            continue;
          }

          if (records.length > 0) {
            await store(records);
            records = [];
          }

          lostRecords += delivery.to - delivery.from + 1;
          options.onLoss?.({ from: delivery.from, to: delivery.to, reason: delivery.reason });
        }

        if (records.length > 0) {
          await store(records);
        }
      }
    } finally {
      draining = false;
    }
  }

  async function store(records: DeliveredRecord<TRecord>[]) {
    try {
      await options.onRecords(records);
    } catch (error) {
      // Not released, so the board keeps them and the next pass can try again.
      options.onError?.(error, "store");
    }
  }

  function offerFrame(frame: StreamFrame) {
    if (frame.streamId !== options.streamId || !running) {
      return;
    }

    if (frame.record.length !== options.kind.stride) {
      return;
    }

    const value = options.kind.decode(frame.record, frame.seq);
    const uptime = options.uptimeOf?.(value);

    // Only live arrivals date the clock. A repaired record waited an unknown
    // time in the board's window, so it says nothing about the offset and
    // would only ever bias the estimate later.
    if (uptime !== undefined) {
      clock.observe(uptime, Date.now());
    }

    enqueue(cursor.accept([{ seq: frame.seq, record: frame.record }]));
  }

  async function readInfo(): Promise<StreamInfo | null> {
    try {
      const response = await options.channel.request({
        op: STREAM_OP.INFO,
        streamId: options.streamId,
      });

      latest = parseStreamInfo(response);
      options.onInfo?.(latest);
      enqueue(cursor.observe(latest));

      return latest;
    } catch (error) {
      options.onError?.(error, "info");
      return null;
    }
  }

  /** Request one range. Returns how many records were taken in. */
  async function repair(from: number, count: number): Promise<number> {
    try {
      const response = await options.channel.request({
        op: STREAM_OP.READ,
        streamId: options.streamId,
        arg: from,
      });

      const records = splitStreamRecords(response.payload, options.kind.stride);
      const arrivals = records
        .slice(0, count)
        .map((record, index) => ({ seq: response.offset + index, record }));

      for (const arrival of arrivals) {
        repairedSeqs.add(arrival.seq);
      }

      enqueue(cursor.accept(arrivals, { repaired: true }));

      return arrivals.length;
    } catch (error) {
      // An eviction is the board saying those records are gone. The next
      // `observe` will see the window has moved and write them off, so there
      // is nothing to do here but stop asking.
      if (!(error instanceof StreamCommandError && error.permanent)) {
        options.onError?.(error, "read");
      }

      return 0;
    }
  }

  async function release() {
    const through = cursor.deliveredThrough();

    if (through <= releasedThrough || !latest) {
      return;
    }

    try {
      await options.channel.request({
        op: STREAM_OP.RELEASE,
        streamId: options.streamId,
        // Exclusive: the first sequence the phone has *not* stored.
        arg: through + 1,
      });

      releasedThrough = through;
    } catch (error) {
      options.onError?.(error, "release");
    }
  }

  async function pass(): Promise<boolean> {
    const info = await readInfo();

    if (!info) {
      return false;
    }

    const ranges = cursor.backfill(info, maxRanges);
    let took = 0;

    for (const range of ranges) {
      took += await repair(range.from, range.count);
    }

    // Wait for storage before telling the board, so a release always means the
    // records are on disk rather than merely decoded.
    await pump();
    await release();

    return ranges.length > 0 || took > 0;
  }

  function schedule(delayMs: number) {
    if (!running) {
      return;
    }

    timer = setTimeout(() => {
      void (async () => {
        const busy = await pass();
        schedule(busy ? repairIntervalMs : infoIntervalMs);
      })();
    }, delayMs);
  }

  return {
    start() {
      if (running) {
        return;
      }

      running = true;
      // Bulk has nothing notifying it, so it starts reading at once; live
      // waits a beat so the first frames define the origin and it does not try
      // to repair history it was never going to use.
      schedule(mode === "bulk" ? 0 : repairIntervalMs);
    },

    stop() {
      running = false;

      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },

    offerFrame,

    async drain() {
      let guard = 0;

      // Bounded so a board that keeps producing faster than this can read
      // cannot hold the caller here forever.
      while (guard < 10_000) {
        guard += 1;

        const info = await readInfo();

        if (!info || cursor.deliveredThrough() >= info.nextSeq - 1) {
          break;
        }

        const ranges = cursor.backfill(info, maxRanges);

        if (ranges.length === 0) {
          break;
        }

        for (const range of ranges) {
          await repair(range.from, range.count);
        }

        await pump();
      }

      await pump();
      await release();
    },

    info() {
      return latest;
    },

    stats() {
      const stats = cursor.stats();

      return {
        deliveredThrough: stats.deliveredThrough,
        live: stats.liveRecords,
        repaired: stats.repairedRecords,
        lost: lostRecords,
        pending: stats.pending,
        holes: stats.holes,
        dropped: latest?.dropped ?? 0,
        restarts: stats.restarts,
        clockOffsetMs: clock.offsetMs(),
      };
    },
  };
}
