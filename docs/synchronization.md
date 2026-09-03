# Master/follower synchronization

## Semantic position

The reference point is 35% down the viewport. The master finds the script block
crossing that line and publishes its stable `data-prompt-id` plus a fraction
through the block. Each follower maps that semantic location into its own DOM
geometry. This permits different screen sizes, font sizes, and responsive
layouts without sharing raw pixels.

Published state includes `sequence`, `script`, `prompt`, `fraction`, `playing`,
`speed`, `interactionAgeMs`, and a diagnostic client timestamp. The server adds
`serverTime` when it accepts the write.

## Master ownership and publishing

The master claims a room using a random session ID. The server records the
owner in `<room>.master.json` and rejects a different owner for 10 seconds after
the current owner's last accepted activity. Explicit takeover replaces the
owner. Every normal update must match the recorded session or it receives HTTP
409.

Room state and ownership JSON live in the ignored, deployment-writable
`scripts/teleprompter_state/` directory. They persist on the server but are not
source-controlled.

Master authentication reads the `master` entry from the ignored
`scripts/passwords.php`. The file must be provisioned separately on every
server; `scripts/passwords.example.php` documents its shape without containing
a usable secret.

The browser schedules publishing every 250 ms, permits only one request in
flight, and aborts after two seconds. Unchanged semantic state is suppressed,
but the master writes a heartbeat at least every two seconds while healthy.

## Transport

`teleprompter_events.php` checks the room state and revision-signal files every
100 ms. It emits the whole master state when its JSON changes; the sequence
becomes the SSE event ID. It also emits named `cue-revision` and
`annotation-revision` events. The endpoint adds `deliveryServerTime` immediately
before state delivery, sends a named server heartbeat every five seconds, and
closes normally after five minutes. EventSource reconnects automatically and
supplies `Last-Event-ID`.

If SSE cannot connect or remains disconnected, the browser polls the sync GET
endpoint while leaving EventSource free to recover. Polling is 250 ms while
motion is recent, 2 seconds after 10 seconds without motion, and 60 seconds
after one hour. An SSE reconnection stops polling.

## Department data revisions

Successful cue and annotation mutations increment their document revision and
update separate maps in `scripts/teleprompter_state/`. SSE emits the full map as
`cue-revision` or `annotation-revision`. Only a client whose current script and
department match a newer entry refetches that document.

Cue refetches keep existing markers visible until the replacement document has
loaded and discard out-of-order responses after a script or department change.
Annotation clients additionally defer remote reloads while local offline
operations are pending.

## Freshness guarantee

Master state is usable for less than 10 seconds after its server write. This
matches the ownership lease and is comfortably above the normal two-second
master heartbeat.

Freshness is:

`deliveryServerTime - serverTime + monotonic time elapsed since receipt`

Both timestamps come from the same server clock. The follower's wall clock is
not part of the decision.

The browser rejects state when either server timestamp is missing/non-numeric
or when delivery age is already 10 seconds or greater. Rejected state cannot
select a script, change position, seed interpolation, update the master marker,
or become a Rejoin target. Accepted state is monitored as it ages; once it
reaches 10 seconds, animation stops and the target is forgotten. Rejoin with no
fresh target waits in place for the next fresh update.

A server-heartbeat event proves only that the SSE/server path works. It does not
make old master state fresh.

## Smoothing and discontinuities

Followers render approximately 1.25 seconds behind the newest timestamp. While
the master is playing, linear regression over recent samples produces stable
motion. When stopped, ordinary interpolation settles exactly at the confirmed
position.

A clear direction reversal resets incompatible history. Small corrections
against the established direction are held for at most three seconds. A single
unexpected leap from well inside a script to near its beginning requires a
second distinct packet within 1.8 seconds before acceptance.

## Pause and rejoin

Manual follower interaction disables live following and clears interpolation
history. Fresh incoming state is retained as a possible Rejoin target without
moving the local viewport. The paused styling and toolbar remain visible.
Rejoin is always explicit and uses only a still-fresh target.

## Compatibility rules

- Keep semantic prompt IDs stable within deployed scripts.
- Add protocol fields rather than repurposing existing ones.
- Server timestamps must remain seconds since the Unix epoch; the browser
  converts them to milliseconds.
- Preserve SSE event names: unnamed state messages, `server-heartbeat`,
  `cue-revision`, and `annotation-revision`.
- Test SSE and polling because either may deliver the same state sequence.
