import { maxSamplesPerSyncOperation } from "@skate-route-mapper/shared/mobileContracts";
import type { MeasurementSample } from "../types/measurement";

/**
 * Holds samples until there are enough of them to be worth writing.
 *
 * Every write to the database also queues one sync operation, so writing a
 * sample the moment it arrives queues one operation per sample. A 30-minute
 * XIAO ride at 20 Hz did that 36,000 times, which is not an upload anybody can
 * finish. Buffering turns the same ride into a few hundred operations.
 *
 * Nothing here touches the database directly: the flush callback does, which
 * keeps the batching rules testable on their own.
 */
export type SampleFlush = (samples: MeasurementSample[]) => void;

export type SampleBufferOptions = {
  /** Flush once this many samples are waiting. */
  maxSamples?: number;
  /** Flush this long after the oldest waiting sample arrived. */
  maxAgeMs?: number;
  now?: () => number;
};

export type SampleBuffer = {
  add: (samples: MeasurementSample[]) => void;
  /** Write everything waiting. Returns how many samples were written. */
  flush: () => number;
  size: () => number;
  oldestAt: () => number | null;
};

/**
 * 250 samples is twelve seconds of board data or several minutes of GPS, and
 * the twenty second ceiling keeps a slow ride from sitting unwritten. Both are
 * well inside the 1,000 sample limit one sync operation may carry.
 */
export const sampleBufferDefaults = {
  maxSamples: 250,
  maxAgeMs: 20_000,
} as const;

export function createSampleBuffer(
  flushSamples: SampleFlush,
  options: SampleBufferOptions = {}
): SampleBuffer {
  // A batch larger than the API accepts would be rejected on arrival, so the
  // buffer can never be configured past the contract's ceiling.
  const maxSamples = Math.max(
    1,
    Math.min(
      options.maxSamples ?? sampleBufferDefaults.maxSamples,
      maxSamplesPerSyncOperation
    )
  );
  const maxAgeMs = options.maxAgeMs ?? sampleBufferDefaults.maxAgeMs;
  const now = options.now ?? Date.now;

  let waiting: MeasurementSample[] = [];
  let oldestAt: number | null = null;

  function writeChunk(size: number) {
    const chunk = waiting.slice(0, size);

    waiting = waiting.slice(size);
    oldestAt = waiting.length > 0 ? now() : null;
    flushSamples(chunk);

    return chunk.length;
  }

  return {
    add(samples) {
      if (samples.length === 0) {
        return;
      }

      if (oldestAt === null) {
        oldestAt = now();
      }

      waiting = [...waiting, ...samples];

      while (waiting.length >= maxSamples) {
        writeChunk(maxSamples);
      }

      if (oldestAt !== null && now() - oldestAt >= maxAgeMs) {
        writeChunk(waiting.length);
      }
    },

    flush() {
      if (waiting.length === 0) {
        return 0;
      }

      return writeChunk(waiting.length);
    },

    size() {
      return waiting.length;
    },

    oldestAt() {
      return oldestAt;
    },
  };
}
