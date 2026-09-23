export type SerialPortLike = {
  readable: ReadableStream<Uint8Array> | null;
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  setSignals(options: { dataTerminalReady: boolean; requestToSend: boolean }): Promise<void>;
};

export type BluetoothCharacteristicLike = EventTarget & {
  value?: DataView;
  readValue(): Promise<DataView>;
  startNotifications(): Promise<BluetoothCharacteristicLike>;
  writeValueWithResponse(value: Uint8Array): Promise<void>;
};

export type BluetoothServiceLike = {
  getCharacteristic(uuid: string): Promise<BluetoothCharacteristicLike>;
};

export type BluetoothDeviceLike = EventTarget & {
  name?: string;
  gatt?: {
    connected: boolean;
    connect(): Promise<{ getPrimaryService(uuid: string): Promise<BluetoothServiceLike> }>;
    disconnect(): void;
  };
};

type HardwareNavigator = Navigator & {
  serial?: { requestPort(): Promise<SerialPortLike> };
  bluetooth?: {
    requestDevice(options: { filters: Array<{ services: string[] }> }): Promise<BluetoothDeviceLike>;
  };
};

export const hardwareNavigator = navigator as HardwareNavigator;

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
