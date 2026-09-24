import * as SQLite from "expo-sqlite";
import type {
  RideMetricsPayload,
  SyncOperation,
  SyncOperationResult,
} from "@skate-route-mapper/shared/mobileContracts";
import {
  createRideProgress,
  parseRideProgress,
  type RideProgress,
} from "@skate-route-mapper/shared/rideTracking";
import type { MeasurementSample, Ride, SensorSource, VehicleType } from "../types/measurement";
import type { ActiveRecording } from "../recording/rideRecorder";
import type { ResearchCollection } from "../types/research";

const db = SQLite.openDatabaseSync("skate-route-mapper.db");

export type PendingChange = SyncOperation & {
  attempts: number;
  lastError: string | null;
  /** When this operation may next be sent. Zero means immediately. */
  nextAttemptAt: number;
};

// Where a recording in flight can be picked up again. Background location
// arrives outside React, and on a cold start after the OS killed the app there
// is no component to ask, so the active ride lives in the database. The shape
// belongs to the recorder, which is what reads it back.
export type { ActiveRecording };

const activeRecordingKey = "active";

// Background location can reach the app before anything renders, so the
// schema has to be ready outside React's lifecycle. Every entry point calls
// this; the flag keeps the repeated calls free.
let initialized = false;

const rideColumns = `id, startedAt, endedAt, vehicleType, sensorSource, sampleCount,
  distanceMeters, movingSeconds, maxSpeedMps, acceptedFixCount, rejectedFixCount`;

