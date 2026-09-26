# Custom PCB: concept study

Last updated: 2026-09-26

Status: **exploration, nothing committed.** This is a paper design with sourcing
and costs, written so the idea can be judged before any money or layout time is
spent. Established hardware facts live in
[the living handoff](HARDWARE-HANDOFF.md); nothing here has been built or
measured. Prices are estimates from late 2026 and must be re-checked against
live stock before ordering.

## The goal

Replace the current stack — XIAO ESP32S3 + Adafruit LSM6DSOX breakout + loose
jumper wires + pouch cell + an optional mechanical switch — with one board that
carries only what this product uses, plus the battery telemetry the current
hardware cannot provide.

Required by the brief: MCU, BLE, the vibration sensor, battery charging,
battery voltage/charge reading, USB-C, an on/off button, and a real 2.4 GHz
antenna.

**The driver is assembly and enclosure fit, not cost.** The current stack is
tedious and error-prone to build by hand and awkward to package; those are the
problems being solved. Cost is analysed below because it was asked about, and
the answer is that it only improves at quantity — it is not the reason to do
this. See [Assembly](#assembly-what-the-vendor-does-and-what-is-left).

## The constraint that decides the whole design

The firmware allocates its buffers in SPIRAM:

| Buffer | Where | Size |
| --- | --- | ---: |
| Research capture, 1,666 Hz x 60 s x 6 B | `ResearchCapture.h:209` | ~586 KiB |
| Ride window, 160,000 records x 20 B | `SkateRouteXiaoImu.ino:31` | ~3.05 MiB |
| **Total preferred** | | **~3.63 MiB** |

That number rules out most of the obvious "smaller, cheaper, BLE-only" parts
before any other discussion. An nRF52840 has 256 KiB of RAM — about 7% of what
the ride window alone asks for. Moving to it is not a PCB change, it is a
rewrite of `StreamTransport.h`, `ResearchCapture.h` and the BLE stack, and it
trades ~3 MiB of buffer for an external flash and a different loss-repair
story. Out of scope for a first board.

So the MCU stays ESP32-S3 **with PSRAM**, and that narrows the module choice to
exactly two candidates:

| Module | Flash + PSRAM | Size | Ride window it supports |
| --- | --- | --- | --- |
| `ESP32-S3-MINI-1U-N4R2` | 4 MB + **2 MB quad** | 15.4 x 20.5 mm | research capture + ~13 min |
| `ESP32-S3-WROOM-1U-N8R8` | 8 MB + **8 MB octal** | ~18 x 19.2 mm | research capture + **~53 min** |

`declareRing` halves its request until it fits, so the MINI would not fail — it
would silently drop from 160,000 records to 40,000. Thirteen minutes still
repairs a dropout behind a building; it does not cover a phone that iOS
suspended for most of a ride.

The MINI is 2.7 mm narrower and saves about $1. The WROOM-1U keeps the proven
`PSRAM=opi` build and the full window. **Take the WROOM-1U-N8R8.** It is the
same memory configuration as the XIAO, so the existing firmware runs unchanged
and the first board tests the hardware rather than a firmware port.

## Use a module, not a bare chip

"Custom PCB from scratch" should still stop at the RF boundary. A bare
ESP32-S3R8 needs its own flash, octal PSRAM, crystal, RF matching network,
antenna tuning and a spectrum analyser to verify — and it voids the module's
FCC/CE/IC modular approval, which matters the moment this is given to anyone
else. The module costs roughly what the bare chip plus flash plus PSRAM plus
the RF passives cost, and it arrives tuned and certified.

The `-1U` suffix is the version with a U.FL/IPEX connector instead of the PCB
antenna, so the existing external whip carries over. On a deck near metal
trucks and sitting on top of a pouch cell, that is the right call — and it
removes the PCB-antenna keep-out that would otherwise dictate the outline.

## What the current stack pays for and does not use

| Component | Unused on this product |
| --- | --- |
| XIAO ESP32S3 | 14 castellated pads and header holes, user LED, its own charger and LDO (duplicated in the stack), the second PCB and its RF section |
| LSM6DSOX breakout | 3.3 V regulator, I2C level shifters, 2x Stemma QT connectors, power LED, header strips |

One correction to the premise: **Wi-Fi cannot be removed.** The ESP32-S3 radio
is one die doing both; there is no Wi-Fi-less variant to buy. The firmware
never calls it, so it costs power only when enabled, which it is not. The only
way to stop paying for Wi-Fi silicon is to leave the ESP32 family, and that
costs the PSRAM. The genuinely removable waste is the connectors, the
duplicated power chain and the second PCB.

## Block diagram

```text
                 +-- CC1/CC2 5.1k to GND  (mandatory for a C-to-C cable)
   USB-C  -------+-- VBUS --> BQ24074 ---+--> SYS (system rail: USB, or cell)
   (power+data)  |            power path |
                 |            + TS/NTC   +--> BAT+ (charge at 100 mA = 0.4C)
                 +-- D+/D- --> USBLC6-2SC6 ESD --> GPIO19/20 (native USB)

   Cell 3.7 V 250 mAh (its own protection PCB, keep it)
     |
   BAT+ --+--> MAX17048 fuel gauge --I2C--> 0x36
          +--> 10k NTC bonded beside the cell --> BQ24074 TS

   SYS ----> soft-latch P-FET load switch <--- power button + MCU hold pin
                          |
                          +--> XC6220 3.3 V LDO --> module + IMU

   (charging continues regardless of the switch state, and the board
    runs from USB with no cell fitted at all)

   ESP32-S3-WROOM-1U-N8R8 --I2C--> LSM6DSOXTR (0x6A, CS tied high)
          |                  \---> INT1/INT2 (new: FIFO watermark, wake-on-motion)
          +-- U.FL --> external 2.4 GHz whip
```

## Bill of materials

Unit prices are rough, at quantity 10 and quantity 100.

| Function | Part | Package | @10 | @100 |
| --- | --- | --- | ---: | ---: |
| MCU + BLE + 8 MB flash + 8 MB PSRAM | `ESP32-S3-WROOM-1U-N8R8` | module, ~18 x 19.2 mm | $4.50 | $3.80 |
| IMU | `LSM6DSOXTR` (JLCPCB `C481766`) | LGA-14, 2.5 x 3 mm | $6.00 | $4.50 |
| LiPo charger **with power path** | `BQ24074RGTR` | VQFN-16, 3.5 x 3.5 mm | $2.20 | $1.80 |
| Charge-temperature sensor | 10 kOhm NTC, bonded beside the cell | 0603 | $0.10 | $0.06 |
| Fuel gauge | `MAX17048G+T10` (alt: `CW2015`) | TDFN-8, 2 x 2 mm | $2.50 | $2.00 |
| 3.3 V LDO, 500 mA | `XC6220A331MR-G` | SOT-25 | $0.35 | $0.20 |
| USB-C receptacle, 16-pin | `TYPE-C-31-M-12` | SMD | $0.15 | $0.10 |
| USB ESD array | `USBLC6-2SC6` | SOT-23-6 | $0.25 | $0.15 |
| Load-switch P-FET | `SI2301` / `AO3401` | SOT-23 | $0.05 | $0.03 |
| Soft-latch transistors | 2x `2N7002` | SOT-23 | $0.04 | $0.02 |
| Power button | SMD tact, 3 x 2 mm | | $0.10 | $0.06 |
| BOOT + RESET | 2x SMD tact, 2 x 4 mm | | $0.20 | $0.12 |
| Battery connector | `S2B-PH-K-S`, JST PH 2.0 | | $0.15 | $0.10 |
| Charge + status LEDs | 2x 0603 + resistors | | $0.05 | $0.03 |
| Passives | ~24x 0402/0603 R/C, incl. ISET/ILIM/TMR | | $0.50 | $0.32 |
| Antenna | 2.4 GHz whip + IPEX pigtail | | $2.00 | $1.50 |
| **Board total** | | | **~$19.14** | **~$14.79** |

Not in the table: the 250 mAh 502030 cell (~$4) and the enclosure, both
unchanged from today.

### Notes on the choices

**Charger — take the power path.** `MCP73831` is cheaper ($0.70), smaller
(SOT-23-5) and behaves exactly like the XIAO's charger, so it is the tempting
default. Take `BQ24074` anyway. Three reasons, in order of weight:

1. **The bench workflow changes.** Today the handoff treats unplugging the cell
   as the true off state, and `hardware/README.md` says to power the XIAO from
   USB with the LiPo disconnected. On a sealed board the cell is permanently
   connected, so *every* USB session becomes "USB in, cell attached, system
   running" — the one case where a non-power-path charger sees load current
   mixed with charge current and mis-terminates. What is a non-issue today
   becomes the normal case.
2. **Bring-up needs it.** The staged plan below flashes and enumerates before a
   lithium cell is ever connected. `MCP73831` driving a live load with no
   battery fitted has an unstable output — it charges, terminates, droops and
   restarts. `BQ24074` regulates `SYS` from USB whether or not a cell is
   present, which is what makes a battery-free first power-up safe.
3. **It has a `TS` pin.** One 10 kOhm NTC bonded beside the cell inhibits
   charging outside the manual's 10-45 C window. That is the thermal risk in
   the list below, and `MCP73831` has no answer to it at any price.

Set `ISET` for 100 mA (0.4C, inside the manual's 1C ceiling, and twice the
XIAO's 50 mA — a full charge drops from ~5.5 h to ~2.75 h) and `ILIM` for
500 mA. Peak draw is roughly 130 mA of BLE plus 100 mA of charge, so USB
current is never the constraint and the supplement path is headroom, not a
requirement.

**Battery reading — the power path decides this too.** With `SYS` separated
from `BAT`, a voltage divider can no longer hang off the switched rail: `SYS`
is not the cell voltage when USB is present, so the divider has to tap `BAT`,
which is always live. Keeping it from draining a 250 mAh cell in standby then
needs a high-side P-FET plus a level-shifting N-FET, because an
enable-FET at the bottom of the divider lets the midpoint float to 4.2 V into a
3.3 V ADC pin when it is off. That is two transistors, three resistors, a
calibration curve in firmware, and an ADC that still reads the voltage sag from
a BLE transmit burst as a flat battery.

Against that, `MAX17048` is ~$2.50, sits on the same I2C bus at 0x36, needs no
sense resistor, hibernates at a few microamps and reports state-of-charge
directly. **Populate the gauge.** Once the divider has to be gated, the cost
and complexity gap has mostly closed, and the gauge is the part that actually
answers the question the brief asks.

Keep an ungated 1 MOhm/1 MOhm divider footprint as an unpopulated fallback in
case gauge stock disappoints; `CW2015` is the cheaper and more widely stocked
alternative if `MAX17048` is an awkward line item.

**Power button.** Not a mechanical latching switch like the L068-A. A soft
latch — momentary tact, P-FET load switch, and a GPIO the firmware holds — is
smaller (3 x 2 mm against 8 x 8 x 8.4 mm), carries no load current through the
button, and gives firmware a shutdown it can see coming. That last point is the
real reason: `docs/board-stream.md` warns that **PSRAM is volatile and a
brown-out loses the window.** A long-press that lets firmware flush before the
rail drops turns an abrupt data loss into an orderly one. Charging still works
with the device switched off, because the switch sits between `SYS` and the
LDO, downstream of the charger rather than in the charge path.

**USB-C.** The S3 has native USB, so there is no CH340/CP2102 to buy —
flashing, serial and CDC all come off GPIO19/20. The two **5.1 kOhm CC
resistors** are not optional: without them a C-to-C cable delivers no power at
all, and they are the single most commonly forgotten part on a first USB-C
board.

Keep **both BOOT and RESET** as real buttons, reachable through the enclosure
(pinholes are enough). Native USB is the flashing path right up until a
firmware build breaks the USB CDC stack, and then the ROM download mode those
two buttons force is the only way back. Test pads alone mean opening the case
with tweezers every time that happens on a research device that gets reflashed
constantly.

Worth noting for later: the same native USB is a far better bulk path than BLE.
The handoff measured ~1.63 kB/s over BLE — 62 s to retrieve a 10 s capture, and
about six minutes for a 60 s one. USB CDC would move the same file in well
under a second. That is firmware work and it is already possible on the XIAO
today, but it is an argument for keeping USB a first-class port rather than a
charging socket.

## Size

The cell is a 502030: 30 x 20 x 5 mm. A board that matches its footprint and
sits on top of it is the natural target.

- Module on top: ~18 x 19.2 mm.
- Everything else on the bottom: USB-C on one short edge (~9 x 7.3 mm),
  charger, LDO, gauge, IMU, buttons and passives in the remaining area.
- **~21 x 33 mm, 4-layer**, double-sided assembly.

The power-path decision costs area as well as money — a VQFN-16 charger with
its `ISET`/`ILIM`/`TMR` resistors is roughly 50 mm2 against about 20 mm2 for
the SOT-23-5 alternative, and the gauge adds another ~15 mm2. The bottom side
still comes to around 300 mm2 of the ~690 mm2 available, so the outline holds.

Stacked volume is roughly 7.6 cm3 against something like 28 cm3 for the
current assembly — about a quarter. But be clear about what sets the floor: the
**cell (30 x 20 x 5 mm) and the JST-PH connector (~5.8 mm tall) are the two
tallest things in the device**, not the electronics. The module is 3.1 mm. No
amount of further layout work gets this much below ~10 mm while that cell and
that connector are in it. Soldering the battery leads to pads instead of using
a connector would save real height, at the cost of never being able to
disconnect the cell — which the battery-free bring-up sequence relies on. Keep
the connector.

## Assembly: what the vendor does, and what is left

This is the strongest argument for the custom board, ahead of both size and
cost.

**Today, per unit, by hand:** four jumper wires soldered between XIAO and
breakout (8 joints), a JST pigtail soldered to the XIAO's small rear BAT pads
right beside the USB connector (2 joints, the fiddliest in the build), optional
switch wired into the positive lead (2 more), then insulating and
strain-relieving every one of them. Roughly a dozen hand joints, several
awkward, and every one is a vibration-loosening failure point on a skateboard.

**With a custom board:** zero. You upload Gerbers, a BOM keyed to LCSC part
numbers, and a pick-and-place file; the vendor sources, places and reflows.
What arrives is a finished board. The remaining manual work is to clip on the
U.FL pigtail, plug in the battery, and screw it down — three actions, no iron.

Machine assembly is not a convenience here, it is **mandatory**. Three of the
ICs are leadless and cannot be hand-soldered reliably: `LSM6DSOXTR` (LGA-14),
`BQ24074` (VQFN-16 with a thermal pad) and `MAX17048` (TDFN-8). There is no
version of this board you finish yourself.

Two caveats that follow from that:

- **Vendor stock decides the design.** Anything not in the assembler's library
  has to be hand-placed or consigned, which defeats the point. Confirm the
  module, IMU, charger and gauge are stocked *before* drawing the schematic,
  not after.
- **This is a two-sided assembly** — module on top, everything else beneath —
  which costs a little more than a single-sided board because it is two reflow
  passes. Putting every part on one face would be cheaper and simpler, but the
  outline grows to roughly 28 x 40 mm because the battery footprint no longer
  bounds it. Given that size and hands-off assembly are the whole point, take
  the two-sided board; single-sided is the lever to pull only if assembly
  quoting comes back ugly.

Stacked with the cell that is roughly **21 x 33 x 10 mm**, against something
closer to 45 x 35 x 18 mm for two boards, a connector and a loom of jumpers.

Four layers is for the ground plane and the charger's return currents, not for
RF — the RF is sealed inside the module. Two layers would work and would shave
a little cost.

## Cost: the honest version

| | Dev-board stack | Custom, qty 5 | Custom, qty 50 |
| --- | ---: | ---: | ---: |
| Parts | ~$31 | ~$20/bd | ~$15/bd |
| PCB fab | — | ~$2/bd | ~$0.60/bd |
| Assembly setup + feeders | — | ~$8-12/bd | ~$1.50/bd |
| Shipping | included | ~$5/bd | ~$0.50/bd |
| **Per unit** | **~$31** | **~$35-39** | **~$17-19** |

Compare like with like. The dev-board column is XIAO ESP32S3 with antenna
(~$7.50), Adafruit LSM6DSOX breakout (~$11.95), cell (~$4), switch (~$0.50),
wire and pigtail (~$2) — and **a fuel-gauge breakout (~$5), because otherwise
it is not the same product.** Battery charge level is in the brief, and the
original XIAO cannot report it at all. Without that line the stack is ~$26, but
then it is missing a required feature.

So: **the custom board is not cheaper at quantity 1-5.** Turnkey assembly
charges a setup fee and a few dollars per unique feeder no matter how few boards
you order, and a first spin realistically needs a rev B, which puts the true
cost of the first *working* board nearer $70-90. The crossover is somewhere
around 20-50 units, after which it is a little over half the price of the dev
boards and a great deal smaller.

The power path and the fuel gauge together added about $4.20 a board against
the cheapest possible charger and a bare divider. That is the single largest
discretionary cost in the design, and it is deliberate: it buys a charger that
behaves correctly in the workflow this project actually uses, a temperature
interlock on a lithium cell in a sealed box, and the charge reading the brief
asks for.

The hypothesis that the dev boards waste money is right about the *content* and
wrong about the *price*: Seeed and Adafruit build at a volume a five-piece run
cannot approach, and that scale more than pays for the pads and connectors you
do not use.

**So build it for the size, the robustness and the features — not to save
money at prototype quantities.**

## What the custom board buys beyond size

1. **Rigid, repeatable mechanical coupling.** The handoff is blunt that "loose
   boards, jumper wires, and a hand-held sensor change the signal more than
   many pavement changes." Soldering the IMU to the same PCB that screws to the
   enclosure fixes the coupling *and* the sensor orientation by design rather
   than by assembly. This is the largest scientific win, not the smallest.
2. **Battery telemetry**, which the original XIAO cannot provide at all, and
   which is currently blocking any charge display in the app.
3. **IMU INT1/INT2 wired.** The breakout exposes them; the current four-wire
   hookup does not use them. On the custom board they enable FIFO-watermark
   interrupts instead of polling, wake-on-motion, and auto-sleep when the deck
   is parked — the main lever on the unmeasured ~5 h runtime.
4. **An orderly power-off** that can flush a volatile PSRAM window.
5. **Room for non-volatile storage.** A `W25Q128` (16 MB, SOIC-8, ~$1, ~5 x
   6 mm) on a spare SPI bus would address handoff decision 6 — persistent
   storage for long research rides — and survive the brown-out that currently
   loses the window. Fit the footprint now even if firmware uses it later.

## Risks and gotchas

- **5.1 kOhm on CC1 and CC2.** Two separate resistors, not one shared.
- **GPIO33-37 are consumed by the octal PSRAM** on `-N8R8` parts. Do not route
  to them.
- **Strapping pins** GPIO0, GPIO45 and GPIO46 need correct idle states; EN needs
  its 10 kOhm pull-up and 1 uF RC.
- **LSM6DSOX CS must be tied to VDDIO** to select I2C, and SDO/SA0 to GND for
  address 0x6A, matching `LSM6DSOX_ADDRESS` in the firmware.
- **LDO dropout at end of discharge.** A 3.3 V LDO from a cell at 3.4 V is
  marginal under BLE transmit peaks. The XIAO has the same limitation. A
  buck-boost would recover maybe 15% of runtime for more cost, size and noise —
  not worth it for rev A, but it is why the brown-out detector must be
  configured.
- **The LGA-14 IMU cannot be hand-soldered reliably.** It is leadless. This
  board needs machine assembly, which is what makes `C481766` at JLCPCB the
  enabling fact rather than a convenience.
- **Do not substitute the IMU.** `LSM6DSO`, `LSM6DSV` and `ISM330DHCX` are
  close relatives, but every capture in `hardware/analysis/` and the
  six-face calibration plan assume this part. A substitution silently breaks
  comparability with data already collected.
- **Keep the cell's existing protection PCB.** It is populated and confirmed;
  do not add a second protection IC in series without thinking about the
  interaction.
- **Thermal.** 100 mA into a sealed enclosure on hot asphalt, against the
  manual's 10-45 C charge window. Handled by the `BQ24074` `TS` pin — but only
  if the NTC is bonded against the cell. A thermistor left sitting on the PCB
  measures the charger, not the battery, and reports a comfortable number while
  the cell cooks.
- **Certification.** The module's modular approval only survives if its
  integration rules are followed — antenna type, trace layout and keep-outs.
  Irrelevant for personal use, decisive if this is ever sold.

## Decisions taken

- **USB-C is power in, plus data in and out.** Native USB on GPIO19/20 carries
  charging, flashing, serial and CDC with no bridge chip, and BOOT/RESET are
  the recovery path when a bad build breaks CDC. It is not a power *source* for
  other devices — that would need a boost converter and OTG role switching, and
  nothing in this product asks for it.
- **Power path, via `BQ24074`.** Reasoning in the charger note above.
- **Fuel gauge populated, gated divider rejected, ungated divider left as an
  unpopulated fallback.** Reasoning in the battery-reading note above.

## Still open

1. Target quantity. It does not change the design, only whether the design
   saves money or only saves space.

## Designing it: tools

**KiCad 10** (10.0.6 as of August 2026), free and open source. Reasons in the
order they matter here:

- JLCPCB's Gerber, BOM and pick-and-place exports come out of it cleanly, and
  the `kicad-jlcpcb-tools` plugin — installed from KiCad's built-in Plugin and
  Content Manager — assigns LCSC part numbers and checks stock from inside the
  schematic. That attacks the stock risk at the point where it is still cheap
  to fix. Confirm the plugin supports KiCad 10.x before depending on it; major
  versions routinely break plugins.
- `ESP32-S3-WROOM-1` ships as a standard KiCad symbol and footprint, which
  removes the most error-prone beginner task.
- `.kicad_sch` and `.kicad_pcb` are S-expression **text**. The design can live
  in this repo under git, be diffed between revisions, and be reviewed net by
  net by someone who is not sitting at the machine.

**EasyEDA** is the credible alternative — browser-based, built by LCSC/JLCPCB,
parts and ordering integrated, lower friction to start. It was not chosen
because the project would live in their cloud, outside git and outside review.

### Not four circuits designed from scratch

Every block has a published reference design to adapt rather than invent:

| Block | Reference to copy |
| --- | --- |
| `ESP32-S3-WROOM-1U` | Espressif hardware design guidelines + devkit schematics |
| `BQ24074` | TI datasheet typical application + EVM user guide |
| `MAX17048` | Analog datasheet + Adafruit's open-source breakout schematic |
| `LSM6DSOXTR` | ST datasheet + Adafruit's open-source breakout schematic |

Adafruit publish their hardware openly and use two of these exact chips.

### Expectations, honestly

This is a moderately hard first board: USB, a QFN with a thermal pad, a
fine-pitch LGA, a lithium charger and an RF module. Budget a few weekends
rather than an evening, and treat **rev B as expected rather than as failure**
— it is already priced into the cost table above.

Division of labour when resuming with an agent. It can do: the schematic
specification, passive value calculations, ERC/DRC review of committed
`.kicad_sch` and `.kicad_pcb` files, the layout *rules* (stackup, decoupling
placement, ground pour, charge-current trace width, thermal vias under the QFN
pad, antenna keep-out, USB pair handling), and the pre-order design review —
which is the single highest-value check available, because it is much cheaper
than a rev C. It cannot place and route: that is spatial work needing eyes on a
canvas.

## If it goes ahead

1. **Confirm live stock and price** for the module, IMU, charger and gauge at
   the assembler. Stock decides the design, not the other way round, and this
   is the cheapest thing to get wrong early.
2. **Write the schematic specification** — net by net, every pin, every passive
   with its value and reasoning, the `ISET`/`ILIM`/`TMR` calculations, the
   soft-latch topology drawn out, strapping-pin states, and the decoupling
   list. *This does not exist yet and is the next artifact.*
3. **Transcribe it into KiCad**, commit `.kicad_sch` to this repo, and have it
   reviewed against the gotchas above before any layout starts.
4. **Lay out and route**, then review `.kicad_pcb` the same way.
5. **Order 5 assembled**, plus a few bare boards as spares.
6. **Bring up with no cell fitted**, on USB alone — which the power path makes
   safe: 3.3 V rail, USB enumeration, flash the *unchanged* firmware, I2C scan
   for 0x6A, BLE advertise, `PSRAM=opi` capture at 1,666 Hz. Only then fit the
   cell, and check supervised charging and the gauge reading last. No lithium
   is connected to a board whose power rails have not already been proven.
7. **Re-run a known capture** and compare against
   `hardware/analysis/4199261890/` to prove the new board reads the same as the
   bench hardware. Until that matches, the custom board has not replaced
   anything.

## Resuming this work

Nothing has been built, ordered or drawn. The design exists only as this
document, and every choice in it is reversible. What is settled is the module
(PSRAM decides it), the charger (power path decides it), the gauge, the IMU
(it must not change), and the tool.

Suggested prompt when picking this up again:

> Read `hardware/custom-pcb-concept.md` and continue the custom PCB work from
> its current state. The parts and the reasoning are recorded; the next
> artifact is the net-by-net schematic specification.

## References

- [ESP32-S3-WROOM-1 / 1U datasheet](https://www.espressif.com/sites/default/files/documentation/esp32-s3-wroom-1_wroom-1u_datasheet_en.pdf)
- [ESP32-S3-MINI-1 / 1U datasheet](https://www.espressif.com/sites/default/files/documentation/esp32-s3-mini-1_mini-1u_datasheet_en.pdf)
- [LSM6DSOXTR at JLCPCB (`C481766`)](https://jlcpcb.com/partdetail/STMicroelectronics-LSM6DSOXTR/C481766)
- [LSM6DSOX datasheet](https://www.st.com/resource/en/datasheet/lsm6dsox.pdf)
- [BQ24074 power-path charger datasheet](https://www.ti.com/lit/ds/symlink/bq24074.pdf)
- [MAX17048 fuel gauge datasheet](https://www.analog.com/media/en/technical-documentation/data-sheets/MAX17048-MAX17049.pdf)
- [Seeed XIAO ESP32S3 battery and antenna guide](https://wiki.seeedstudio.com/xiao_esp32s3_getting_started/)
- [KiCad downloads](https://www.kicad.org/download/) and
  [KiCad 10.0.0 release notes](https://www.kicad.org/blog/2026/03/Version-10.0.0-Released/)
- [`kicad-jlcpcb-tools` plugin](https://github.com/Bouni/kicad-jlcpcb-tools)
- [Espressif ESP32-S3 hardware design guidelines](https://docs.espressif.com/projects/esp-hardware-design-guidelines/en/latest/esp32s3/)
