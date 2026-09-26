import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createBoardClock,
  createStreamCursor,
  crc32,
  encodeStreamCommand,
  imuStreamKind,
  parseStreamFrame,
  parseStreamInfo,
  parseStreamResponse,
  splitStreamRecords,
  STREAM_FLAG,
  STREAM_FRAME_HEADER_SIZE,
  STREAM_INFO_SIZE,
  STREAM_OP,
  STREAM_RESPONSE_HEADER_SIZE,
  type StreamDelivery,
  type StreamInfo,
} from "@skate-route-mapper/shared/xiaoStream";

/**
 * The transport's correctness lives in the cursor and the wire format, both of
 * which are pure. Everything a ride depends on — that records arrive in order,
 * exactly once, and that the stretches which will never arrive are named
 * rather than silently skipped — is decided here and can be checked without a
 * board, a radio or a phone.
 */

/* ------------------------------------------------------------------ *
 * Helpers that stand in for the firmware
 * ------------------------------------------------------------------ */

/** Builds a response exactly as StreamTransport.h frames one. */
function boardResponse(params: {
  op: number;
  request: number;
  flags?: number;
  streamId?: number;
  offset?: number;
  records?: number;
  payload?: Uint8Array;
}) {
  const payload = params.payload ?? new Uint8Array(0);
  const bytes = new Uint8Array(
    STREAM_RESPONSE_HEADER_SIZE + payload.length + 4
  );
  const view = new DataView(bytes.buffer);

  view.setUint16(0, 0x5253, true);
  bytes[2] = 1;
  bytes[3] = params.op;
  view.setUint16(4, params.request, true);
  view.setUint16(6, params.flags ?? 0, true);
  view.setUint32(8, params.streamId ?? 0, true);
  view.setUint32(12, params.offset ?? 0, true);
  view.setUint16(16, params.records ?? 0, true);
  view.setUint16(18, payload.length, true);
  bytes.set(payload, STREAM_RESPONSE_HEADER_SIZE);
  view.setUint32(
    STREAM_RESPONSE_HEADER_SIZE + payload.length,
    crc32(bytes.subarray(0, STREAM_RESPONSE_HEADER_SIZE + payload.length)),
    true
  );

  return bytes;
}

function boardInfo(info: Partial<StreamInfo> & { streamId: number }) {
  const payload = new Uint8Array(STREAM_INFO_SIZE);
  const view = new DataView(payload.buffer);

  view.setUint32(0, info.streamId, true);
  view.setUint16(4, info.kind ?? 1, true);
  view.setUint16(6, info.stride ?? 20, true);
  view.setUint32(8, info.capacity ?? 1000, true);
  view.setUint32(12, info.firstSeq ?? 0, true);
  view.setUint32(16, info.nextSeq ?? 0, true);
  view.setUint32(20, info.releasedSeq ?? 0, true);
  view.setUint32(24, info.dropped ?? 0, true);
  view.setUint32(28, info.active ? 1 : 0, true);

  return payload;
}

function windowOf(params: Partial<StreamInfo>): StreamInfo {
  return {
    streamId: 1,
    kind: 1,
    stride: 20,
    capacity: 1000,
    firstSeq: 0,
    nextSeq: 0,
    releasedSeq: 0,
    dropped: 0,
    active: true,
    ...params,
  };
}

/** A record whose bytes encode its own sequence, so mix-ups are visible. */
function recordFor(seq: number, uptimeMs = seq * 20) {
  const bytes = new Uint8Array(20);
  const view = new DataView(bytes.buffer);

  view.setUint32(0, seq, true);
  view.setUint32(4, uptimeMs, true);
  view.setInt16(8, seq, true);

  return bytes;
}

function seqsOf(deliveries: StreamDelivery[]) {
  return deliveries
    .filter((delivery) => delivery.type === "record")
    .map((delivery) => (delivery as { seq: number }).seq);
}

function lossesOf(deliveries: StreamDelivery[]) {
  return deliveries
    .filter((delivery) => delivery.type === "lost")
    .map((delivery) => delivery as { from: number; to: number; reason: string });
}

/* ------------------------------------------------------------------ *
 * Wire format
 * ------------------------------------------------------------------ */

