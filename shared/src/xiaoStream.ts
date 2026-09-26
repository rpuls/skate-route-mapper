/**
 * The board-to-phone stream transport.
 *
 * One mechanism carries everything the board has to say. A stream is an
 * append-only sequence of fixed-width records that the board keeps in a
 * durable window and the phone reads with a cursor. Nothing here knows what a
 * record means: the transport moves opaque bytes, and a `StreamKind` says how
 * to read them. Adding a new kind of data is a new kind, not a new protocol.
 *
 * Two delivery profiles sit on that one primitive, because the two things the
 * board sends have opposite requirements:
 *
 * - **Live** (a ride): records are notified as they are produced, so the map
 *   can colour in behind the rider. Notifications are cheap — one packet, no
 *   round trip — but the radio drops them under interference, so the same
 *   records also go into the board's window and the phone repairs the holes it
 *   detects. Low latency when the link is good, complete when it is not.
 * - **Bulk** (a research capture): the board records for a bounded time and the
 *   phone reads the window end to end afterwards. Latency is irrelevant;
 *   fidelity is everything.
 *
 * The difference between them is *when the phone reads*, not how. Both use
 * `STREAM_READ`, and both get the same integrity guarantees from it.
 *
 * Why a pull window rather than acknowledged pushes: BLE's link layer already
 * acknowledges and retransmits every packet, so records are never corrupted in
 * flight and an application-level ACK would buy nothing. What is actually lost
 * is data the board throws away before it reaches the radio, when it produces
 * faster than the link drains. A window fixes that at the source — the board
 * keeps what it could not send, and the phone asks for it later.
 */

/* ------------------------------------------------------------------ *
 * GATT
 * ------------------------------------------------------------------ */

/** Commands are written here. See {@link encodeStreamCommand}. */
export const XIAO_STREAM_CONTROL_UUID = "7b32f8d3-5d0b-4f0e-a1f5-8f30c44c0001";

/** Responses are read back from here. See {@link parseStreamResponse}. */
export const XIAO_STREAM_RESPONSE_UUID = "7b32f8d4-5d0b-4f0e-a1f5-8f30c44c0001";

/**
 * Live records are notified here, framed by {@link parseStreamFrame}.
 *
 * Separate from the legacy IMU characteristic so a board can serve both an old
 * client and a new one without sending everything twice.
 */
export const XIAO_STREAM_DATA_UUID = "7b32f8d5-5d0b-4f0e-a1f5-8f30c44c0001";

/* ------------------------------------------------------------------ *
 * Wire format
 * ------------------------------------------------------------------ */

/** Protocol version carried in every command and response. */
export const STREAM_PROTOCOL_VERSION = 1;

/** `"RS"`, so a truncated or foreign read is rejected rather than parsed. */
export const STREAM_RESPONSE_MAGIC = 0x5253;

export const STREAM_COMMAND_SIZE = 12;
export const STREAM_RESPONSE_HEADER_SIZE = 20;
export const STREAM_RESPONSE_CRC_SIZE = 4;

/** Bytes before the record payload in a live notification. */
export const STREAM_FRAME_HEADER_SIZE = 8;

/**
 * Operations.
 *
 * 1–4 are the original research capture ops and keep their numbers and meaning
 * so firmware and app can be updated independently. 5 and up are the stream
 * layer, and every future addition belongs there.
 */
export const STREAM_OP = {
  /** Research: capture status. */
  STATUS: 1,
  /** Research: begin a capture. */
  START: 2,
  /** Research: raw records. */
  RAW: 3,
  /** Research: per-window summaries. */
  SUMMARIES: 4,
  /** How many streams the board is serving, and their ids. */
  LIST: 5,
  /** One stream's window: what is retained, what is next, what was lost. */
  INFO: 6,
  /** A page of records from a given sequence. */
  READ: 7,
  /** Tell the board everything below a sequence is durably stored. */
  RELEASE: 8,
} as const;

export type StreamOp = (typeof STREAM_OP)[keyof typeof STREAM_OP];

