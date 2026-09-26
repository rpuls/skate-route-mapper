# The board stream transport

How data gets off the XIAO board without losing any of it.

One mechanism carries everything. A **stream** is an append-only sequence of
fixed-width records that the board keeps in a durable window and the phone
reads with a cursor. The transport never looks inside a record. Adding a new
kind of board data is a new record layout and a new producer, not a new
protocol, a new characteristic or new retry logic.

- Wire format and the cursor: `shared/src/xiaoStream.ts`
- Board side: `firmware/xiao-lsm6dsox/SkateRouteXiaoImu/StreamTransport.h`
- Phone side: `mobile/src/native/stream/`
- Tests: `mobile/test/contracts/streamTransport.contract.test.ts`

## Why a window rather than acknowledgements

BLE's link layer already acknowledges and retransmits every packet. Records are
not corrupted in flight and an application-level ACK would buy nothing.

What is actually lost is data the board throws away **before it reaches the
radio**. The old ride path called `setValue()` and `notify()` every 20 ms
regardless of whether the previous notification had gone out, so anything the
stack could not send was overwritten and gone. That is the packet loss measured
on 2026-09-24: up to 42.9% in a window, and nothing in the app ever knew.

A window fixes it at the source. The board keeps what it could not send; the
phone asks for it later. That also makes backpressure free — a slow link just
means the phone falls behind — and needs no retransmit timers on a
microcontroller.

## Two delivery profiles, one primitive

|  | live (a ride) | bulk (a research capture) |
|---|---|---|
| fast path | notified frames | none |
| repair | only the holes it detects | reads the window end to end |
| latency | radio latency, holes fill in seconds | irrelevant |
| duration | the whole ride | 10/30/60 s |

The difference is **when the phone reads**, not how. Both use `STREAM_READ` and
both get the same integrity guarantees. A consumer sees one ordered, gap-free,
deduplicated sequence either way and cannot tell which path a record took.

## Operations

Ops 1–4 are the original research capture and keep their numbers so firmware
and app can be updated independently. Everything new goes at 5 and up.

| op | name | meaning |
|---|---|---|
| 1–4 | `STATUS`/`START`/`RAW`/`SUMMARIES` | research capture, unchanged |
| 5 | `LIST` | every stream the board serves |
| 6 | `INFO` | one stream's window |
| 7 | `READ` | a page of records from a sequence |
| 8 | `RELEASE` | everything below this sequence is durably stored |

`INFO` returns `firstSeq`/`nextSeq` (the half-open readable window),
`capacity`, `releasedSeq` and `dropped`. **`dropped` is the number that
matters**: records the board overwrote before the phone read them. It is the
one loss the phone cannot repair, and it says the window is too small or the
link was down too long.

### Refusals

A response always parses; `flags` says whether the payload means anything.
Telling these apart is load-bearing — retrying an eviction is an infinite loop
against data that no longer exists.

| flag | meaning | retry? |
|---|---|---|
| 2 `RANGE` | asked past the end | yes, at a corrected offset |
| 4 `NO_STREAM` | no such stream | never |
| 5 `EVICTED` | already overwritten | never |

## GATT

| characteristic | use |
|---|---|
| `…c44c0001` service | everything below |
| `…d3…` control (write) | 12-byte command |
| `…d4…` response (read) | 20-byte header + payload + CRC32 |
| `…d5…` data (notify) | 8-byte frame header + one record |
| `…d1…` IMU (notify) | **legacy**, see below |

The board notifies the stream characteristic **only while a client is
subscribed to it**, and otherwise serves the original IMU characteristic. The
admin hardware bench and older app builds are unaffected, and exactly one of
the two is ever sent, so the wire cost is unchanged.

The response value is stable until the next command, which is what makes ATT
long reads safe at a small MTU.

## Concurrency

The board answers on a **single** response characteristic. Two callers in
flight at once and one reads the other's answer. Every request in the app
therefore goes through one `CommandChannel` per connection
(`mobile/src/native/stream/commandChannel.ts`), which serialises them. Research
transfers and ride repair take turns.

Do not add a second requester. Use the channel.

## Delivery is storage

`onRecords` returning is what lets the board be told the records are safe. If
it rejects, nothing is released and the board keeps them. "Delivered" means
written to SQLite on the phone, not handed to a radio.

## Time

**A repaired record must not be stamped with its arrival time.** It can arrive
minutes after the road it describes, and stamping it with the current position
would pile a whole stretch of road onto the single point where the link came
back — visibly wrong on the map and silently wrong in the data.

Every record carries the board's `millis()`. `createBoardClock` estimates the
offset to phone time as the *minimum* observed `phoneTime − boardUptime`, since
transport delay only ever pushes that difference up, and lets the floor rise
slowly to follow clock drift. Only live arrivals feed the estimate; a repaired
one waited an unknown time and would bias it.

`rideRecorder` then joins each reading to the GPS fix **nearest it in time**
from a bounded history, not to whatever fix is current.

## Losses the phone reports

A consumer is told about the stretches that will never arrive, because one that
is only told about successes treats a hole as smooth tarmac.

| reason | cause |
|---|---|
| `evicted` | the board overwrote them; window too small or link down too long |
| `expired` | still readable, but the cursor waited longer than `maxHoldMs` |
| `overflow` | too many records held behind one unfilled hole |

A board that restarts mid-ride (a brown-out, a reset) numbers its records from
zero again. The cursor notices the sequence going backwards and starts over
rather than asking for records that will not exist for another minute. How much
road that cost is not knowable from the phone, so no range is invented; the
count appears as `restarts` in the reader's stats.

## Firmware older than the stream layer

The app degrades rather than breaking. A board that answers the read ops with
`UNSUPPORTED` is detected after three attempts, the reader stops, and
`subscribeToXiaoSamples` keeps recording the ride from notifications exactly as
it did before. The handoff is clean in the other direction too: a reader
attaches at the board's live edge, which is where the notification path left
off, so no sample is recorded twice.

`isSurfaceStreamRecording()` is what decides which path writes. Exactly one of
them ever does.

## Sizing

The ride window asks for 160,000 records of 20 bytes — 3.2 MB of the 8 MB
SPIRAM, a little under an hour at the 20 ms default. The research capture is
allocated first because it needs a specific amount and falls back to internal
RAM if it cannot get it; the ride window takes what is left and halves until it
fits, reporting what it actually got through `INFO`.

**PSRAM is volatile.** A brown-out loses the window. Battery runtime is still
unmeasured (see `hardware/HARDWARE-HANDOFF.md`), so this is a real limit, not a
theoretical one.

## Adding a new kind of board data

1. Define a `StreamKind` in `shared/src/xiaoStream.ts` — an id, a stride and a
   `decode`. This is the only place that knows the layout.
2. On the board, `stream::declareRing(...)` for something produced
   continuously, or `stream::declareView(...)` to expose a buffer another
   module already fills with no copy and no allocation.
3. Call `stream::append(...)` from the producer, and `stream::notifyRecord(...)`
   if it needs to be live.
4. On the phone, `connection.readStream({ streamId, kind, onRecords })`.

Nothing in the transport, the channel or the reader changes.
