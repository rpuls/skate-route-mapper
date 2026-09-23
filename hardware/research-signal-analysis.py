"""Local analysis: raw samples stay on disk; stdout contains only derived metrics.

Usage: python hardware/research-signal-analysis.py input.skateresearch output-dir
Dependencies: numpy, scipy, matplotlib. No network or device access.
"""
import argparse
import hashlib
import json
import struct
import zlib
from pathlib import Path

import numpy as np
import scipy
from scipy import signal
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt


def load_recording(path):
    data = path.read_bytes()
    if len(data) < 12 or data[:8] != b"SKATER01":
        raise ValueError("Invalid recording magic")
    size = struct.unpack_from("<I", data, 8)[0]
    if size > 65536 or size + 12 > len(data):
        raise ValueError("Invalid header length")
    meta = json.loads(data[12:12 + size])
    count, windows = meta["count"], meta["windows"]
    if not 0 < count <= 99960 or not 0 < windows <= 301:
        raise ValueError("Invalid sample/window count")
    raw = data[12 + size:12 + size + count * 6]
    summaries = data[12 + size + count * 6:]
    if len(raw) != count * 6 or len(summaries) != windows * 24:
        raise ValueError("Length mismatch")
    if zlib.crc32(raw) != meta["rawCrc"] or zlib.crc32(summaries) != meta["summariesCrc"]:
        raise ValueError("Checksum mismatch")
    integers = np.frombuffer(raw, dtype="<i2").reshape(-1, 3)
    axes = integers.astype(float) * meta["scaleG"]
    frames = [struct.unpack_from("<IIfffI", summaries, i * 24) for i in range(windows)]
    return data, meta, integers, axes, frames


def spectrum(axes, fs):
    nperseg = min(1024, len(axes))
    f, psd = signal.welch(axes, fs=fs, window="hann", nperseg=nperseg,
                          noverlap=nperseg // 2, detrend="constant", axis=0,
                          scaling="density")
    return f, psd.sum(axis=1)


def spectral_metrics(axes, fs):
    f, power = spectrum(axes, fs)
    df = f[1] - f[0]
    total = float(power[1:].sum() * df)
    bands = []
    for lo, hi in [(0, 5), (5, 25), (25, 50), (50, 100), (100, 200), (200, 400), (400, fs / 2 + df)]:
        selected = (f > 0) & (f >= lo) & (f < hi)
        energy = float(power[selected].sum() * df)
        bands.append({"lowHz": lo, "highHz": min(hi, fs / 2),
                      "rmsG": energy ** .5, "percentAcPower": 100 * energy / total if total else 0})
    above25 = float(power[f >= 25].sum() * df)
    peaks, _ = signal.find_peaks(power)
    strongest = sorted((i for i in peaks if f[i] >= 5), key=lambda i: power[i], reverse=True)[:5]
    return {"welchBinWidthHz": float(df), "acRmsG": total ** .5,
            "above25HzPercentAcPower": above25 / total * 100 if total else 0,
            "above25HzRmsG": above25 ** .5, "bands": bands,
            "strongestLocalPeaksAbove5Hz": [{"frequencyHz": float(f[i]), "densityG2PerHz": float(power[i])} for i in strongest]}


def segment_metrics(axes):
    centered = axes - axes.mean(axis=0)
    deviation = np.linalg.norm(centered, axis=1)
    return {"axisMeanG": axes.mean(axis=0).tolist(), "axisStdG": axes.std(axis=0).tolist(),
            "vectorRmsAroundMeanG": float(np.sqrt(axes.var(axis=0).sum())),
            "deviationMedianG": float(np.median(deviation)),
            "deviationP95G": float(np.percentile(deviation, 95)),
            "deviationP99G": float(np.percentile(deviation, 99)),
            "peakDeviationG": float(deviation.max()),
            "peakVectorMagnitudeG": float(np.linalg.norm(axes, axis=1).max())}