/**
 * Why a request was refused.
 *
 * A response always parses; `flags` says whether its payload means anything.
 * Distinguishing these matters to the consumer: `RANGE` is worth retrying at a
 * corrected offset, `EVICTED` never is, and treating the second as the first
 * is an infinite loop.
 */
export const STREAM_FLAG = {
  OK: 0,
  /** The request was well formed but refused in the board's current state. */
  REJECTED: 1,
  /** The requested sequence is at or past the end of the stream. */
  RANGE: 2,
  /** Unknown operation. Older firmware, newer app. */
  UNSUPPORTED: 3,
  /** No such stream id. */
  NO_STREAM: 4,
  /** The records asked for have already been overwritten. Permanent. */
  EVICTED: 5,
} as const;

export type StreamFlag = (typeof STREAM_FLAG)[keyof typeof STREAM_FLAG];

/** Reserved stream ids. Kinds are open; ids are assigned by the firmware. */
export const STREAM_ID = {
  /** The 50 Hz ride preview, the stream that must feel live. */
  RIDE_IMU: 1,
  /** Research raw records, readable through the stream ops as well. */
  RESEARCH_RAW: 2,
  /** Research per-window summaries. */
  RESEARCH_SUMMARIES: 3,
} as const;

export type StreamResponse = {
  op: number;
  request: number;
  flags: number;
  streamId: number;
  /** Sequence of the first record in `payload`, or the op's argument. */
  offset: number;
  records: number;
  payload: Uint8Array;
};

/* ------------------------------------------------------------------ *
 * Integrity
 * ------------------------------------------------------------------ */

/**
 * CRC-32 (IEEE, reflected), matching the firmware's implementation byte for
 * byte.
 *
 * The link layer already protects against corruption, so this is not really
 * guarding the air. It guards everything else: a truncated ATT long read, a
 * stale characteristic value read twice, a firmware packing bug. Those are the
 * failures that would otherwise be silently written into a ride.
 */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;

  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }

  return (~crc) >>> 0;
}

/* ------------------------------------------------------------------ *
 * Commands
 * ------------------------------------------------------------------ */

export function encodeStreamCommand(params: {
  op: number;
  request: number;
  streamId?: number;
  arg?: number;
}): Uint8Array {
  const bytes = new Uint8Array(STREAM_COMMAND_SIZE);
  const view = new DataView(bytes.buffer);

  bytes[0] = STREAM_PROTOCOL_VERSION;
  bytes[1] = params.op;
  view.setUint16(2, params.request & 0xffff, true);
  view.setUint32(4, params.streamId ?? 0, true);
  view.setUint32(8, params.arg ?? 0, true);

  return bytes;
}

/**
 * Read a response, or explain why it is not one.
 *
 * Returns `null` for anything that is not a complete, self-consistent response
 * rather than throwing, because the consumer polls this characteristic and a
 * stale or half-written value is an expected intermediate state, not an error.
 */
