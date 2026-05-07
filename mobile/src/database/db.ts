import * as SQLite from "expo-sqlite";
import type { MeasurementSample, Ride, SensorSource, VehicleType } from "../types/measurement";

const db = SQLite.openDatabaseSync("skate-route-mapper.db");

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
      FOREIGN KEY (rideId) REFERENCES rides(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_samples_rideId ON samples(rideId);
  `);
}

export function createRide(params: {
  id: string;
  startedAt: number;
  vehicleType: VehicleType;
  sensorSource: SensorSource;
}) {
  db.runSync(
    `INSERT INTO rides (id, startedAt, endedAt, vehicleType, sensorSource, sampleCount)
     VALUES (?, ?, NULL, ?, ?, 0);`,
    params.id,
    params.startedAt,
    params.vehicleType,
    params.sensorSource
  );
}

export function finishRide(rideId: string, endedAt: number) {
  db.runSync(
    `UPDATE rides
     SET endedAt = ?,
         sampleCount = (SELECT COUNT(*) FROM samples WHERE rideId = ?)
     WHERE id = ?;`,
    endedAt,
    rideId,
    rideId
  );
}

export function insertSample(rideId: string, sample: MeasurementSample) {
  db.runSync(
    `INSERT INTO samples (
      rideId, timestamp, ax, ay, az, gx, gy, gz, vibrationMagnitude, latitude, longitude, speed
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
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
    sample.speed
  );
}

export function insertSamples(rideId: string, samples: MeasurementSample[]) {
  if (samples.length === 0) {
    return;
  }

  const statement = db.prepareSync(
    `INSERT INTO samples (
      rideId, timestamp, ax, ay, az, gx, gy, gz, vibrationMagnitude, latitude, longitude, speed
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`
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
        ]);
      });
    });
  } finally {
    statement.finalizeSync();
  }
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
    `SELECT timestamp, ax, ay, az, gx, gy, gz, vibrationMagnitude, latitude, longitude, speed
     FROM samples
     WHERE rideId = ?
     ORDER BY timestamp ASC;`,
    rideId
  );
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
         s.speed
       FROM rides r
       JOIN samples s ON s.rideId = r.id
       ORDER BY s.timestamp DESC
       LIMIT ?;`,
      limit
    );
  }
