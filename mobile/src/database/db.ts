import * as SQLite from "expo-sqlite";
import type {
  SyncOperation,
  SyncOperationResult,
} from "@skate-route-mapper/shared/mobileContracts";
import type { MeasurementSample, Ride, SensorSource, VehicleType } from "../types/measurement";

const db = SQLite.openDatabaseSync("skate-route-mapper.db");

export type PendingChange = SyncOperation & {
  attempts: number;
  lastError: string | null;
};

export function initDatabase() {
  db.execSync(`
    CREATE TABLE IF NOT EXISTS rides (
      id TEXT PRIMARY KEY NOT NULL,
      startedAt INTEGER NOT NULL,
      endedAt INTEGER,
      vehicleType TEXT NOT NULL,
      sensorSource TEXT NOT NULL,
      sampleCount INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS samples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rideId TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      ax REAL NOT NULL,
      ay REAL NOT NULL,
      az REAL NOT NULL,
      gx REAL NOT NULL,
      gy REAL NOT NULL,
      gz REAL NOT NULL,
      vibrationMagnitude REAL NOT NULL,
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
  `);

  ensureSampleColumn("locationTimestamp", "INTEGER");
  ensureSampleColumn("locationAccuracy", "REAL");
  ensureSampleColumn("locationAgeMs", "INTEGER");
}

export function createRide(params: {
  id: string;
  startedAt: number;
  vehicleType: VehicleType;
  sensorSource: SensorSource;
}) {
  db.withTransactionSync(() => {
    db.runSync(
      `INSERT INTO rides (id, startedAt, endedAt, vehicleType, sensorSource, sampleCount)
       VALUES (?, ?, NULL, ?, ?, 0);`,
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

export function finishRide(rideId: string, endedAt: number) {
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
      payload: {
        rideId,
        endedAt,
      },
    });
  });
}

export function insertSample(rideId: string, sample: MeasurementSample) {
  db.withTransactionSync(() => {
    insertSampleRow(rideId, sample);
    enqueueSamplesPendingChange(rideId, [sample]);
  });
}

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

function insertSampleRow(rideId: string, sample: MeasurementSample) {
  db.runSync(
    `INSERT INTO samples (
      rideId, timestamp, ax, ay, az, gx, gy, gz, vibrationMagnitude, latitude, longitude, speed,
      locationTimestamp, locationAccuracy, locationAgeMs
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
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
    sample.locationAgeMs ?? null
  );
}

export function getRides(): Ride[] {
  return db.getAllSync<Ride>(
    `SELECT * FROM rides ORDER BY startedAt DESC;`
  );
}

export function getRide(rideId: string): Ride | null {
  return db.getFirstSync<Ride>(
    `SELECT * FROM rides WHERE id = ?;`,
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

function ensureSampleColumn(name: string, type: string) {
  const columns = db.getAllSync<{ name: string }>("PRAGMA table_info(samples);");
  const exists = columns.some((column) => column.name === name);

  if (!exists) {
    db.execSync(`ALTER TABLE samples ADD COLUMN ${name} ${type};`);
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
    `INSERT INTO pending_changes (id, type, payload, createdAt)
     VALUES (?, ?, ?, ?);`,
    createLocalOperationId(),
    operation.type,
    JSON.stringify(operation.payload),
    operation.createdAt
  );
}

export function getPendingChanges(limit = 50): PendingChange[] {
  const rows = db.getAllSync<{
    id: string;
    type: SyncOperation["type"];
    payload: string;
    createdAt: number;
    attempts: number;
    lastError: string | null;
  }>(
    `SELECT id, type, payload, createdAt, attempts, lastError
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

export function markPendingChangesFailed(operationIds: string[], error: string) {
  db.withTransactionSync(() => {
    operationIds.forEach((operationId) => {
      db.runSync(
        `UPDATE pending_changes
         SET attempts = attempts + 1, lastError = ?
         WHERE id = ? AND syncedAt IS NULL;`,
        error,
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

function createLocalOperationId() {
  const randomValue = Math.random().toString(36).slice(2);

  return `op_${Date.now()}_${randomValue}`;
}

// For debugging
export function getLatestSamples(limit = 20) {
    return db.getAllSync(
      `SELECT *
       FROM samples
       ORDER BY timestamp DESC
       LIMIT ?;`,
      limit
    );
  }
  
  export function getLatestRideWithSamples(limit = 20) {
    return db.getAllSync(
      `SELECT
         r.id as rideId,
         r.startedAt,
         r.endedAt,
         r.vehicleType,
         s.timestamp,
         s.vibrationMagnitude,
         s.latitude,
         s.longitude,
         s.speed,
         s.locationTimestamp,
         s.locationAccuracy,
         s.locationAgeMs
       FROM rides r
       JOIN samples s ON s.rideId = r.id
       ORDER BY s.timestamp DESC
       LIMIT ?;`,
      limit
    );
  }