describe("stream wire format", () => {
  it("round-trips a command", () => {
    const bytes = encodeStreamCommand({
      op: STREAM_OP.READ,
      request: 0x1234,
      streamId: 7,
      arg: 900_001,
    });

    assert.equal(bytes.length, 12);
    assert.equal(bytes[0], 1);
    assert.equal(bytes[1], STREAM_OP.READ);

    const view = new DataView(bytes.buffer);
    assert.equal(view.getUint16(2, true), 0x1234);
    assert.equal(view.getUint32(4, true), 7);
    assert.equal(view.getUint32(8, true), 900_001);
  });

  it("parses a board response and its records", () => {
    const payload = new Uint8Array([...recordFor(40), ...recordFor(41)]);
    const response = parseStreamResponse(
      boardResponse({
        op: STREAM_OP.READ,
        request: 9,
        streamId: 1,
        offset: 40,
        records: 2,
        payload,
      })
    );

    assert.ok(response);
    assert.equal(response.op, STREAM_OP.READ);
    assert.equal(response.request, 9);
    assert.equal(response.offset, 40);
    assert.equal(response.records, 2);

    const records = splitStreamRecords(response.payload, 20);
    assert.equal(records.length, 2);
    assert.equal(imuStreamKind.decode(records[0], 40).uptimeMs, 800);
  });

  it("rejects a corrupted payload rather than parsing it", () => {
    const bytes = boardResponse({
      op: STREAM_OP.READ,
      request: 1,
      records: 1,
      payload: recordFor(3),
    });

    // A single flipped byte anywhere in the record must not reach a ride.
    bytes[STREAM_RESPONSE_HEADER_SIZE + 2] ^= 0x01;

    assert.equal(parseStreamResponse(bytes), null);
  });

  it("rejects a truncated read", () => {
    const full = boardResponse({
      op: STREAM_OP.READ,
      request: 1,
      records: 2,
      payload: new Uint8Array([...recordFor(1), ...recordFor(2)]),
    });

    // An ATT long read that stopped early looks exactly like this.
    assert.equal(parseStreamResponse(full.subarray(0, full.length - 8)), null);
  });

  it("carries a refusal without pretending it has data", () => {
    const response = parseStreamResponse(
      boardResponse({ op: STREAM_OP.READ, request: 4, flags: STREAM_FLAG.EVICTED })
    );

    assert.ok(response);
    assert.equal(response.flags, STREAM_FLAG.EVICTED);
    assert.equal(response.payload.length, 0);
  });

  it("reads a stream window", () => {
    const response = parseStreamResponse(
      boardResponse({
        op: STREAM_OP.INFO,
        request: 2,
        records: 1,
        payload: boardInfo({
          streamId: 1,
          firstSeq: 500,
          nextSeq: 1500,
          capacity: 1000,
          dropped: 42,
          active: true,
        }),
      })
    );

    assert.ok(response);

    const info = parseStreamInfo(response);
    assert.equal(info.firstSeq, 500);
    assert.equal(info.nextSeq, 1500);
    assert.equal(info.dropped, 42);
    assert.equal(info.active, true);
  });

  it("parses a live frame", () => {
    const frame = new Uint8Array(STREAM_FRAME_HEADER_SIZE + 20);
    const view = new DataView(frame.buffer);

    view.setUint16(0, 1, true);
    view.setUint32(4, 12_345, true);
    frame.set(recordFor(12_345), STREAM_FRAME_HEADER_SIZE);

    const parsed = parseStreamFrame(frame);

    assert.ok(parsed);
    assert.equal(parsed.streamId, 1);
    assert.equal(parsed.seq, 12_345);
    assert.equal(parsed.record.length, 20);
  });
});

/* ------------------------------------------------------------------ *
 * The cursor
 * ------------------------------------------------------------------ */

