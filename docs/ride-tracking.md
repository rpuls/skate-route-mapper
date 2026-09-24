# Ride Tracking

How a stream of GPS fixes becomes a ride's distance, moving time and speed, and
why each rule exists.

Source of truth: `shared/src/rideTracking.ts`.

Tests:

- `backend/test/contracts/rideTracking.contract.test.ts` — the filter and the
  accumulator.
- `backend/test/contracts/rideMetrics.contract.test.ts` — what the backend
  stores on a finished ride.
- `mobile/test/contracts/rideRecording.contract.test.ts` — how the phone turns
  fixes into sample rows, batches them, and orders their upload.

This is deliberately one shared module rather than one implementation per
platform. The phone computes these figures live while recording, the backend
recomputes them from the samples it received when a ride finishes, and the two
have to agree. It is pure — no clock, no storage, no platform API — so it can
be tested directly, which matters because every rule here is a judgement call
that will look wrong in some situation.

Not covered here: pavement roughness. That is the board's job and lives in
`docs/vibration-roughness-plan.md`.

## Where it came from

The only place in the project that rejected bad GPS fixes was
`shouldAcceptLocation()` in
`mobile/modules/background-recorder/.../BackgroundRecorderService.kt`, the
Android foreground service. Moving recording onto `expo-location` would have
thrown that logic away, and iOS never had it at all. It was ported here
instead, so both platforms and the server use the same rules.

## Deciding whether to keep a fix

`evaluateLocationFix(previous, fix)` returns either `accepted` or a named
reason. Named reasons are not decoration: the recording screen tells a rider
*why* the route stopped growing, and "waiting for a more precise fix" is a very
different situation from "recording has stopped".

Ported unchanged from the Kotlin service:

| Reason | Rule |
| --- | --- |
| `out-of-range` | Coordinates or timestamp are not real numbers, or are off the globe. |
| `missing-accuracy` | The platform could not say how good the fix is. |
| `poor-accuracy` | Accuracy is worse than 50 m. |
| `provider-downgrade` | A satellite fix followed by a markedly worse non-satellite one. This is what stops wifi and cell-tower fixes from dragging a route sideways. |
| `implied-teleport` | The jump since the last fix is impossible **and** the fix is imprecise. |

The two halves of `implied-teleport` both matter. The speed bound is 666 m/s: a
teleport guard, not a skating speed limit. On its own it would discard genuine
fast fixes, so it only fires when the fix is also vaguer than 10 m.

Added here:

| Reason | Rule |
| --- | --- |
| `accuracy-downgrade` | Accuracy collapses from satellite grade to much worse, within 30 seconds of the good fix. |
| `out-of-order` | The fix is older than the one already kept. |

`accuracy-downgrade` exists because the provider rule cannot fire any more.
iOS does not expose which sensor produced a fix, and `expo-location` does not
surface it on Android either, so `provider` is almost always unknown. The same
intent — "do not believe a fix that is suddenly far worse than the one we just
had" — is applied to accuracy alone. The 30-second window is the safety valve:
past it the filter stops being picky, so a rider skating into a built-up area
where accuracy genuinely degrades still gets a route.

`out-of-order` exists because background location arrives in batches. A late
straggler would otherwise walk the route backwards.

## Is the rider moving?

Almost everything else turns on this, so it is worth stating once.

A platform-reported speed is Doppler-derived and reads near zero when standing
still, which makes it the most direct evidence available. Where it exists it
decides. Where it does not, position noise has to be ruled out instead, which
is what the anchor below is for.

```
stationary    = reported speed exists and is below 0.5 m/s
trustedMoving = reported speed exists and is at or above 0.5 m/s
```

## Turning fixes into distance

The naive version — add the distance between each pair of fixes — is the reason
trackers log kilometres while their owner drinks coffee. GPS noise never stops,
and summing noise always grows.

Distance is measured from an **anchor** instead of from the previous fix. The
anchor only moves once the rider has demonstrably covered ground:

