import BluetoothIcon from "@mui/icons-material/Bluetooth";
import CableIcon from "@mui/icons-material/Cable";
import DownloadIcon from "@mui/icons-material/Download";
import {
  Alert, Box, Button, FormControl, InputLabel, MenuItem, Paper, Select, Stack, TextField, Typography,
} from "@mui/material";
import { colors, space } from "@skate-route-mapper/shared/design";
import { useEffect, useMemo, useState } from "react";
import { LiveAccelerationChart, ResearchRecordingChart } from "../components/hardware/HardwareCharts";
import { errorMessage } from "../features/hardware/browserHardware";
import { motionVariation } from "../features/hardware/telemetry";
import { useHardwareConnection } from "../features/hardware/useHardwareConnection";
import { useResearchRecorder, type ResearchReport } from "../features/hardware/useResearchRecorder";
import { adminLayout, px, radiusLevel, radiusPx, surfaceSx } from "../theme/adminTheme";

function StatusTile({ detail, title, value }: { detail: string; title: string; value: string }) {
  return (
    <Paper elevation={0} sx={surfaceSx({ bgcolor: colors.surfaceMuted, level: radiusLevel.inner, padding: space.md })}>
      <Typography variant="h3">{title}</Typography>
      <Typography component="strong" sx={{ display: "block", fontSize: "1.15rem", mt: 1 }}>{value}</Typography>
      <Typography color="text.secondary" variant="body2">{detail}</Typography>
    </Paper>
  );
}

function mb(bytes: number) { return `${(bytes / 1e6).toFixed(3)} MB`; }

function ResearchResult({ report, transferMs }: { report: ResearchReport; transferMs: number }) {
  const cadence = report.sensorTimingMeasured
    ? `${report.sensorTimestampRateHz?.toFixed(1)} Hz sensor cadence; ${report.sensorBlockMinRateHz?.toFixed(1)}–${report.sensorBlockMaxRateHz?.toFixed(1)} Hz across ${report.timestampBlockMilliseconds?.toFixed(1)} ms blocks.`
    : `${report.boardCompletionRate.toFixed(1)} samples/s from total board command time; this capture has no sensor timestamps.`;
  const passed = report.complete && report.summariesMatchRaw && report.rateWithinTolerance && report.timingChecksPassed;
  return (
    <Stack spacing={1}>
      <Alert severity={passed ? "success" : "warning"}>
        {passed ? "Checks passed" : "Incomplete or failed checks"} · {report.samples.toLocaleString()} samples · {report.windows} summaries · {cadence}
      </Alert>
      <Typography>Raw: {mb(report.rawBytes)}. Summaries: {mb(report.summaryBytes)} ({report.reductionFactor.toFixed(1)}× smaller).</Typography>
      <Typography>Projected hour: {mb(report.rawBytesPerHour)} raw + {mb(report.summaryBytesPerHour)} summaries. This is a storage projection.</Typography>
      <Typography>Board summaries {report.summariesMatchRaw ? "match" : "do not match"} laptop recalculation. Clipped samples: {report.clippedSamples}. Retrieval: {(transferMs / 1000).toFixed(1)} s.</Typography>
    </Stack>
  );
}