export function parseStreamResponse(bytes: Uint8Array): StreamResponse | null {
  if (bytes.length < STREAM_RESPONSE_HEADER_SIZE + STREAM_RESPONSE_CRC_SIZE) {
    return null;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  if (view.getUint16(0, true) !== STREAM_RESPONSE_MAGIC) {
    return null;
  }

  if (bytes[2] !== STREAM_PROTOCOL_VERSION) {
    return null;
  }

  const payloadBytes = view.getUint16(18, true);
  const total = STREAM_RESPONSE_HEADER_SIZE + payloadBytes + STREAM_RESPONSE_CRC_SIZE;

  if (bytes.length < total) {
    return null;
  }

  const expected = view.getUint32(STREAM_RESPONSE_HEADER_SIZE + payloadBytes, true);

  if (crc32(bytes.subarray(0, STREAM_RESPONSE_HEADER_SIZE + payloadBytes)) !== expected) {
    return null;
  }

  return {
    op: view.getUint8(3),
    request: view.getUint16(4, true),
    flags: view.getUint16(6, true),
    streamId: view.getUint32(8, true),
    offset: view.getUint32(12, true),
    records: view.getUint16(16, true),
    payload: bytes.slice(STREAM_RESPONSE_HEADER_SIZE, STREAM_RESPONSE_HEADER_SIZE + payloadBytes),
  };
}

/* ------------------------------------------------------------------ *
 * Stream window
 * ------------------------------------------------------------------ */

/**
 * What the board is holding for one stream.
 *
 * `firstSeq`/`nextSeq` are the half-open window still readable. `dropped`
 * counts records the board overwrote before the phone read them — the one
 * number that says the window is too small or the link too slow, and the only
 * loss the phone cannot repair.
 */
export type StreamInfo = {
  streamId: number;
  kind: number;
  /** Bytes per record. The transport needs this; it does not need the layout. */
  stride: number;
  /** Records the window can hold. */
  capacity: number;
  /** Oldest sequence still readable. */
  firstSeq: number;
  /** One past the newest record written. */
  nextSeq: number;
  /** Highest sequence the phone has confirmed storing. */
  releasedSeq: number;
  /** Records overwritten before they were read. Unrecoverable. */
  dropped: number;
  /** Set while a producer is actively appending. */
  active: boolean;
};

export const STREAM_INFO_SIZE = 32;

export function parseStreamInfo(response: StreamResponse): StreamInfo {
  if (response.payload.length < STREAM_INFO_SIZE) {
    throw new Error(
      `Stream info needs ${STREAM_INFO_SIZE} bytes, received ${response.payload.length}`
    );
  }

  const view = new DataView(
    response.payload.buffer,
    response.payload.byteOffset,
    response.payload.byteLength
  );

  return {
    streamId: view.getUint32(0, true),
    kind: view.getUint16(4, true),
    stride: view.getUint16(6, true),
    capacity: view.getUint32(8, true),
    firstSeq: view.getUint32(12, true),
    nextSeq: view.getUint32(16, true),
    releasedSeq: view.getUint32(20, true),
    dropped: view.getUint32(24, true),
    active: view.getUint32(28, true) !== 0,
  };
}

/** Split a read payload into records. The board guarantees whole records. */
export function splitStreamRecords(payload: Uint8Array, stride: number): Uint8Array[] {
  if (stride <= 0) {
    throw new Error(`Stream stride must be positive, received ${stride}`);
  }

  const records: Uint8Array[] = [];

  for (let offset = 0; offset + stride <= payload.length; offset += stride) {
    records.push(payload.subarray(offset, offset + stride));
  }

  return records;
}

/* ------------------------------------------------------------------ *
 * Live frames
 * ------------------------------------------------------------------ */

export type StreamFrame = {
  streamId: number;
  seq: number;
  record: Uint8Array;
};

/**
 * A notified record.
 *
 * Carries its own stream id and sequence so one characteristic can serve every
 * stream, and so a frame means the same thing as the identical record read back
 * from the window later. The live path and the repair path produce the same
 * bytes, which is what lets one decoder serve both.
 *
 * Unverified by design: the link layer has already checked it, and a frame is
 * cheap to drop. A record that matters and did not arrive is repaired through
 * `STREAM_READ`, which is checked.
 */
export function parseStreamFrame(bytes: Uint8Array): StreamFrame | null {
  if (bytes.length <= STREAM_FRAME_HEADER_SIZE) {
    return null;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  return {
    streamId: view.getUint16(0, true),
    seq: view.getUint32(4, true),
    record: bytes.slice(STREAM_FRAME_HEADER_SIZE),
  };
}

/* ------------------------------------------------------------------ *
 * Kinds
 * ------------------------------------------------------------------ */

/**
 * What a record means.
 *
 * The transport never sees this. A kind is the single place that knows a
 * layout, so a new sort of board data is a `StreamKind` and a firmware producer
 * — no protocol change, no new characteristic, no new retry logic.
 *
 * `stride` is checked against the board's declared stride when a reader
 * attaches, which turns a firmware/app version mismatch into one clear error
 * instead of silently misparsed numbers.
 */
export type StreamKind<TRecord> = {
  id: number;
  name: string;
  stride: number;
  decode: (record: Uint8Array, seq: number) => TRecord;
};

export const STREAM_KIND = {
  /** 20-byte IMU packet, identical to the legacy notification layout. */
  IMU_PACKET: 1,
  /** 6-byte raw research record: three int16 accelerometer axes. */
  RESEARCH_RAW: 2,
  /** 24-byte research window summary. */
  RESEARCH_SUMMARY: 3,
} as const;

/**
 * The ride stream's record.
 *
 * Byte-identical to what the legacy IMU characteristic notifies, so the same
 * 20 bytes serve the live frame, the board's window and the old client. Keeping
 * one layout is worth the four bytes of sequence it duplicates.
 */
export type ImuStreamRecord = {
  sequence: number;
  uptimeMs: number;
  ax: number;
  ay: number;
  az: number;
  gx: number;
  gy: number;
  gz: number;
};

export const imuStreamKind: StreamKind<ImuStreamRecord> = {
  id: STREAM_KIND.IMU_PACKET,
  name: "imu",
  stride: 20,
  decode(record, seq) {
    const view = new DataView(record.buffer, record.byteOffset, record.byteLength);

    return {
      // The record carries the producer's own counter. It should equal the
      // stream sequence, but the stream sequence is what addressing is built
      // on, so that is what is trusted.
      sequence: seq,
      uptimeMs: view.getUint32(4, true),
      ax: view.getInt16(8, true) / 1000,
      ay: view.getInt16(10, true) / 1000,
      az: view.getInt16(12, true) / 1000,
      gx: (view.getInt16(14, true) / 1000) * (Math.PI / 180),
      gy: (view.getInt16(16, true) / 1000) * (Math.PI / 180),
      gz: (view.getInt16(18, true) / 1000) * (Math.PI / 180),
    };
  },
};

/* ------------------------------------------------------------------ *
 * The cursor
 * ------------------------------------------------------------------ */

/**
 * What a cursor hands to its consumer.
 *
 * `lost` is as important as `record`. A consumer that is told which sequences
 * will never arrive can mark that stretch of road unmeasured; one that is only
 * told about successes silently treats a hole as smooth tarmac.
 */
export type StreamDelivery =
  | { type: "record"; seq: number; record: Uint8Array }
  | { type: "lost"; from: number; to: number; reason: StreamLossReason };

/**
 * Why records will never arrive.
 *
 * - `evicted` — the board overwrote them before the phone asked. The window is
 *   too small, or the link was down too long.
 * - `expired` — still readable, but the consumer waited longer than it is
 *   willing to. Repair has a deadline so a live map cannot stall forever.
 * - `overflow` — too many records are held behind an unfilled hole. The cursor
 *   is bounded, so the oldest hole is abandoned to make room.
 */
export type StreamLossReason = "evicted" | "expired" | "overflow";

export type BackfillRange = {
  from: number;
  count: number;
};

export type StreamCursorOptions = {
  /**
   * How many out-of-order records may be held behind a hole.
   *
   * At 50 Hz this is the amount of live data that keeps flowing while a repair
   * is in progress. Past it the oldest hole is declared lost, which trades
   * completeness for a bounded footprint on a phone that must also be
   * recording a ride.
   */
  maxPendingRecords?: number;
  /**
   * How long a hole may block delivery before it is declared lost.
   *
   * A hole in a stream nobody is repairing would otherwise stall the consumer
   * indefinitely, which for a ride means a map that stops updating.
   */
  maxHoldMs?: number;
  /** Records per backfill request; the board's page size bounds this too. */
  backfillBatch?: number;
  /**
   * How far behind the board's newest record repair stops.
   *
   * Without this the cursor would request records a notification is about to
   * deliver anyway, wasting the radio on the live path's work. With it, repair
   * takes everything older than the lag and leaves the tail to notifications.
   *
   * Zero for a bulk read, where nothing is being notified and the whole window
   * is the point. Around half a second's worth for a live stream.
   */
  liveLagRecords?: number;
  /**
   * Resume from this sequence instead of the board's live edge.
   *
   * A reconnect builds a new cursor, and attaching at the live edge would
   * throw away exactly the stretch the board held on to while the link was
   * down. Passing the last delivered sequence back in is what makes a dropout
   * recoverable rather than merely survivable.
   */
  startAt?: number;
};

export type StreamCursorStats = {
  deliveredThrough: number;
  pending: number;
  holes: number;
  lostRecords: number;
  repairedRecords: number;
  liveRecords: number;
  /** Times the board's sequence went backwards, meaning it restarted. */
  restarts: number;
};

export type StreamCursor = {
  /**
   * Take records from either path.
   *
   * Duplicates are dropped, order is restored, and nothing is handed on until
   * every record before it has been delivered or declared lost — so a consumer
   * sees one monotonic, gap-free sequence whichever path a record arrived by.
   */
  accept: (
    arrivals: readonly { seq: number; record: Uint8Array }[],
    options?: { nowMs?: number; repaired?: boolean }
  ) => StreamDelivery[];
  /**
   * Reconcile with the board's window.
   *
   * Anything below `firstSeq` is gone for good and is declared lost here rather
   * than being requested forever. A first call also adopts `nextSeq` as the
   * starting point, so a reader that attaches mid-stream does not try to repair
   * everything the board ever produced.
   */
  observe: (info: StreamInfo, options?: { nowMs?: number }) => StreamDelivery[];
  /** Ranges worth requesting, newest hole first, clamped to the window. */
  backfill: (info: StreamInfo, maxRanges?: number) => BackfillRange[];
  /** Highest sequence delivered or written off. Safe to `STREAM_RELEASE`. */
  deliveredThrough: () => number;
  /** Expire holes that have waited too long, without new arrivals. */
  sweep: (nowMs: number) => StreamDelivery[];
  stats: () => StreamCursorStats;
};

const defaultMaxPending = 4_000;
const defaultMaxHoldMs = 20_000;
const defaultBackfillBatch = 64;

/**
 * The receive window.
 *
 * Deliberately pure: no BLE, no timers, no storage. Everything that decides
 * whether a ride keeps its data lives here, where it can be tested against
 * ordered, reordered, duplicated, delayed and evicted arrivals without a board.
 */
export function createStreamCursor(options: StreamCursorOptions = {}): StreamCursor {
  const maxPending = options.maxPendingRecords ?? defaultMaxPending;
  const maxHoldMs = options.maxHoldMs ?? defaultMaxHoldMs;
  const backfillBatch = options.backfillBatch ?? defaultBackfillBatch;
  const liveLag = options.liveLagRecords ?? 0;

  /** Records that arrived before the ones in front of them. */
  const pending = new Map<number, Uint8Array>();
  /** When each hole was first noticed, for the hold deadline. */
  const holeFirstSeenAt = new Map<number, number>();

  let deliveredThrough = options.startAt === undefined ? -1 : options.startAt - 1;
  let started = options.startAt !== undefined;
  let restarts = 0;
  let lostRecords = 0;
  let repairedRecords = 0;
  let liveRecords = 0;

  function drain(out: StreamDelivery[]) {
    while (pending.has(deliveredThrough + 1)) {
      const seq = deliveredThrough + 1;
      const record = pending.get(seq) as Uint8Array;

      pending.delete(seq);
      holeFirstSeenAt.delete(seq);
      deliveredThrough = seq;
      out.push({ type: "record", seq, record });
    }
  }

  /** Abandon everything up to and including `through`, then deliver what unblocks. */
  function writeOff(through: number, reason: StreamLossReason, out: StreamDelivery[]) {
    if (through <= deliveredThrough) {
      return;
    }

    let from = deliveredThrough + 1;
    let to = from - 1;

    // A run of missing sequences is reported as one loss, but a record that did
    // arrive inside that range is still delivered — it is real data, and the
    // consumer asked for whatever could be saved.
    for (let seq = deliveredThrough + 1; seq <= through; seq += 1) {
      if (pending.has(seq)) {
        if (to >= from) {
          lostRecords += to - from + 1;
          out.push({ type: "lost", from, to, reason });
        }

        const record = pending.get(seq) as Uint8Array;
        pending.delete(seq);
        holeFirstSeenAt.delete(seq);
        out.push({ type: "record", seq, record });
        from = seq + 1;
        to = seq;
      } else {
        holeFirstSeenAt.delete(seq);
        to = seq;
      }
    }

    if (to >= from) {
      lostRecords += to - from + 1;
      out.push({ type: "lost", from, to, reason });
    }

    deliveredThrough = through;
    drain(out);
  }

  function noteHoles(upTo: number, nowMs: number) {
    for (let seq = deliveredThrough + 1; seq < upTo; seq += 1) {
      if (!pending.has(seq) && !holeFirstSeenAt.has(seq)) {
        holeFirstSeenAt.set(seq, nowMs);
      }
    }
  }

  function expire(nowMs: number, out: StreamDelivery[]) {
    let oldest = -1;

    for (const [seq, seenAt] of holeFirstSeenAt) {
      if (nowMs - seenAt >= maxHoldMs && seq > oldest) {
        oldest = seq;
      }
    }

    if (oldest >= 0) {
      writeOff(oldest, "expired", out);
    }
  }

  function enforceBound(out: StreamDelivery[]) {
    while (pending.size > maxPending) {
      // The lowest pending sequence is the one waiting on the oldest hole, so
      // writing off everything below it is what actually releases memory.
      let lowest = Number.POSITIVE_INFINITY;

      for (const seq of pending.keys()) {
        if (seq < lowest) {
          lowest = seq;
        }
      }

      if (!Number.isFinite(lowest) || lowest <= deliveredThrough + 1) {
        break;
      }

      writeOff(lowest - 1, "overflow", out);
    }
  }

  return {
    accept(arrivals, acceptOptions = {}) {
      const nowMs = acceptOptions.nowMs ?? Date.now();
      const out: StreamDelivery[] = [];

      for (const arrival of arrivals) {
        if (!started) {
          // The first record seen defines the origin. Without this a reader
          // attaching to a board that has been running for an hour would count
          // every earlier sequence as a hole and try to repair all of it.
          started = true;
          deliveredThrough = arrival.seq - 1;
        }

        if (arrival.seq <= deliveredThrough || pending.has(arrival.seq)) {
          continue;
        }

        if (acceptOptions.repaired) {
          repairedRecords += 1;
        } else {
          liveRecords += 1;
        }

        noteHoles(arrival.seq, nowMs);
        pending.set(arrival.seq, arrival.record);
        holeFirstSeenAt.delete(arrival.seq);
      }

      drain(out);
      expire(nowMs, out);
      enforceBound(out);

      return out;
    },

    observe(info, observeOptions = {}) {
      const nowMs = observeOptions.nowMs ?? Date.now();
      const out: StreamDelivery[] = [];

      if (!started) {
        started = true;
        // Attach at the live edge. History still in the window is not this
        // ride's data, and reading it would delay the records that are.
        deliveredThrough = info.nextSeq - 1;
        return out;
      }

      if (info.nextSeq <= deliveredThrough) {
        // Sequences only go backwards when the board has restarted — a
        // brown-out, or a reset. Everything it was holding is gone, and how
        // much of it there was is not knowable from here, so no range is
        // invented. Resuming from the old numbering would ask for records that
        // will not exist for another minute.
        restarts += 1;
        pending.clear();
        holeFirstSeenAt.clear();
        deliveredThrough = info.nextSeq - 1;
        return out;
      }

      if (info.firstSeq > deliveredThrough + 1) {
        writeOff(info.firstSeq - 1, "evicted", out);
      }

      noteHoles(info.nextSeq, nowMs);
      expire(nowMs, out);
      enforceBound(out);

      return out;
    },

    backfill(info, maxRanges = 4) {
      if (!started || maxRanges <= 0) {
        return [];
      }

      const ranges: BackfillRange[] = [];
      // Everything older than the live lag is fair game, and so is anything
      // below a record already in hand — a hole with data behind it is a hole
      // no notification is going to fill.
      const ceiling = Math.min(
        info.nextSeq,
        Math.max(highestPending() + 1, info.nextSeq - liveLag)
      );
      let seq = Math.max(deliveredThrough + 1, info.firstSeq);

      while (seq < ceiling && ranges.length < maxRanges) {
        if (pending.has(seq)) {
          seq += 1;
          continue;
        }

        const from = seq;
        let count = 0;

        while (
          seq < ceiling &&
          !pending.has(seq) &&
          count < Math.min(backfillBatch, info.capacity || backfillBatch)
        ) {
          seq += 1;
          count += 1;
        }

        ranges.push({ from, count });
      }

      return ranges;
    },

    deliveredThrough() {
      return deliveredThrough;
    },

    sweep(nowMs) {
      const out: StreamDelivery[] = [];
      expire(nowMs, out);
      enforceBound(out);
      return out;
    },

    stats() {
      return {
        deliveredThrough,
        pending: pending.size,
        holes: countHoles(),
        lostRecords,
        repairedRecords,
        liveRecords,
        restarts,
      };
    },
  };

  function highestPending() {
    let highest = deliveredThrough;

    for (const seq of pending.keys()) {
      if (seq > highest) {
        highest = seq;
      }
    }

    return highest;
  }

  function countHoles() {
    const ceiling = highestPending();
    let holes = 0;

    for (let seq = deliveredThrough + 1; seq <= ceiling; seq += 1) {
      if (!pending.has(seq)) {
        holes += 1;
      }
    }

    return holes;
  }
}

/* ------------------------------------------------------------------ *
 * Board clock
 * ------------------------------------------------------------------ */

/**
 * Board uptime translated to phone time.
 *
 * Needed the moment records can arrive late. A repaired record carries the
 * board's `millis()` from when it was measured, and joining it to the phone's
 * clock at *arrival* would place a stretch of road wherever the rider happened
 * to be when the link came back. The board's timestamp is the only thing that
 * says where a record belongs.
 *
 * The estimate is the minimum observed `phoneTime - boardUptime`, because that
 * is the sample that waited least in the radio: transport delay only ever
 * pushes the difference up, so the smallest one seen is the closest to the true
 * offset. It decays slowly so the estimate can follow clock drift instead of
 * being pinned by one lucky early sample.
 */
export type BoardClock = {
  /** Offer a live arrival. Ignored for repaired records, which waited. */
  observe: (boardUptimeMs: number, phoneNowMs: number) => void;
  /** Phone time for a board timestamp, or null before the first observation. */
  toPhoneTime: (boardUptimeMs: number) => number | null;
  offsetMs: () => number | null;
  reset: () => void;
};

const clockDecayPerMs = 1 / 60_000;

export function createBoardClock(): BoardClock {
  let offsetMs: number | null = null;
  let lastObservedAt = 0;

  return {
    observe(boardUptimeMs, phoneNowMs) {
      const candidate = phoneNowMs - boardUptimeMs;

      if (offsetMs === null) {
        offsetMs = candidate;
        lastObservedAt = phoneNowMs;
        return;
      }

      // Let the floor rise slowly so a board clock running slightly fast is
      // tracked rather than accumulating error against a stale minimum.
      const elapsed = Math.max(0, phoneNowMs - lastObservedAt);
      offsetMs = Math.min(candidate, offsetMs + elapsed * clockDecayPerMs);
      lastObservedAt = phoneNowMs;
    },

    toPhoneTime(boardUptimeMs) {
      return offsetMs === null ? null : boardUptimeMs + offsetMs;
    },

    offsetMs() {
      return offsetMs;
    },

    reset() {
      offsetMs = null;
      lastObservedAt = 0;
    },
  };
}
