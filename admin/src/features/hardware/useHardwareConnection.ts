import {
  XIAO_BLE_IMU_CHARACTERISTIC_UUID,
  XIAO_BLE_SERVICE_UUID,
  parseXiaoImuPacket,
} from "@skate-route-mapper/shared/xiaoBle";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  errorMessage,
  hardwareNavigator,
  type BluetoothCharacteristicLike,
  type BluetoothDeviceLike,
  type BluetoothServiceLike,
  type SerialPortLike,
} from "./browserHardware";
import { ResearchClient } from "./researchClient";
import { parseSerialSample, type HardwareSample } from "./telemetry";

type UsbSession = { kind: "usb"; port: SerialPortLike; reader: ReadableStreamDefaultReader<Uint8Array> | null; stopping: boolean };
type BleSession = {
  kind: "ble";
  device: BluetoothDeviceLike;
  characteristic: BluetoothCharacteristicLike;
  onSample: EventListener;
  onDisconnect: EventListener;
};
type Session = UsbSession | BleSession;

export type HardwareConnection = {
  kind: "usb" | "ble" | null;
  label: string;
  device: string;
  message: string;
  bluetooth: string;
  bluetoothNote: string;
  busy: boolean;
  samples: HardwareSample[];
  latest: HardwareSample | null;
  log: string[];
  researchClient: ResearchClient | null;
  researchSession: number;
};

const initialState: HardwareConnection = {
  kind: null,
  label: "Disconnected",
  device: "No device selected",
  message: "Choose USB for serial diagnostics, or BLE for live preview and research recording.",
  bluetooth: "Unknown",
  bluetoothNote: "USB connectivity does not confirm BLE connectivity.",
  busy: false,
  samples: [],
  latest: null,
  log: [],
  researchClient: null,
  researchSession: 0,
};