```
threshold = trustedMoving
            ? 2 m
            : max(2 m, 1.0 x the worse of the two fixes' accuracy)
```

- Below the threshold, the anchor stays put and nothing is banked.
- Above it, the whole anchor-to-fix distance is banked and the anchor moves.

The threshold has two settings because the two situations are different. When
the platform confirms the rider is moving, noise is not the risk, so only the
small floor applies and the anchor advances on nearly every fix — which keeps
the route faithful around corners, since a banked segment is a straight line
between anchor and fix. With no reported speed there is nothing but the
positions to go on, so movement smaller than the position uncertainty is not
believed at all.

Slow riders are still counted either way. At 1.5 m/s the anchor simply holds
for a few fixes and then banks the whole stretch at once.

Three things stop distance being banked:

- **`stationary`.** The anchor stays where the rider stopped, so their drift
  never accumulates, and the real displacement is measured from that resting
  point once they set off again.
- **A gap over 30 seconds.** The route was lost; drawing a straight line across
  the hole would invent distance that was never skated. The anchor restarts.
- **An implied speed over 35 m/s.** Not a skate, whatever the fix claims.

## Moving time

Moving time is credited on the same evidence as distance. Seconds accumulate
since the anchor last moved, and are counted only when the anchor actually
advances at a speed above 0.5 m/s. Seconds spent jittering are discarded.

A per-interval test would not work. A phone standing still with an 8 m fix
produces consecutive positions several metres apart, which looks exactly like
slow skating — the test for that case is in the contract test file.

Two caps bound the damage when the evidence is weak:

- A single interval never credits more than 10 seconds, so one delayed delivery
  cannot claim minutes of skating.
- The seconds waiting to be banked never exceed 30. Without that, a ten minute
  coffee stop with no reported speed would be credited in full the moment the
  rider set off again.

While `stationary`, no seconds accumulate at all.

## Speed

A reported speed is trusted directly. Where the platform reports none, speed is
derived from the anchor stretch rather than from consecutive fixes, because
consecutive-fix speed is dominated by position noise.

Top speed ignores anything above 35 m/s. If the platform reported a speed, a
derived one is never quietly substituted for it.

Average speed is distance over *moving* time, which is what a tracker means by
"average speed". `summarizeRideProgress` also returns `elapsedSeconds`, taken
from the ride's own start and end when the caller knows them, because a ride's
wall-clock length includes the stretch before the first fix arrived.

## Surviving a restart

`RideProgress` is plain JSON and is stored on the ride row on the phone. The OS
can kill a backgrounded app and restart it for the next location update, so the
accumulator is reloaded rather than remembered. `parseRideProgress` turns
anything unrecognisable into a fresh ride rather than throwing: losing a
recording in progress to a parse error would be far worse than losing its
history.

## Recomputing on the server

When a ride finishes, the backend folds the same module over the GPS samples it
holds and stores the result on the ride. The phone's own figures are sent with
the finish operation but only used when the server has no position data for the
ride at all.

This is deliberate. The stored distance always matches the stored route, a
client cannot report a distance its samples do not support, and changing the
algorithm later means re-running it over data that is already there.

`POST /v1/admin/rides/:rideId/recompute-metrics` re-runs the same code over a
ride that is already stored, which is how rides recorded before ride tracking
existed get figures, and how a tuning change reaches data already collected.
The admin ride view has a "Recompute route" button for it.

`locationFixesFromSamples` skips samples with no position and collapses
repeated `locationTimestamp` values, because a XIAO ride writes vibration
samples far faster than GPS updates and every one of them carries a copy of the
last known fix. Counting those as fresh fixes would multiply a ride's distance.

## Tuning

Every threshold is a field on `rideTrackingDefaults` and can be overridden per
call. The defaults assume skating: a few m/s, fixes every couple of seconds.
The first four come from the Kotlin service and are deliberately unchanged, so
Android keeps behaving the way it already did.

None of them have been validated against a measured outdoor route yet. The
first labelled field session should check distance against a known course
before these numbers are treated as settled.