export function HardwareBenchPage() {
  const connection = useHardwareConnection();
  const research = useResearchRecorder(connection.researchClient, connection.researchSession);
  const [now, setNow] = useState(() => performance.now());
  const [rateHz, setRateHz] = useState(1666);
  const [duration, setDuration] = useState(10);
  const [label, setLabel] = useState("");
  const [fileError, setFileError] = useState("");

  useEffect(() => {
    const timer = window.setInterval(() => setNow(performance.now()), 100);
    return () => window.clearInterval(timer);
  }, []);

  const visibleSamples = useMemo(
    () => connection.samples.filter((sample) => now - sample.receivedAt <= 10_000),
    [connection.samples, now],
  );
  const latestAge = connection.latest ? now - connection.latest.receivedAt : null;
  const live = connection.kind !== null && latestAge !== null && latestAge < 1500;
  const recent = visibleSamples.filter((sample) => now - sample.receivedAt < 2000);
  const variation = live ? motionVariation(recent) : null;
  const requestedSamples = rateHz * duration;
  const canStart = Boolean(connection.researchClient && research.status && research.status.state !== 1 && research.status.capacity >= requestedSamples);

  return (
    <Stack spacing={px(adminLayout.containerGap)}>
      <Paper elevation={0} sx={surfaceSx({ shadow: true })}>
        <Typography variant="overline">LSM6DSOX sensor → XIAO brain → this computer</Typography>
        <Typography variant="h2">See what your sensor feels</Typography>
        <Typography color="text.secondary" sx={{ mt: 1 }}>
          Connect directly from this browser. Close Arduino Serial Monitor and other serial or BLE readers first.
        </Typography>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ mt: 2 }}>
          <Button disabled={connection.busy || Boolean(connection.kind) || !connection.support.usb} onClick={connection.connectUsb} startIcon={<CableIcon />} variant="contained">Connect USB</Button>
          <Button disabled={connection.busy || Boolean(connection.kind) || !connection.support.ble} onClick={connection.connectBle} startIcon={<BluetoothIcon />} variant="contained">Connect BLE</Button>
          <Button disabled={connection.busy || !connection.kind} onClick={connection.disconnect} variant="outlined">Disconnect</Button>
        </Stack>
        <Alert severity={connection.kind ? "success" : "info"} sx={{ mt: 2 }}>{connection.message}</Alert>
        <Typography color="text.secondary" sx={{ mt: 1 }} variant="body2">
          Browser support: USB {connection.support.usb ? "available" : "unavailable"} · BLE {connection.support.ble ? "available" : "unavailable"}. Use desktop Chrome or Edge. Production HTTPS and localhost are supported secure contexts.
        </Typography>
      </Paper>

      <Box sx={{ display: "grid", gap: px(adminLayout.containerGap), gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))" } }}>
        <StatusTile title="Computer connection" value={connection.label} detail={connection.device} />
        <StatusTile title="Sensor stream" value={live ? "Receiving" : connection.latest ? "Stopped / stale" : "Waiting"} detail={`${visibleSamples.filter((sample) => now - sample.receivedAt < 1000).length} samples/s · ${latestAge === null ? "no readings yet" : `last sample ${(latestAge / 1000).toFixed(1)} s ago`}`} />
        <StatusTile title="Bluetooth" value={connection.bluetooth} detail={connection.bluetoothNote} />
        <StatusTile title="Battery" value="Not measured" detail="The XIAO can charge the cell, but current hardware does not expose voltage, percentage, charge state, or power source." />
      </Box>

      <Paper elevation={0} sx={surfaceSx({ shadow: true })}>
        <Typography variant="h2">Live acceleration preview</Typography>
        <Typography color="text.secondary">Last 10 seconds · X / Y / Z · units: g</Typography>
        <Box sx={{ mt: 2, "& canvas": { bgcolor: colors.surfaceMuted, borderRadius: radiusPx(radiusLevel.inner), display: "block", height: 260, width: "100%" } }}>
          <LiveAccelerationChart now={now} samples={visibleSamples} />
        </Box>
        <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))" }, mt: 2 }}>
          <StatusTile title="Acceleration X / Y / Z" value={connection.latest ? [connection.latest.ax, connection.latest.ay, connection.latest.az].map((value) => value.toFixed(3)).join(" / ") : "—"} detail="g" />
          <StatusTile title="Rotation X / Y / Z" value={connection.latest ? [connection.latest.gx, connection.latest.gy, connection.latest.gz].map((value) => (value * 180 / Math.PI).toFixed(1)).join(" / ") : "—"} detail="degrees/s" />
          <StatusTile title="Motion variation · 2 seconds" value={variation === null ? "—" : variation.toFixed(3)} detail="g RMS around the window’s mean vector" />
          <StatusTile title="Sensor temperature" value={connection.latest?.temperature === undefined ? "—" : `${connection.latest.temperature.toFixed(1)} °C`} detail="Sensor chip temperature, not battery temperature" />
        </Box>
      </Paper>

      <Paper elevation={0} sx={surfaceSx({ shadow: true })}>
        <Typography variant="h2">Research desk recording</Typography>
        <Typography color="text.secondary" sx={{ mt: 1 }}>
          The board records bounded raw acceleration at 833 or 1,666 samples/s, then this page retrieves and validates it over BLE.
        </Typography>
        <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", md: "repeat(3, minmax(0, 1fr))" }, my: 2 }}>
          <FormControl size="small"><InputLabel>Sample rate</InputLabel><Select label="Sample rate" value={rateHz} onChange={(event) => setRateHz(Number(event.target.value))}><MenuItem value={1666}>1,666 Hz timing test</MenuItem><MenuItem value={833}>833 Hz comparison</MenuItem></Select></FormControl>
          <FormControl size="small"><InputLabel>Duration</InputLabel><Select label="Duration" value={duration} onChange={(event) => setDuration(Number(event.target.value))}><MenuItem value={10}>10 seconds</MenuItem><MenuItem value={30}>30 seconds</MenuItem><MenuItem value={60}>60 seconds</MenuItem></Select></FormControl>
          <TextField label="Test note" slotProps={{ htmlInput: { maxLength: 200 } }} onChange={(event) => setLabel(event.target.value)} placeholder="5 s resting, then 5 s shaking" value={label} />
        </Box>
        <Stack direction={{ xs: "column", md: "row" }} spacing={1.5}>
          <Button disabled={research.working || !connection.researchClient} onClick={research.check} variant="outlined">Check recorder</Button>
          <Button disabled={research.working || !canStart} onClick={() => research.start(duration, rateHz)} variant="contained">Start / replace recording</Button>
          <Button disabled={research.working || !research.status || ![2, 3].includes(research.status.state) || !research.status.count} onClick={() => research.retrieve(label)} variant="contained">Retrieve datasets</Button>
          <Button disabled={!research.recording} onClick={research.save} startIcon={<DownloadIcon />} variant="outlined">Save recording</Button>
        </Stack>
        <Alert severity={research.status?.error ? "warning" : "info"} sx={{ mt: 2 }}>{research.message}</Alert>
        <Typography sx={{ mt: 1 }}>{research.memory}</Typography>
        {research.transfer && <Typography color="text.secondary">{research.transfer}</Typography>}
        <Button component="label" sx={{ mt: 2 }} variant="outlined">
          Open saved recording
          <input hidden accept=".skateresearch" type="file" onChange={async (event) => {
            const file = event.target.files?.[0]; if (!file) return;
            try { setFileError(""); await research.openFile(file); } catch (error) { setFileError(errorMessage(error)); }
            event.target.value = "";
          }} />
        </Button>
        {fileError && <Alert severity="error" sx={{ mt: 1 }}>{fileError}</Alert>}
        <Typography sx={{ mt: 3 }} variant="h3">Recorded data comparison</Typography>
        <Box sx={{ mt: 1, "& canvas": { bgcolor: colors.surfaceMuted, borderRadius: radiusPx(radiusLevel.inner), display: "block", height: 260, width: "100%" } }}>
          <ResearchRecordingChart recording={research.recording} />
        </Box>
        <Typography color="text.secondary" variant="body2">Orange: raw acceleration magnitude envelope. Blue: board motion RMS around each window’s mean vector.</Typography>
        {research.recording && <Box sx={{ mt: 2 }}><ResearchResult report={research.recording.report} transferMs={Number(research.recording.meta.transferMs) || 0} /></Box>}
      </Paper>

      <Paper elevation={0} sx={surfaceSx({ shadow: true })}>
        <Typography variant="h2">Device log</Typography>
        <Box component="pre" sx={{ ...surfaceSx({ bgcolor: colors.surfaceMuted, level: radiusLevel.inner, padding: space.md }), maxHeight: 280, overflow: "auto", whiteSpace: "pre-wrap" }}>
          {connection.log.length ? connection.log.join("\n") : "No messages yet."}
        </Box>
      </Paper>
    </Stack>
  );
}