export function useHardwareConnection() {
  const [state, setState] = useState(initialState);
  const sessionRef = useRef<Session | null>(null);

  const update = useCallback((values: Partial<HardwareConnection>) => {
    setState((current) => ({ ...current, ...values }));
  }, []);

  const log = useCallback((message: string) => {
    setState((current) => ({
      ...current,
      log: [...current.log, `${new Date().toLocaleTimeString()}  ${message}`].slice(-60),
    }));
  }, []);

  const accept = useCallback((sample: Omit<HardwareSample, "receivedAt">) => {
    const received = { ...sample, receivedAt: performance.now() };
    setState((current) => ({
      ...current,
      latest: received,
      message: current.latest ? current.message : "Sensor readings received. Try resting, tilting, then gently tapping beside it.",
      samples: [...current.samples, received].slice(-3000),
    }));
  }, []);

  const end = useCallback((session: Session, message: string) => {
    if (sessionRef.current !== session) return;
    sessionRef.current = null;
    setState((current) => {
      current.researchClient?.close();
      return {
        ...current,
        kind: null,
        label: "Disconnected",
        bluetooth: "Unknown",
        bluetoothNote: "No current connection to verify Bluetooth status.",
        message,
        busy: false,
        researchClient: null,
        researchSession: current.researchSession + 1,
      };
    });
    log(message);
  }, [log]);

  const connectUsb = useCallback(async () => {
    if (!hardwareNavigator.serial || sessionRef.current) return;
    update({ busy: true });
    let port: SerialPortLike | undefined;
    try {
      port = await hardwareNavigator.serial.requestPort();
      await port.open({ baudRate: 115200 });
      await port.setSignals({ dataTerminalReady: true, requestToSend: false });
      const session: UsbSession = { kind: "usb", port, reader: null, stopping: false };
      sessionRef.current = session;
      update({
        kind: "usb", label: "USB connected", device: "XIAO serial port · 115200 baud", busy: false,
        samples: [], latest: null, message: "Port open. Waiting for sensor data or firmware messages.",
      });
      log("USB port opened at 115200 baud.");

      const decoder = new TextDecoder();
      let pending = "";
      session.reader = port.readable?.getReader() ?? null;
      while (!session.stopping && session.reader) {
        const { value, done } = await session.reader.read();
        if (done) break;
        pending += decoder.decode(value, { stream: true });
        const lines = pending.split("\n");
        pending = lines.pop() ?? "";
        for (const rawLine of lines) {
          const line = rawLine.trim();
          const sample = parseSerialSample(line);
          if (sample) accept(sample);
          else if (line) {
            log(line.slice(0, 500));
            const status = line.match(/status imu=(ready|missing) ble=(connected|advertising)/);
            if (status) update({
              bluetooth: status[2] === "connected" ? "Client connected" : "Advertising",
              bluetoothNote: "Reported by firmware over USB; this is not a browser BLE connection.",
              message: status[1] === "missing"
                ? "Firmware cannot find the sensor. Disconnect power before checking its four wires."
                : "BLE firmware detected. Disconnect USB in this page, leave the cable connected for power, then connect BLE.",
            });
          }
        }
      }
      session.reader?.releaseLock();
      try { await port.close(); } catch { /* Device already closed. */ }
      end(session, "USB disconnected. Reconnect to start a fresh session.");
    } catch (error) {
      try { await port?.close(); } catch { /* Port did not finish opening. */ }
      update({ busy: false, message: `USB connection: ${errorMessage(error)}. Close other serial readers and check the data cable.` });
    }
  }, [accept, end, log, update]);

  const connectBle = useCallback(async () => {
    if (!hardwareNavigator.bluetooth || sessionRef.current) return;
    update({ busy: true });
    let device: BluetoothDeviceLike | undefined;
    try {
      device = await hardwareNavigator.bluetooth.requestDevice({ filters: [{ services: [XIAO_BLE_SERVICE_UUID] }] });
      if (!device.gatt) throw new Error("Selected device has no GATT server");
      const server = await device.gatt.connect();
      const service: BluetoothServiceLike = await server.getPrimaryService(XIAO_BLE_SERVICE_UUID);
      const characteristic = await service.getCharacteristic(XIAO_BLE_IMU_CHARACTERISTIC_UUID);
      const session = {} as BleSession;
      Object.assign(session, {
        kind: "ble", device, characteristic,
        onSample: ((event: Event) => {
          if (sessionRef.current !== session) return;
          const value = (event.target as BluetoothCharacteristicLike).value;
          if (!value) return;
          try {
            accept(parseXiaoImuPacket(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)));
          } catch (error) {
            update({ message: `Invalid BLE sample: ${errorMessage(error)}` });
          }
        }) as EventListener,
        onDisconnect: (() => end(session, "BLE disconnected. Choose Connect BLE to reconnect.")) as EventListener,
      });
      sessionRef.current = session;
      device.addEventListener("gattserverdisconnected", session.onDisconnect);
      characteristic.addEventListener("characteristicvaluechanged", session.onSample);
      await characteristic.startNotifications();
      const researchClient = new ResearchClient(service);
      update({
        kind: "ble", label: "BLE connected", device: device.name || "Skate XIAO IMU", busy: false,
        bluetooth: "Browser connected", bluetoothNote: "Subscribed to the XIAO’s live sensor notifications.",
        message: "BLE connected. Waiting for sensor notifications; keep the XIAO powered.", samples: [], latest: null,
        researchClient, researchSession: state.researchSession + 1,
      });
      log("BLE sensor notifications subscribed.");
    } catch (error) {
      device?.gatt?.disconnect();
      sessionRef.current = null;
      update({ busy: false, message: `BLE connection: ${errorMessage(error)}. Disconnect other BLE clients and keep the board powered.` });
    }
  }, [accept, end, log, state.researchSession, update]);

  const disconnect = useCallback(async () => {
    const session = sessionRef.current;
    if (!session) return;
    update({ busy: true });
    try {
      if (session.kind === "usb") {
        session.stopping = true;
        await session.reader?.cancel();
      } else {
        session.characteristic.removeEventListener("characteristicvaluechanged", session.onSample);
        session.device.removeEventListener("gattserverdisconnected", session.onDisconnect);
        session.device.gatt?.disconnect();
        end(session, "BLE disconnected.");
      }
    } catch (error) {
      update({ busy: false, message: `Disconnect: ${errorMessage(error)}` });
    }
  }, [end, update]);

  useEffect(() => () => {
    const session = sessionRef.current;
    if (!session) return;
    if (session.kind === "usb") {
      session.stopping = true;
      void session.reader?.cancel();
    } else {
      session.characteristic.removeEventListener("characteristicvaluechanged", session.onSample);
      session.device.removeEventListener("gattserverdisconnected", session.onDisconnect);
      session.device.gatt?.disconnect();
    }
  }, []);

  return {
    ...state,
    support: { usb: Boolean(hardwareNavigator.serial), ble: Boolean(hardwareNavigator.bluetooth) },
    connectUsb,
    connectBle,
    disconnect,
  };
}
