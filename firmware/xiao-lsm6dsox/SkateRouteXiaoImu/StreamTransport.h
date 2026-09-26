#pragma once
#include <esp_heap_caps.h>

// The board side of the stream transport. See shared/src/xiaoStream.ts for the
// wire format and the reasoning; this file is the other half of that contract
// and the two must be changed together.
//
// A stream is an append-only sequence of fixed-width records with a durable
// window. Producers call append() and never block, never fail and never wait
// for the radio: if the link cannot keep up, records accumulate in the window
// instead of being thrown away, which is the whole point. The phone reads the
// window at whatever rate it can manage.
//
// Two shapes of stream:
//
//   ring  - owns SPIRAM and overwrites its oldest records when full. For data
//           produced continuously, like a ride.
//   view  - a read-only window over a buffer somebody else fills, with no copy
//           and no allocation. For data captured in bounded bursts, like a
//           research capture, which already has its own buffer and its own
//           lifecycle.
//
// Both answer the same three ops, so the phone has one reader for both.

namespace stream {

constexpr uint8_t VERSION = 1;
constexpr uint16_t MAGIC = 0x5253;
constexpr uint16_t HEADER = 20;
constexpr uint16_t CRC_SIZE = 4;
constexpr uint8_t FRAME_HEADER = 8;
constexpr uint16_t INFO_SIZE = 32;

// Sized so one round trip carries a useful amount of any stride we serve:
// 38 IMU records (~0.76 s of ride), 128 raw research records, 32 summaries.
// The cost of a page is dominated by the write-then-poll round trip rather
// than by its bytes, so a bigger page is close to free.
constexpr uint16_t MAX_PAYLOAD = 768;

constexpr uint8_t OP_LIST = 5, OP_INFO = 6, OP_READ = 7, OP_RELEASE = 8;

constexpr uint16_t FLAG_OK = 0, FLAG_REJECTED = 1, FLAG_RANGE = 2,
                   FLAG_UNSUPPORTED = 3, FLAG_NO_STREAM = 4, FLAG_EVICTED = 5;

constexpr uint8_t MAX_STREAMS = 4;

/** Returned by append() when there is no window to append to. */
constexpr uint32_t NO_SEQ = 0xffffffff;

constexpr uint32_t ID_RIDE_IMU = 1, ID_RESEARCH_RAW = 2, ID_RESEARCH_SUMMARIES = 3;
constexpr uint16_t KIND_IMU_PACKET = 1, KIND_RESEARCH_RAW = 2, KIND_RESEARCH_SUMMARY = 3;

struct Stream {
  uint32_t id = 0;
  uint16_t kind = 0;
  uint16_t stride = 0;
  uint32_t capacity = 0;
  uint32_t firstSeq = 0;
  uint32_t nextSeq = 0;
  // First sequence the phone has *not* confirmed storing. Everything below it
  // may be overwritten without loss; everything at or above it that gets
  // overwritten is counted in `dropped`.
  uint32_t releasedSeq = 0;
  uint32_t dropped = 0;
  uint8_t *base = nullptr;
  // A view's producer owns the count. Following the pointer keeps the window
  // correct while a capture is still filling without anyone having to poke us.
  const uint32_t *viewCount = nullptr;
  const uint8_t *activeFlag = nullptr;
  bool ring = false;
};

Stream streams[MAX_STREAMS];
uint8_t streamCount = 0;

BLECharacteristic *control = nullptr;
BLECharacteristic *response = nullptr;
BLECharacteristic *data = nullptr;

portMUX_TYPE commandMux = portMUX_INITIALIZER_UNLOCKED;
uint8_t pendingCommand[12];
bool pending = false;

// Ops 1-4 predate this layer and still belong to the research capture. It
// registers a handler rather than this file knowing anything about captures.
struct Reply {
  uint8_t *payload;
  uint16_t maxPayload;
  uint16_t records;
  uint16_t bytes;
  uint16_t flags;
  uint32_t streamId;
  uint32_t offset;
};

typedef void (*LegacyHandler)(uint8_t op, uint32_t id, uint32_t arg, Reply &reply);
LegacyHandler legacyHandler = nullptr;

inline void u16(uint8_t *p, uint16_t v) { p[0] = v; p[1] = v >> 8; }
inline void u32(uint8_t *p, uint32_t v) { for (int i = 0; i < 4; ++i) p[i] = v >> (8 * i); }
inline uint32_t read32(const uint8_t *p) {
  return uint32_t(p[0]) | (uint32_t(p[1]) << 8) | (uint32_t(p[2]) << 16) | (uint32_t(p[3]) << 24);
}
inline uint16_t read16(const uint8_t *p) { return uint16_t(p[0]) | (uint16_t(p[1]) << 8); }

uint32_t crc32(const uint8_t *bytes, size_t size) {
  uint32_t crc = 0xffffffff;
  for (size_t i = 0; i < size; ++i) {
    crc ^= bytes[i];
    for (int j = 0; j < 8; ++j) crc = (crc >> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return ~crc;
}

Stream *find(uint32_t id) {
  for (uint8_t i = 0; i < streamCount; ++i) {
    if (streams[i].id == id) return &streams[i];
  }
  return nullptr;
}

/** One past the newest record, following a view's producer if there is one. */
inline uint32_t endSeq(const Stream &s) {
  return s.viewCount ? *s.viewCount : s.nextSeq;
}

inline bool isActive(const Stream &s) {
  return s.activeFlag ? *s.activeFlag != 0 : s.ring;
}

/**
 * Claim SPIRAM for a continuously produced stream.
 *
 * Falls back through smaller windows rather than failing: a short window still
 * repairs the brief dropouts that interference causes, which is most of the
 * value. `capacityRecords` reports what was actually obtained, and the phone
 * reads it from INFO rather than assuming.
 */
bool declareRing(uint32_t id, uint16_t kind, uint16_t stride, uint32_t preferredRecords) {
  if (streamCount >= MAX_STREAMS || stride == 0) return false;

  Stream &s = streams[streamCount];
  uint32_t records = preferredRecords;

  while (records >= 1024) {
    s.base = static_cast<uint8_t *>(
      heap_caps_malloc(size_t(records) * stride, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
    if (s.base) break;
    records /= 2;
  }

  if (!s.base) return false;

  s.id = id; s.kind = kind; s.stride = stride;
  s.capacity = records; s.ring = true;
  ++streamCount;
  return true;
}

/**
 * Expose a buffer somebody else owns.
 *
 * No allocation and no copy — the research capture keeps its buffer, its
 * timing and its own ops, and gains the generic read path for free.
 */
bool declareView(uint32_t id, uint16_t kind, uint16_t stride, const uint8_t *base,
                 uint32_t capacity, const uint32_t *count, const uint8_t *active) {
  if (streamCount >= MAX_STREAMS || stride == 0 || !base) return false;

  Stream &s = streams[streamCount];
  s.id = id; s.kind = kind; s.stride = stride;
  s.capacity = capacity; s.base = const_cast<uint8_t *>(base);
  s.viewCount = count; s.activeFlag = active; s.ring = false;
  ++streamCount;
  return true;
}

/**
 * Add a record. Returns its sequence, or NO_SEQ if the stream has no window.
 *
 * The only operation on the producer's hot path, and it is a memcpy and two
 * increments. Overwriting the oldest record when full is the deliberate
 * policy: fresh road matters more than old road, and a producer that stalled
 * waiting for the phone would corrupt the sample timing that the whole
 * roughness measurement depends on.
 */
uint32_t append(uint32_t id, const uint8_t *record) {
  Stream *s = find(id);
  // Distinguishable from sequence zero, which a caller would otherwise stamp
  // onto every record after a failed allocation.
  if (!s || !s->ring || !s->base) return NO_SEQ;

  memcpy(s->base + size_t(s->nextSeq % s->capacity) * s->stride, record, s->stride);
  ++s->nextSeq;

  if (s->nextSeq - s->firstSeq > s->capacity) {
    const uint32_t newFirst = s->nextSeq - s->capacity;
    const uint32_t lostFrom = s->firstSeq > s->releasedSeq ? s->firstSeq : s->releasedSeq;
    if (newFirst > lostFrom) s->dropped += newFirst - lostFrom;
    s->firstSeq = newFirst;
  }

  return s->nextSeq - 1;
}

/** True when a client has subscribed to framed notifications. */
bool liveSubscribed() {
  if (!data) return false;
  auto *cccd = static_cast<BLE2902 *>(data->getDescriptorByUUID(BLEUUID(uint16_t(0x2902))));
  return cccd && cccd->getNotifications();
}

/**
 * Notify one record.
 *
 * The frame carries its stream id and sequence, so one characteristic serves
 * every stream and a notified record is byte-identical to the same record read
 * back from the window later. That identity is what lets the phone decode both
 * paths with one function, and what makes a repaired record indistinguishable
 * from one that arrived first time.
 */
void notifyRecord(uint32_t id, uint32_t seq, const uint8_t *record, uint16_t stride) {
  if (!data || !liveSubscribed()) return;

  uint8_t frame[FRAME_HEADER + MAX_PAYLOAD];
  if (stride > MAX_PAYLOAD) return;

  u16(frame, uint16_t(id));
  u16(frame + 2, 0);
  u32(frame + 4, seq);
  memcpy(frame + FRAME_HEADER, record, stride);

  data->setValue(frame, FRAME_HEADER + stride);
  data->notify();
}

uint16_t copyRecords(const Stream &s, uint32_t from, uint16_t maxRecords, uint8_t *out) {
  const uint32_t end = endSeq(s);
  if (from < s.firstSeq || from >= end) return 0;

  const uint32_t available = end - from;
  uint16_t want = available > maxRecords ? maxRecords : uint16_t(available);

  if (!s.ring) {
    memcpy(out, s.base + size_t(from) * s.stride, size_t(want) * s.stride);
    return want;
  }

  // A run of sequences can straddle the physical wrap, so it may take two
  // copies to produce one contiguous page.
  const uint32_t index = from % s.capacity;
  uint32_t firstRun = s.capacity - index;
  if (firstRun > want) firstRun = want;

  memcpy(out, s.base + size_t(index) * s.stride, size_t(firstRun) * s.stride);
  if (firstRun < want) {
    memcpy(out + size_t(firstRun) * s.stride, s.base, size_t(want - firstRun) * s.stride);
  }

  return want;
}

void writeInfo(const Stream &s, uint8_t *p) {
  u32(p, s.id);
  u16(p + 4, s.kind);
  u16(p + 6, s.stride);
  u32(p + 8, s.capacity);
  u32(p + 12, s.firstSeq);
  u32(p + 16, endSeq(s));
  u32(p + 20, s.releasedSeq);
  u32(p + 24, s.dropped);
  u32(p + 28, isActive(s) ? 1 : 0);
}

void handle(uint8_t op, uint32_t id, uint32_t arg, Reply &reply) {
  if (op == OP_LIST) {
    // Discovery, so a newer board can serve an older app without either
    // guessing what the other supports.
    for (uint8_t i = 0; i < streamCount && reply.bytes + INFO_SIZE <= reply.maxPayload; ++i) {
      writeInfo(streams[i], reply.payload + reply.bytes);
      reply.bytes += INFO_SIZE;
      ++reply.records;
    }
    return;
  }

  Stream *s = find(id);
  if (!s) { reply.flags = FLAG_NO_STREAM; return; }

  reply.streamId = s->id;

  if (op == OP_INFO) {
    writeInfo(*s, reply.payload);
    reply.bytes = INFO_SIZE;
    reply.records = 1;
    return;
  }

  if (op == OP_RELEASE) {
    // Advisory: a ring reclaims by overwriting either way. What this buys is an
    // honest `dropped` count — the board can only know a record was lost rather
    // than merely old if it knows how far the phone got.
    if (arg > s->releasedSeq) s->releasedSeq = arg;
    if (s->releasedSeq > endSeq(*s)) s->releasedSeq = endSeq(*s);
    writeInfo(*s, reply.payload);
    reply.bytes = INFO_SIZE;
    reply.records = 1;
    return;
  }

  if (op == OP_READ) {
    reply.offset = arg;

    // Separating these two matters to the reader: a range it asked for too
    // early is worth asking for again, one that has been overwritten never is.
    if (arg < s->firstSeq) { reply.flags = FLAG_EVICTED; return; }
    if (arg >= endSeq(*s)) { reply.flags = FLAG_RANGE; return; }

    const uint16_t maximum = reply.maxPayload / s->stride;
    reply.records = copyRecords(*s, arg, maximum, reply.payload);
    reply.bytes = reply.records * s->stride;
    return;
  }

  reply.flags = FLAG_UNSUPPORTED;
}

class Commands : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *c) override {
    String value = c->getValue();
    if (value.length() != 12 || uint8_t(value[0]) != VERSION) return;
    // Buffers and the sensor bus are only ever touched from loop(). A BLE
    // callback runs on the stack of another task, so it queues and returns.
    portENTER_CRITICAL(&commandMux);
    if (!pending) { memcpy(pendingCommand, value.c_str(), 12); pending = true; }
    portEXIT_CRITICAL(&commandMux);
  }
};

void commandTick() {
  uint8_t cmd[12];
  bool ready;

  portENTER_CRITICAL(&commandMux);
  ready = pending;
  if (ready) { memcpy(cmd, pendingCommand, 12); pending = false; }
  portEXIT_CRITICAL(&commandMux);

  if (!ready || !response) return;

  static uint8_t out[HEADER + MAX_PAYLOAD + CRC_SIZE];
  memset(out, 0, HEADER);

  const uint8_t op = cmd[1];
  const uint32_t id = read32(cmd + 4), arg = read32(cmd + 8);

  Reply reply = {out + HEADER, MAX_PAYLOAD, 0, 0, FLAG_OK, id, arg};

  if (op >= OP_LIST) {
    handle(op, id, arg, reply);
  } else if (legacyHandler) {
    legacyHandler(op, id, arg, reply);
  } else {
    reply.flags = FLAG_UNSUPPORTED;
  }

  u16(out, MAGIC);
  out[2] = VERSION;
  out[3] = op;
  u16(out + 4, read16(cmd + 2));
  u16(out + 6, reply.flags);
  u32(out + 8, reply.streamId);
  u32(out + 12, reply.offset);
  u16(out + 16, reply.records);
  u16(out + 18, reply.bytes);
  u32(out + HEADER + reply.bytes, crc32(out, HEADER + reply.bytes));

  // Stable until the next command, so an ATT long read at a small MTU sees one
  // consistent value across its blobs.
  response->setValue(out, HEADER + reply.bytes + CRC_SIZE);
}

void setup(BLEService *service, LegacyHandler legacy) {
  legacyHandler = legacy;

  control = service->createCharacteristic(
    "7b32f8d3-5d0b-4f0e-a1f5-8f30c44c0001", BLECharacteristic::PROPERTY_WRITE);
  control->setCallbacks(new Commands());

  response = service->createCharacteristic(
    "7b32f8d4-5d0b-4f0e-a1f5-8f30c44c0001", BLECharacteristic::PROPERTY_READ);
  uint8_t empty = 0;
  response->setValue(&empty, 1);

  data = service->createCharacteristic(
    "7b32f8d5-5d0b-4f0e-a1f5-8f30c44c0001",
    BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
  data->addDescriptor(new BLE2902());
}

} // namespace stream