export function initDatabase() {
  if (initialized) {
    return;
  }

  db.execSync(`
    CREATE TABLE IF NOT EXISTS rides (
      id TEXT PRIMARY KEY NOT NULL,
      startedAt INTEGER NOT NULL,
      endedAt INTEGER,
      vehicleType TEXT NOT NULL,
      sensorSource TEXT NOT NULL,
      sampleCount INTEGER NOT NULL DEFAULT 0
    );

    -- Motion columns are nullable on purpose. A GPS fix is a sample with no
    -- motion in it, and a zero there would be a measurement claim rather than
    -- an absence: it would read as "the road was perfectly smooth here".
    CREATE TABLE IF NOT EXISTS samples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rideId TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      ax REAL,
      ay REAL,
      az REAL,
      gx REAL,
      gy REAL,
      gz REAL,
      vibrationMagnitude REAL,
      latitude REAL,
      longitude REAL,
      speed REAL,
      locationTimestamp INTEGER,
      locationAccuracy REAL,
      locationAgeMs INTEGER,
      FOREIGN KEY (rideId) REFERENCES rides(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_samples_rideId ON samples(rideId);

    CREATE TABLE IF NOT EXISTS pending_changes (
      id TEXT PRIMARY KEY NOT NULL,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      syncedAt INTEGER,
      attempts INTEGER NOT NULL DEFAULT 0,
      lastError TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_pending_changes_unsynced
      ON pending_changes (syncedAt, createdAt);

    CREATE TABLE IF NOT EXISTS research_collections (
      id TEXT PRIMARY KEY NOT NULL,
      createdAt INTEGER NOT NULL,
      metadata TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_research_collections_createdAt
      ON research_collections (createdAt DESC);

    CREATE TABLE IF NOT EXISTS recording_state (
      id TEXT PRIMARY KEY NOT NULL,
      rideId TEXT NOT NULL,
      sensorSource TEXT NOT NULL,
      startedAt INTEGER NOT NULL
    );
  `);

  relaxSampleMotionColumns();

  ensureColumn("samples", "locationTimestamp", "INTEGER");
  ensureColumn("samples", "locationAccuracy", "REAL");
  ensureColumn("samples", "locationAgeMs", "INTEGER");

  ensureColumn("rides", "distanceMeters", "REAL NOT NULL DEFAULT 0");
  ensureColumn("rides", "movingSeconds", "REAL NOT NULL DEFAULT 0");
  ensureColumn("rides", "maxSpeedMps", "REAL NOT NULL DEFAULT 0");
  ensureColumn("rides", "acceptedFixCount", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("rides", "rejectedFixCount", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("rides", "progressJson", "TEXT");

  // Retries are scheduled rather than immediate, so a failing operation does
  // not keep the queue spinning at the same rate forever.
  ensureColumn("pending_changes", "nextAttemptAt", "INTEGER NOT NULL DEFAULT 0");

  // Which ride an operation belongs to, as a column rather than a field inside
  // the JSON payload: answering "is this ride uploaded yet" must not mean
  // parsing every queued batch of samples.
  ensureColumn("pending_changes", "rideId", "TEXT");
  db.execSync(
    `CREATE INDEX IF NOT EXISTS idx_pending_changes_ride
       ON pending_changes (syncedAt, rideId);`
  );

  initialized = true;
}

export function saveResearchCollection(collection: ResearchCollection) {
  db.runSync(
    `INSERT OR REPLACE INTO research_collections (id, createdAt, metadata) VALUES (?, ?, ?);`,
    collection.id,
    collection.createdAt,
    JSON.stringify(collection)
  );
}

export function getResearchCollections(): ResearchCollection[] {
  return db.getAllSync<{ metadata: string }>(
    `SELECT metadata FROM research_collections ORDER BY createdAt DESC;`
  ).map((row) => JSON.parse(row.metadata) as ResearchCollection);
}

export function createRide(params: {
  id: string;
  startedAt: number;
  vehicleType: VehicleType;
  sensorSource: SensorSource;
}) {
  db.withTransactionSync(() => {
    db.runSync(
      `INSERT INTO rides (
        id, startedAt, endedAt, vehicleType, sensorSource, sampleCount,
        distanceMeters, movingSeconds, maxSpeedMps, acceptedFixCount, rejectedFixCount,
        progressJson
      ) VALUES (?, ?, NULL, ?, ?, 0, 0, 0, 0, 0, 0, NULL);`,
      params.id,
      params.startedAt,
      params.vehicleType,
      params.sensorSource
    );

    enqueuePendingChange({
      type: "ride.start",
      createdAt: Date.now(),
      payload: {
        rideId: params.id,
        startedAt: params.startedAt,
        vehicleType: params.vehicleType,
        sensorSource: params.sensorSource,
      },
    });
  });
}

export function finishRide(
  rideId: string,
  endedAt: number,
  metrics?: RideMetricsPayload | undefined
) {
  db.withTransactionSync(() => {
    db.runSync(
      `UPDATE rides
       SET endedAt = ?,
           sampleCount = (SELECT COUNT(*) FROM samples WHERE rideId = ?)
       WHERE id = ?;`,
      endedAt,
      rideId,
      rideId
    );

    enqueuePendingChange({
      type: "ride.finish",
      createdAt: Date.now(),
      payload: metrics ? { rideId, endedAt, metrics } : { rideId, endedAt },
    });
  });
}

/**
 * Persist a batch of samples and the one sync operation that carries them.
 *
 * Rows and the operation are written together: a sample that reached the
 * database without an operation to ship it would never leave the phone.
 */
export function insertSamples(rideId: string, samples: MeasurementSample[]) {
  if (samples.length === 0) {
    return;
  }

  const statement = db.prepareSync(
    `INSERT INTO samples (
      rideId, timestamp, ax, ay, az, gx, gy, gz, vibrationMagnitude, latitude, longitude, speed,
      locationTimestamp, locationAccuracy, locationAgeMs
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`
  );

  try {
    db.withTransactionSync(() => {
      samples.forEach((sample) => {
        statement.executeSync([
          rideId,
          sample.timestamp,
          sample.ax,
          sample.ay,
          sample.az,
          sample.gx,
          sample.gy,
          sample.gz,
          sample.vibrationMagnitude,
          sample.latitude,
          sample.longitude,
          sample.speed,
          sample.locationTimestamp ?? null,
          sample.locationAccuracy ?? null,
          sample.locationAgeMs ?? null,
        ]);
      });

      enqueueSamplesPendingChange(rideId, samples);
    });
  } finally {
    statement.finalizeSync();
  }
}

export function setActiveRecording(recording: ActiveRecording) {
  db.runSync(
    `INSERT OR REPLACE INTO recording_state (id, rideId, sensorSource, startedAt)
     VALUES (?, ?, ?, ?);`,
    activeRecordingKey,
    recording.rideId,
    recording.sensorSource,
    recording.startedAt
  );
}

export function getActiveRecording(): ActiveRecording | null {
  const row = db.getFirstSync<{
    rideId: string;
    sensorSource: SensorSource;
    startedAt: number;
  }>(
    `SELECT rideId, sensorSource, startedAt FROM recording_state WHERE id = ?;`,
    activeRecordingKey
  );

  return row ?? null;
}

export function clearActiveRecording() {
  db.runSync(`DELETE FROM recording_state WHERE id = ?;`, activeRecordingKey);
}

export function getRideProgress(rideId: string): RideProgress {
  const row = db.getFirstSync<{ progressJson: string | null }>(
    `SELECT progressJson FROM rides WHERE id = ?;`,
    rideId
  );

  if (!row?.progressJson) {
    return createRideProgress();
  }

  try {
    return parseRideProgress(JSON.parse(row.progressJson));
  } catch {
    return createRideProgress();
  }
}

/**
 * Store the accumulator and the figures derived from it.
 *
 * The derived columns are written alongside so the rides list can show a
 * distance without parsing progress for every row.
 */
export function saveRideProgress(rideId: string, progress: RideProgress) {
  db.runSync(
    `UPDATE rides
     SET progressJson = ?,
         distanceMeters = ?,
         movingSeconds = ?,
         maxSpeedMps = ?,
         acceptedFixCount = ?,
         rejectedFixCount = ?
     WHERE id = ?;`,
    JSON.stringify(progress),
    progress.distanceMeters,
    progress.movingSeconds,
    progress.maxSpeedMps,
    progress.acceptedFixCount,
    progress.rejectedFixCount,
    rideId
  );
}

export function getRides(): Ride[] {
  return db.getAllSync<Ride>(
    `SELECT ${rideColumns} FROM rides ORDER BY startedAt DESC;`
  );
}

/**
 * The most recently finished ride.
 *
 * The ride screen shows what you last covered, and that has to survive the app
 * being closed — it is a fact about the phone, not about this session. An open
 * ride is excluded: it has not covered anything yet.
 */
export function getLastFinishedRide(): Ride | null {
  return (
    db.getFirstSync<Ride>(
      `SELECT ${rideColumns} FROM rides
       WHERE endedAt IS NOT NULL
       ORDER BY endedAt DESC
       LIMIT 1;`
    ) ?? null
  );
}

export function getRide(rideId: string): Ride | null {
  return db.getFirstSync<Ride>(
    `SELECT ${rideColumns} FROM rides WHERE id = ?;`,
    rideId
  );
}

/**
 * Just the route line for a ride.
 *
 * The live map redraws every few seconds while recording, and a ride with the
 * board connected holds tens of thousands of vibration samples — each stamped
 * with the last known position, so selecting every row with a latitude would
 * return the same point hundreds of times over. `ax IS NULL` is what marks a
 * row as a GPS fix rather than a board reading.
 */
export function getRideRouteCoordinates(
  rideId: string
): { latitude: number; longitude: number }[] {
  return db.getAllSync<{ latitude: number; longitude: number }>(
    `SELECT latitude, longitude
     FROM samples
     WHERE rideId = ? AND ax IS NULL AND latitude IS NOT NULL AND longitude IS NOT NULL
     ORDER BY timestamp ASC;`,
    rideId
  );
}

export function getSamplesForRide(rideId: string): MeasurementSample[] {
  return db.getAllSync<MeasurementSample>(
    `SELECT timestamp, ax, ay, az, gx, gy, gz, vibrationMagnitude, latitude, longitude, speed,
            locationTimestamp, locationAccuracy, locationAgeMs
     FROM samples
     WHERE rideId = ?
     ORDER BY timestamp ASC;`,
    rideId
  );
}

/**
 * Drop the NOT NULL constraint the motion columns were created with.
 *
 * Samples used to always carry phone accelerometer readings, so every column
 * was required. Route recording now writes a GPS fix as a sample whose motion
 * fields are null — vibration is the board's job — and on a database created
 * under the old schema every one of those inserts fails the constraint, which
 * takes the whole flush with it and loses the route.
 *
 * SQLite cannot relax a constraint in place, so the table is rebuilt. Existing
 * rows are carried over unchanged.
 */
function relaxSampleMotionColumns() {
  const columns = db.getAllSync<{ name: string; notnull: number }>(
    `PRAGMA table_info(samples);`
  );

  const stillRequired = columns.some(
    (column) => column.name === "ax" && column.notnull === 1
  );

  if (!stillRequired) {
    return;
  }

  const carried = columns.map((column) => column.name).filter((name) => name !== "id");

  db.execSync("PRAGMA foreign_keys = OFF;");

  try {
    db.withTransactionSync(() => {
      db.execSync(`
        CREATE TABLE samples_rebuilt (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          rideId TEXT NOT NULL,
          timestamp INTEGER NOT NULL,
          ax REAL,
          ay REAL,
          az REAL,
          gx REAL,
          gy REAL,
          gz REAL,
          vibrationMagnitude REAL,
          latitude REAL,
          longitude REAL,
          speed REAL,
          locationTimestamp INTEGER,
          locationAccuracy REAL,
          locationAgeMs INTEGER,
          FOREIGN KEY (rideId) REFERENCES rides(id) ON DELETE CASCADE
        );
      `);

      db.execSync(
        `INSERT INTO samples_rebuilt (${carried.join(", ")})
         SELECT ${carried.join(", ")} FROM samples;`
      );

      db.execSync("DROP TABLE samples;");
      db.execSync("ALTER TABLE samples_rebuilt RENAME TO samples;");
      db.execSync(
        "CREATE INDEX IF NOT EXISTS idx_samples_rideId ON samples(rideId);"
      );
    });
  } finally {
    db.execSync("PRAGMA foreign_keys = ON;");
  }
}

function ensureColumn(table: string, name: string, definition: string) {
  const columns = db.getAllSync<{ name: string }>(`PRAGMA table_info(${table});`);
  const exists = columns.some((column) => column.name === name);

  if (!exists) {
    db.execSync(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition};`);
  }
}

function enqueueSamplesPendingChange(rideId: string, samples: MeasurementSample[]) {
  enqueuePendingChange({
    type: "ride.samples",
    createdAt: Date.now(),
    payload: {
      rideId,
      samples,
    },
  });
}

function enqueuePendingChange(
  operation: Omit<SyncOperation, "operationId">
) {
  db.runSync(
    `INSERT INTO pending_changes (id, type, payload, createdAt, nextAttemptAt, rideId)
     VALUES (?, ?, ?, ?, 0, ?);`,
    createLocalOperationId(),
    operation.type,
    JSON.stringify(operation.payload),
    operation.createdAt,
    operation.payload.rideId
  );
}

/**
 * The whole unsent queue, oldest first, including operations waiting out a
 * backoff.
 *
 * Which of them may actually be sent is decided in `syncBatching`, not here:
 * the rule depends on what else is queued for the same ride, which is a policy
 * question rather than a storage one.
 */
export function getQueuedChanges(limit = 200): PendingChange[] {
  const rows = db.getAllSync<{
    id: string;
    type: SyncOperation["type"];
    payload: string;
    createdAt: number;
    attempts: number;
    lastError: string | null;
    nextAttemptAt: number;
  }>(
    `SELECT id, type, payload, createdAt, attempts, lastError, nextAttemptAt
     FROM pending_changes
     WHERE syncedAt IS NULL
     ORDER BY createdAt ASC
     LIMIT ?;`,
    limit
  );

  return rows.map((row) => ({
    operationId: row.id,
    type: row.type,
    createdAt: row.createdAt,
    payload: JSON.parse(row.payload),
    attempts: row.attempts,
    lastError: row.lastError,
    nextAttemptAt: row.nextAttemptAt,
  })) as PendingChange[];
}

export function markPendingChangesSynced(results: SyncOperationResult[]) {
  const syncedAt = Date.now();

  db.withTransactionSync(() => {
    results.forEach((result) => {
      db.runSync(
        `UPDATE pending_changes
         SET syncedAt = ?, lastError = NULL
         WHERE id = ?;`,
        syncedAt,
        result.operationId
      );
    });
  });
}

export function markPendingChangesFailed(
  operationIds: string[],
  error: string,
  retryAt: (attempts: number) => number
) {
  db.withTransactionSync(() => {
    operationIds.forEach((operationId) => {
      const row = db.getFirstSync<{ attempts: number }>(
        `SELECT attempts FROM pending_changes WHERE id = ? AND syncedAt IS NULL;`,
        operationId
      );

      if (!row) {
        return;
      }

      const attempts = row.attempts + 1;

      db.runSync(
        `UPDATE pending_changes
         SET attempts = ?, lastError = ?, nextAttemptAt = ?
         WHERE id = ? AND syncedAt IS NULL;`,
        attempts,
        error,
        retryAt(attempts),
        operationId
      );
    });
  });
}

export function getPendingChangeCount() {
  const row = db.getFirstSync<{ count: number }>(
    `SELECT COUNT(*) AS count
     FROM pending_changes
     WHERE syncedAt IS NULL;`
  );

  return row?.count ?? 0;
}

/**
 * How the outbox looks to a rider: how much is waiting, how much is stuck, and
 * when the queue will next try.
 */
export function getPendingChangeSummary(now = Date.now()) {
  const row = db.getFirstSync<{
    pending: number;
    due: number;
    failing: number;
    nextAttemptAt: number | null;
    lastError: string | null;
  }>(
    `SELECT COUNT(*) AS pending,
            SUM(CASE WHEN nextAttemptAt <= ? THEN 1 ELSE 0 END) AS due,
            SUM(CASE WHEN attempts > 0 THEN 1 ELSE 0 END) AS failing,
            MIN(CASE WHEN nextAttemptAt > ? THEN nextAttemptAt ELSE NULL END) AS nextAttemptAt,
            (SELECT lastError
             FROM pending_changes
             WHERE syncedAt IS NULL AND lastError IS NOT NULL
             ORDER BY createdAt DESC
             LIMIT 1) AS lastError
     FROM pending_changes
     WHERE syncedAt IS NULL;`,
    now,
    now
  );

  return {
    pending: row?.pending ?? 0,
    due: row?.due ?? 0,
    failing: row?.failing ?? 0,
    nextAttemptAt: row?.nextAttemptAt ?? null,
    lastError: row?.lastError ?? null,
  };
}

/** The rides that still have something waiting to upload. */
export function getPendingRideIds(): string[] {
  return db
    .getAllSync<{ rideId: string }>(
      `SELECT DISTINCT rideId
       FROM pending_changes
       WHERE syncedAt IS NULL AND rideId IS NOT NULL;`
    )
    .map((row) => row.rideId);
}

function createLocalOperationId() {
  const randomValue = Math.random().toString(36).slice(2);

  return `op_${Date.now()}_${randomValue}`;
}