describe("stream cursor", () => {
  it("delivers an unbroken run straight through", () => {
    const cursor = createStreamCursor();
    const out = cursor.accept(
      [100, 101, 102].map((seq) => ({ seq, record: recordFor(seq) })),
      { nowMs: 1000 }
    );

    assert.deepEqual(seqsOf(out), [100, 101, 102]);
    assert.equal(cursor.deliveredThrough(), 102);
  });

  it("holds a record that arrived early until the hole in front of it fills", () => {
    const cursor = createStreamCursor();

    cursor.accept([{ seq: 10, record: recordFor(10) }], { nowMs: 0 });

    // 12 arrives while 11 is still missing: nothing may be delivered yet, or
    // the consumer would see a stretch of road out of order.
    const early = cursor.accept([{ seq: 12, record: recordFor(12) }], { nowMs: 10 });
    assert.deepEqual(seqsOf(early), []);
    assert.equal(cursor.deliveredThrough(), 10);

    const filled = cursor.accept([{ seq: 11, record: recordFor(11) }], {
      nowMs: 20,
      repaired: true,
    });

    assert.deepEqual(seqsOf(filled), [11, 12]);
    assert.equal(cursor.deliveredThrough(), 12);
  });

  it("ignores a record it has already delivered", () => {
    const cursor = createStreamCursor();

    cursor.accept([{ seq: 5, record: recordFor(5) }], { nowMs: 0 });
    cursor.accept([{ seq: 6, record: recordFor(6) }], { nowMs: 0 });

    // A repair that races a late notification delivers the same record twice.
    const again = cursor.accept([{ seq: 6, record: recordFor(6) }], { nowMs: 1 });

    assert.deepEqual(seqsOf(again), []);
    assert.equal(cursor.stats().deliveredThrough, 6);
  });

  it("asks for exactly the sequences it is missing", () => {
    const cursor = createStreamCursor({ backfillBatch: 64 });

    cursor.accept(
      [{ seq: 0, record: recordFor(0) }, { seq: 5, record: recordFor(5) }],
      { nowMs: 0 }
    );

    const ranges = cursor.backfill(windowOf({ firstSeq: 0, nextSeq: 6 }), 4);

    assert.deepEqual(ranges, [{ from: 1, count: 4 }]);
  });

  it("does not ask for records the board never had", () => {
    const cursor = createStreamCursor();

    cursor.accept([{ seq: 100, record: recordFor(100) }], { nowMs: 0 });
    cursor.accept([{ seq: 104, record: recordFor(104) }], { nowMs: 0 });

    // The window starts at 102, so 101 is gone and only 102-103 are worth asking for.
    const ranges = cursor.backfill(windowOf({ firstSeq: 102, nextSeq: 105 }), 4);

    assert.deepEqual(ranges, [{ from: 102, count: 2 }]);
  });

  it("splits a backfill run into batches the board can answer", () => {
    const cursor = createStreamCursor({ backfillBatch: 4 });

    cursor.accept([{ seq: 0, record: recordFor(0) }], { nowMs: 0 });
    cursor.accept([{ seq: 20, record: recordFor(20) }], { nowMs: 0 });

    const ranges = cursor.backfill(windowOf({ firstSeq: 0, nextSeq: 21 }), 3);

    assert.deepEqual(ranges, [
      { from: 1, count: 4 },
      { from: 5, count: 4 },
      { from: 9, count: 4 },
    ]);
  });

  it("writes off records the board has overwritten and moves on", () => {
    const cursor = createStreamCursor();

    cursor.accept([{ seq: 10, record: recordFor(10) }], { nowMs: 0 });
    cursor.accept([{ seq: 40, record: recordFor(40) }], { nowMs: 0 });

    // The link was down long enough that 11-29 were overwritten. They are gone,
    // and a consumer told nothing would treat that road as measured.
    const out = cursor.observe(windowOf({ firstSeq: 30, nextSeq: 41 }), { nowMs: 100 });
    const losses = lossesOf(out);

    assert.equal(losses.length, 1);
    assert.deepEqual(
      { from: losses[0].from, to: losses[0].to, reason: losses[0].reason },
      { from: 11, to: 29, reason: "evicted" }
    );
    assert.equal(cursor.deliveredThrough(), 29);
  });

  it("gives up on a hole nobody filled, so delivery cannot stall forever", () => {
    const cursor = createStreamCursor({ maxHoldMs: 5_000 });

    cursor.accept([{ seq: 1, record: recordFor(1) }], { nowMs: 0 });
    cursor.accept([{ seq: 3, record: recordFor(3) }], { nowMs: 100 });

    assert.deepEqual(seqsOf(cursor.sweep(2_000)), []);

    const expired = cursor.sweep(6_000);

    assert.deepEqual(lossesOf(expired).map((loss) => [loss.from, loss.to, loss.reason]), [
      [2, 2, "expired"],
    ]);
    // The record waiting behind the hole is released by the same sweep.
    assert.deepEqual(seqsOf(expired), [3]);
  });

  it("stays bounded when a hole never fills and live data keeps coming", () => {
    const cursor = createStreamCursor({ maxPendingRecords: 10, maxHoldMs: 1_000_000 });

    cursor.accept([{ seq: 0, record: recordFor(0) }], { nowMs: 0 });

    for (let seq = 2; seq <= 40; seq += 1) {
      cursor.accept([{ seq, record: recordFor(seq) }], { nowMs: seq });
    }

    assert.ok(
      cursor.stats().pending <= 10,
      `pending grew to ${cursor.stats().pending}`
    );
    assert.ok(cursor.stats().lostRecords >= 1);
  });

  it("starts at the live edge rather than repairing a board's whole history", () => {
    const cursor = createStreamCursor();

    // The board has been powered up for an hour before the app attached.
    cursor.observe(windowOf({ firstSeq: 100_000, nextSeq: 180_000 }), { nowMs: 0 });

    assert.equal(cursor.deliveredThrough(), 179_999);
    assert.deepEqual(cursor.backfill(windowOf({ firstSeq: 100_000, nextSeq: 180_000 })), []);
  });

  it("catches up after notifications stall, not just after a hole", () => {
    // The link stayed up but frames stopped arriving — interference, or iOS
    // holding the app. The board kept producing. Nothing is "missing between
    // two records I have", so a cursor that only repairs interior holes would
    // sit at 101 forever while the board ran away from it.
    const cursor = createStreamCursor({ backfillBatch: 64, liveLagRecords: 25 });

    cursor.accept([{ seq: 100, record: recordFor(100) }], { nowMs: 0 });
    cursor.accept([{ seq: 101, record: recordFor(101) }], { nowMs: 20 });
    cursor.observe(windowOf({ firstSeq: 0, nextSeq: 4101 }), { nowMs: 60_000 });

    const ranges = cursor.backfill(windowOf({ firstSeq: 0, nextSeq: 4101 }), 2);

    assert.deepEqual(ranges, [
      { from: 102, count: 64 },
      { from: 166, count: 64 },
    ]);
  });

  it("leaves the newest records to the live path", () => {
    // Asking for what a notification is about to deliver anyway wastes the
    // radio and duplicates work.
    const cursor = createStreamCursor({ liveLagRecords: 25 });

    cursor.accept([{ seq: 1_000, record: recordFor(1_000) }], { nowMs: 0 });

    assert.deepEqual(cursor.backfill(windowOf({ firstSeq: 0, nextSeq: 1_010 }), 4), []);
  });

  it("resumes where a dropped link left off", () => {
    // A reconnect builds a new cursor. Attaching at the live edge would throw
    // away exactly the stretch the board held on to for us.
    const cursor = createStreamCursor({ startAt: 500, liveLagRecords: 0 });

    cursor.observe(windowOf({ firstSeq: 100, nextSeq: 800 }), { nowMs: 0 });

    assert.equal(cursor.deliveredThrough(), 499);
    assert.deepEqual(cursor.backfill(windowOf({ firstSeq: 100, nextSeq: 800 }), 1), [
      { from: 500, count: 64 },
    ]);
  });

  it("starts over when the board has restarted", () => {
    // A board that browned out numbers its records from zero again. Resuming
    // at 500 would ask for records that will not exist for another ten
    // seconds, and write off ones that were never sent.
    const cursor = createStreamCursor({ startAt: 5_000 });

    cursor.observe(windowOf({ firstSeq: 0, nextSeq: 12 }), { nowMs: 0 });

    assert.equal(cursor.deliveredThrough(), 11);
    assert.deepEqual(cursor.backfill(windowOf({ firstSeq: 0, nextSeq: 12 })), []);
  });

  it("counts which path records took", () => {
    const cursor = createStreamCursor();

    cursor.accept([{ seq: 0, record: recordFor(0) }], { nowMs: 0 });
    cursor.accept([{ seq: 2, record: recordFor(2) }], { nowMs: 0 });
    cursor.accept([{ seq: 1, record: recordFor(1) }], { nowMs: 0, repaired: true });

    const stats = cursor.stats();

    assert.equal(stats.liveRecords, 2);
    assert.equal(stats.repairedRecords, 1);
    assert.equal(stats.deliveredThrough, 2);
  });
});