def analyze(path, output):
    data, meta, integers, axes, frames = load_recording(path)
    fs, count = meta["rateHz"], len(axes)
    t = np.arange(count) / fs
    expected, max_error = 0, 0.0
    frame_data = []
    for first, n, rms, peak, mean, clipped in frames:
        if first != expected or n != min(meta["windowSamples"], count - expected):
            raise ValueError("Summary gap/overlap")
        a = axes[first:first + n]
        computed = [float(np.sqrt(a.var(axis=0).sum())), float(np.linalg.norm(a, axis=1).max()), float(np.linalg.norm(a, axis=1).mean())]
        max_error = max(max_error, *(abs(x - y) for x, y in zip(computed, [rms, peak, mean])))
        if clipped != int((np.abs(integers[first:first + n].astype(np.int32)) >= 32760).any(axis=1).sum()):
            raise ValueError("Clipped-count mismatch")
        frame_data.append({"startSeconds": first / fs, "endSeconds": (first + n) / fs, "rmsG": rms, "peakNormG": peak})
        expected += n
    if expected != count:
        raise ValueError("Missing final summary")
    duplicates = np.all(np.diff(integers.astype(np.int32), axis=0) == 0, axis=1)
    longest = run = 0
    for same in duplicates:
        run = run + 1 if same else 0
        longest = max(longest, run)
    norm = np.linalg.norm(axes, axis=1)
    per_second = []
    for second in range(int(np.ceil(count / fs))):
        a = axes[second * fs:min((second + 1) * fs, count)]
        per_second.append({"startSeconds": second, "samples": len(a),
                           "vectorRmsAroundMeanG": float(np.sqrt(a.var(axis=0).sum())),
                           "peakNormG": float(np.linalg.norm(a, axis=1).max())})
    half = count // 2
    groups = {"whole": axes, "firstHalf": axes[:half], "secondHalf": axes[half:],
              "settled0to4s": axes[:min(4 * fs, count)],
              "strongMotion6to10s": axes[min(6 * fs, count):]}
    spectra = {name: spectral_metrics(a, fs) for name, a in groups.items()}
    segments = {name: segment_metrics(a) for name, a in groups.items()}
    rms_ratio = segments["secondHalf"]["vectorRmsAroundMeanG"] / max(segments["firstHalf"]["vectorRmsAroundMeanG"], 1e-12)
    descriptive_segments = {
        "initial0to0_5s": spectral_metrics(axes[:fs // 2], fs),
        "interval1to5s": spectral_metrics(axes[fs:min(5 * fs, count)], fs),
    } if count >= 5 * fs else {}
    frame_rms = np.array([f[2] for f in frames])
    report = {
        "input": str(path.resolve()), "sha256": hashlib.sha256(data).hexdigest(),
        "software": {"numpy": np.__version__, "scipy": scipy.__version__, "matplotlib": matplotlib.__version__},
        "metadata": {k: v for k, v in meta.items() if k != "report"},
        "integrity": {"rawAndSummaryCrcsMatch": True, "summaryCoverageSamples": expected,
                      "maxSummaryErrorG": max_error, "summariesMatch": max_error < 1e-5,
                      "completeByRecordedCounters": meta["state"] == 2 and meta["error"] == 0 and count == meta["target"] and meta["overruns"] == 0 and meta["busErrors"] == 0},
        "timing": {"samples": count, "nominalRateHz": fs, "nominalDurationSeconds": count / fs,
                   "boardElapsedSeconds": meta["elapsedUs"] / 1e6,
                   "averageRateFromBoardElapsedHz": count / (meta["elapsedUs"] / 1e6),
                   "nominalNyquistHz": fs / 2, "nominalIntervalMs": 1000 / fs,
                   "sensorTimestampRateHz": meta.get("timestampDecimation", 0) * 40000 / meta.get("meanTimestampDeltaTicks", 1),
                   "timestampBlocks": meta.get("timestampCount"), "timestampDeltaMinTicks": meta.get("minTimestampDeltaTicks"),
                   "timestampDeltaMaxTicks": meta.get("maxTimestampDeltaTicks"), "timestampDeltaStdTicks": meta.get("stdTimestampDeltaTicks"),
                   "limitation": "Sensor timestamps audit cadence in 32-sample blocks; individual-sample jitter is not retained."},
        "signal": {"axisMinG": axes.min(axis=0).tolist(), "axisMaxG": axes.max(axis=0).tolist(),
                   "peakNormG": float(norm.max()), "clippedSamples": int((np.abs(integers.astype(np.int32)) >= 32760).any(axis=1).sum()),
                   "identicalAdjacentTriples": int(duplicates.sum()), "longestIdenticalRunSamples": longest + 1,
                   "summaryRmsMinMedianMaxG": [float(frame_rms.min()), float(np.median(frame_rms)), float(frame_rms.max())],
                   "firstHalfMedianWindowRmsG": float(np.median(frame_rms[:len(frames)//2])),
                   "secondHalfMedianWindowRmsG": float(np.median(frame_rms[len(frames)//2:]))},
        "segments": segments,
        "halfComparison": {"secondToFirstRmsRatio": rms_ratio, "secondToFirstPowerDb": float(20 * np.log10(rms_ratio))},
        "spectral": spectra, "descriptiveSegments": descriptive_segments, "perSecond": per_second,
        "storage": {"fileBytes": len(data), "rawBytes": count * 6, "summaryBytes": len(frames) * 24,
                    "metadataAndFramingBytes": len(data) - count * 6 - len(frames) * 24,
                    "projectedRawBytesPerHour": fs * 6 * 3600,
                    "projectedSummaryBytesPerHour": fs / meta["windowSamples"] * 24 * 3600,
                    "retrievalSecondsAcrossAttempts": meta.get("transferMs", 0) / 1000},
        "methods": f"Welch PSD: nominal {fs} Hz, Hann 1024-point windows, 50% overlap, constant detrending per segment, sum of three axis PSDs. Bands integrate discrete bins excluding DC. Split halves use the supplied still/shaking labels. Near-Nyquist energy can contain aliases."
    }
    output.mkdir(parents=True, exist_ok=True)
    (output / "metrics.json").write_text(json.dumps(report, indent=2), encoding="utf8")
    (output / "window-metrics.json").write_text(json.dumps(frame_data, indent=2), encoding="utf8")
    plt.rcParams.update({"font.size": 10, "axes.spines.top": False, "axes.spines.right": False})
    fig, ax = plt.subplots(4, 1, figsize=(12, 14), constrained_layout=True)
    for i, label in enumerate(["X", "Y", "Z"]): ax[0].plot(t, axes[:, i], lw=.65, label=label)
    ax[0].set(title=f"Raw acceleration: {count:,} original samples (gravity included)", ylabel="Acceleration (g)")
    ax[0].legend(ncol=3)
    ax[1].stairs(frame_rms, [f[0] / fs for f in frames] + [count / fs], label="Board summary RMS", linewidth=1.8)
    ax[1].set(title="Motion variation in ~200 ms windows", ylabel="Vector RMS about mean (g)", xlabel="Nominal sample time (s)")
    for name, a in groups.items():
        f, power = spectrum(a, fs)
        ax[2].semilogy(f[1:], power[1:], label=name, lw=1)
    ax[2].axvline(25, color="black", ls="--", lw=1, label="50 Hz raw stream: Nyquist limit")
    ax[2].set(title="Frequency content: sum of per-axis power spectra", xlabel="Frequency (Hz, nominal clock)", ylabel="Power density (g²/Hz)", xlim=(0, fs / 2))
    ax[2].legend()
    f, st, spec = signal.spectrogram(axes, fs=fs, window="hann", nperseg=256, noverlap=192, detrend="constant", axis=0, scaling="density", mode="psd")
    combined = spec.sum(axis=1)
    mesh = ax[3].pcolormesh(st, f, 10 * np.log10(np.maximum(combined, 1e-12)), shading="auto", vmin=-65, vmax=-5)
    ax[3].set(title="When fast vibration occurs (sum of XYZ spectral power)", xlabel="Nominal sample time (s)", ylabel="Frequency (Hz)", ylim=(0, fs / 2))
    fig.colorbar(mesh, ax=ax[3], label="dB relative to 1 g²/Hz")
    fig.suptitle(f"Research recording {meta['captureId']} — desk test, not road classification", fontsize=15)
    fig.savefig(output / "signal-analysis.png", dpi=150)
    fig.savefig(output / "signal-analysis.pdf")
    plt.close(fig)
    print(json.dumps({k: report[k] for k in ["integrity", "timing", "signal", "storage", "perSecond"]}, indent=2))
    print(json.dumps({name: {k: value[k] for k in ["above25HzPercentAcPower", "above25HzRmsG", "strongestLocalPeaksAbove5Hz", "bands"]} for name, value in spectra.items()}, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("recording", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    analyze(args.recording, args.output)
