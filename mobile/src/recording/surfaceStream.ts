import {
  imuStreamKind,
  STREAM_ID,
  type ImuStreamRecord,
} from "@skate-route-mapper/shared/xiaoStream";
import { logBle, logInfo, logWarn } from "../diagnostics/log";
import type { StreamReader } from "../native/stream/streamReader";
import { getXiaoConnection, useXiaoConnection } from "../native/xiaoConnection";
import { rideRecorder } from "./recorder";

/**
 * The board's surface readings, taken off it completely rather than hopefully.
 *
 * A ride used to record whatever notifications happened to arrive, which meant
 * a dropout was a stretch of road with no roughness on it and nothing in the
 * app ever knew. The stream reader takes the same notifications as its fast
 * path and repairs what the radio lost from the board's own window, so a ride
 * keeps its data through interference and through a link that goes down
 * entirely.
 *
 * This module owns only the reader's lifecycle. Ordering, repair and loss
 * accounting belong to the reader, and what a record means belongs to its
 * kind; neither is repeated here.
 */

/**
 * How long a hole may block delivery before the road is written off.
 *
 * Long enough to cover losing the link behind a building and getting it back:
 * repair drains several times faster than the board produces, so four minutes
 * of hold covers a dropout far longer than that. Past it the record is
 * declared lost, which is worth knowing — a ride that quietly waited forever
 * would be a ride that never finished writing itself down.
 */
const maxHoldMs = 240_000;

/**
 * Records held behind an unfilled hole.
 *
 * Live data keeps arriving while repair catches up, and this is the ceiling on
 * that backlog. At 50 Hz it is four minutes of riding, and repair is normally
 * finished inside a minute of the link returning.
 */
const maxPendingRecords = 12_000;

let reader: StreamReader | null = null;
let wanted = false;
let unsubscribe: (() => void) | null = null;
let lostRecords = 0;

/**
 * Whether the board is actually serving the stream.
 *
 * False against firmware older than the stream layer, which answers the read
 * ops with "unsupported". A ride still has to be recorded on such a board, so
 * until this turns true the live notification path keeps writing samples the
 * way it always did. The handoff is clean: the reader attaches at the board's
 * live edge, which is exactly where the notification path left off.
 */
let delivering = false;
let infoFailures = 0;

/** Consecutive failures before concluding the board cannot do this at all. */
const maxInfoFailures = 3;

/**
 * Where to carry on from after a reconnect.
 *
 * A dropped link tears the reader down with the connection, and a fresh one
 * would attach at the board's live edge — throwing away precisely the stretch
 * the board held on to while the phone was out of touch. That stretch is the
 * whole reason the window exists.
 *
 * Cleared when a ride starts or resumes, because a pause is not road.
 */
let resumeFrom: number | null = null;

function open() {
  if (reader !== null) {
    return;
  }

  const connection = getXiaoConnection();

  if (!connection) {
    return;
  }

  lostRecords = 0;
  infoFailures = 0;

  reader = connection.readStream<ImuStreamRecord>({
    streamId: STREAM_ID.RIDE_IMU,
    kind: imuStreamKind,
    ...(resumeFrom === null ? {} : { resumeFrom }),
    // The board's own clock, so a repaired reading is placed where it was
    // measured rather than where the rider was when it finally arrived.
    uptimeOf: (record) => record.uptimeMs,
    cursor: { maxHoldMs, maxPendingRecords },

    onInfo: () => {
      infoFailures = 0;

      if (!delivering) {
        delivering = true;
        logBle({ kind: "note", text: "surface stream delivering" });
      }
    },

    onRecords: (records) => {
      for (const record of records) {
        rideRecorder.recordExternalSample(record.value, record.atMs ?? undefined);
      }
    },

    onLoss: (loss) => {
      lostRecords += loss.to - loss.from + 1;

      // Road the ride will never have. Worth a line: it is the one kind of
      // gap the repair path cannot close, and the reason says which limit was
      // reached rather than leaving it to be guessed.
      logWarn("ride", "surfaceLoss", {
        from: loss.from,
        to: loss.to,
        records: loss.to - loss.from + 1,
        reason: loss.reason,
      });
    },

    onError: (error, phase) => {
      if (phase !== "info") {
        logWarn("ride", "surfaceStreamError", {
          phase,
          message: error instanceof Error ? error.message : String(error),
        });
        return;
      }

      delivering = false;
      infoFailures += 1;

      // Said once rather than every five seconds for the length of a ride. An
      // old board cannot start supporting this mid-ride, and the live path is
      // already carrying the recording.
      if (infoFailures === maxInfoFailures) {
        logWarn("ride", "surfaceStreamUnavailable", {
          message: error instanceof Error ? error.message : String(error),
          fallback: "notifications",
        });

        reader?.stop();
      }
    },
  });

  reader.start();

  logBle({ kind: "note", text: "surface stream open" });
}

function close() {
  if (reader === null) {
    return;
  }

  const stats = reader.stats();

  reader.stop();
  reader = null;
  delivering = false;

  // So a reconnect picks up the stretch the board kept for us.
  resumeFrom = stats.deliveredThrough >= 0 ? stats.deliveredThrough + 1 : null;

  // What the ride actually got, and by which path. `dropped` is the board
  // saying its window overflowed before the phone came back, which is the one
  // number that says the window is too small rather than the link too weak.
  logInfo("ride", "surfaceStreamClosed", {
    live: stats.live,
    repaired: stats.repaired,
    lost: lostRecords,
    dropped: stats.dropped,
    restarts: stats.restarts,
  });
}

function settle() {
  if (wanted && getXiaoConnection()) {
    open();
    return;
  }

  close();
}

/**
 * Turn surface capture on for the duration of a ride.
 *
 * Idempotent, and safe to call before a board is connected: the reader opens
 * as soon as there is a link and reopens by itself after a reconnect, because
 * a rider whose board dropped out mid-ride has not stopped riding.
 */
export function setSurfaceCaptureEnabled(enabled: boolean) {
  if (enabled) {
    // A ride starting or resuming reads from the board's live edge. The road
    // covered during a pause was not being measured, so there is nothing to
    // carry on from.
    resumeFrom = null;
  }

  wanted = enabled;

  if (enabled && unsubscribe === null) {
    unsubscribe = useXiaoConnection.subscribe(settle);
  }

  if (!enabled && unsubscribe !== null) {
    unsubscribe();
    unsubscribe = null;
  }

  settle();
}

/**
 * Whether the stream is carrying the ride's readings.
 *
 * False means the live notification path must keep recording, because either
 * no reader is open or the board does not serve streams. Exactly one of the
 * two paths writes a sample into a ride, never both.
 */
export function isSurfaceStreamRecording() {
  return reader !== null && delivering;
}

/** What the current ride has taken off the board, for diagnostics. */
export function surfaceStreamStats() {
  return reader?.stats() ?? null;
}