/* ------------------------------------------------------------------ *
 * Board clock
 * ------------------------------------------------------------------ */

describe("board clock", () => {
  it("places a repaired record where it was measured, not where it arrived", () => {
    const clock = createBoardClock();

    // Live samples while the link is healthy establish the offset.
    clock.observe(10_000, 1_700_000_010_000);
    clock.observe(10_020, 1_700_000_010_020);
    clock.observe(10_040, 1_700_000_010_040);

    // A record measured at board uptime 10_100 but repaired 30 s later must
    // still resolve to the moment the board measured it.
    assert.equal(clock.toPhoneTime(10_100), 1_700_000_010_100);
  });

  it("takes the least delayed observation rather than the most recent", () => {
    const clock = createBoardClock();

    clock.observe(1_000, 1_700_000_001_500);
    // A sample that waited 400 ms in the radio would drag a naive estimate.
    clock.observe(2_000, 1_700_000_002_900);

    // Held at the least delayed observation, not pulled towards the late one.
    // The tolerance is the deliberate drift allowance, which over this 1.4 s
    // gap is a small fraction of a millisecond.
    const offset = clock.offsetMs() ?? Number.NaN;
    assert.ok(
      Math.abs(offset - 1_700_000_000_500) < 1,
      `offset drifted to ${offset}`
    );
  });

  it("has no opinion before it has seen anything", () => {
    assert.equal(createBoardClock().toPhoneTime(5_000), null);
  });
});
