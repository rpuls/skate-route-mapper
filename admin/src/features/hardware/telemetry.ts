const GRAVITY = 9.80665;

export type HardwareSample = {
  sequence?: number;
  uptimeMs: number;
  ax: number;
  ay: number;
  az: number;
  gx: number;
  gy: number;
  gz: number;
  temperature?: number;
  receivedAt: number;
};

export function parseSerialSample(line: string): Omit<HardwareSample, "receivedAt"> | null {
  const fields = line.trim().split(",");
  if (fields.length !== 8 || fields.some((field) => !field.trim())) return null;
  const values = fields.map(Number);
  if (!values.every(Number.isFinite) || values[0]! < 0) return null;
  const [uptimeMs, ax, ay, az, gx, gy, gz, temperature] = values as [number, number, number, number, number, number, number, number];
  return { uptimeMs, ax: ax / GRAVITY, ay: ay / GRAVITY, az: az / GRAVITY, gx, gy, gz, temperature };
}

export function motionVariation(samples: HardwareSample[]) {
  if (samples.length < 2) return null;
  const axes = ["ax", "ay", "az"] as const;
  const means = axes.map((axis) => samples.reduce((sum, sample) => sum + sample[axis], 0) / samples.length);
  return Math.sqrt(samples.reduce((sum, sample) => sum + axes.reduce(
    (variance, axis, index) => variance + (sample[axis] - means[index]!) ** 2,
    0,
  ), 0) / samples.length);
}
