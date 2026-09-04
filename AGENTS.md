# AGENTS.md

## Project

This repository contains the GAOS web-based theatre teleprompter. It is used
during live performances, so reliability and backwards compatibility take
priority over architectural elegance.

The application is primarily used in Chrome and Safari on Windows laptops,
Android devices, and iPhones/iPads. The production instance is hosted at
`teleprompter.gaos.ch`; deployment and web-server routing are maintained
outside this repository.

Read the focused documentation before changing the corresponding area:

- `docs/architecture.md`
- `docs/synchronization.md`
- `docs/cues.md`
- `docs/annotations.md`
- `docs/script-format.md`
- `docs/settings.md`
- `docs/export.md`

## General working rules

- Inspect the existing implementation before changing behaviour.
- Prefer small, targeted changes over large rewrites.
- Do not refactor unrelated code while fixing a bug.
- Preserve existing behaviour unless the task explicitly requests a change.
- Do not remove apparently unused files or features without tracing them first.
- Avoid new frameworks or dependencies unless clearly justified.
- Keep deployment compatible with conventional PHP/web hosting.
- Assume the application may be in use during a live performance.

Before making a substantial change:

1. Identify the HTML, CSS, browser module, and server code responsible for the
   behaviour.
2. Explain briefly what is happening.
3. Make the smallest reasonable fix.
4. Test related master, follower, department-editor, and reconnect behaviour.

## Architecture and roles

`teleprompter_v2.html` is the browser DOM shell and loads `css/teleprompter.scss`
plus the ES-module entry point `js/main.js`. The UI controls and modals are
modular Lit Web Components in `js/components/` rendering into Light DOM, with
icons imported via `unplugin-icons` in `js/icons.js`. The entry point coordinates
these components and focused modules for DOM lookup, semantic positions,
sync-protocol helpers, cue text, annotation geometry, annotation IndexedDB
storage, and print/PDF export. Shared pure presentation helpers live in
`js/utils.js`. The frontend is built and served in development with Vite. PHP
endpoints provide a script catalog, filesystem persistence, master ownership,
polling, and server-sent events (SSE); there is no application database.

There are three relevant client roles:

- **Master (ASM):** controls playback, script selection, and the authoritative
  semantic position. Master control is password protected and leased to a
  browser-session identity.
- **Follower:** tracks fresh master state, may pause locally, and may later
  rejoin. Manual interaction must never silently resume following.
- **Department editor:** a follower opened with `?dept=FS`, `LX`, `SND`, or
  `STG`. A separate department login permits cue and annotation editing but
  does not grant master control.

The overview rail is the narrow position/marker display at the selected left
or right edge. Cues also have inline badges, trigger-word highlighting,
connectors, range markers, and exact-position end markers. Do not describe or
redesign the rail as a conventional sidebar without checking the current UI.

## Synchronization

The master publishes a semantic location: script ID, prompt ID, and fractional
position within that prompt. Followers map it into their own local layout; raw
pixel scroll offsets are not shared.

SSE is the primary follower transport. Adaptive HTTP polling is an automatic
fallback while SSE reconnects. SSE also carries server-heartbeat, cue-revision,
annotation-revision, and central department-settings events.

Master state is fresh for 10 seconds, matching the server-side master lease.
A follower must not change script or position from state that is already stale
when delivered. It must stop interpolating when accepted state becomes stale,
and Rejoin must wait for a fresh update rather than applying a cached target.
Freshness is calculated from server `serverTime` and `deliveryServerTime`.
Never treat local wall-clock receipt time as the time of the last master update.

Be particularly careful when modifying timestamps, master ownership, current
position, interpolation, backwards scrolling, pause/rejoin, reload, reconnect,
or the SSE/polling handover. Maintain compatibility between the browser and PHP
endpoints when changing the protocol.

## Scripts

Show scripts are trusted HTML fragments, not complete HTML documents. They are
loaded through the PHP catalog and inserted into `#content`. Each semantic
block needs a stable `data-prompt-id`; synchronization, cues, annotations, and
navigation depend on it.

Production script files may be copyrighted and are intentionally excluded from
the public Git repository. Do not add them. The tracked Pirates script is a
public-domain test fixture. See `docs/script-format.md` before editing markup.

## Cues

Persistent cue documents live in `show-cues/<script>_<department>.json`. Cue
revisions are announced over SSE so matching department followers reload them
without a page refresh. Preserve existing files or provide a migration when
changing the schema.

Cue start and optional end anchors contain a semantic prompt ID and fractional
position within the prompt. Word anchors additionally contain a word index and
display text. Missing legacy start fractions are treated as zero. See
`docs/cues.md` before changing cue storage, editing, or rendering.

## Annotations

Persistent annotation documents live in
`show-annotations/<script>_<department>.json`. The browser also uses IndexedDB
for cached documents and an offline mutation queue. Server revisions are
announced over SSE.

Annotations are anchored to semantic script content and must scale across font
sizes and devices. Pen input should remain distinct from finger/mouse
navigation where possible. Erasing is path-based; the temporary translucent
eraser trail is intentional. Annotation gestures may start in whitespace
between blocks by using the nearest visible semantic anchor. Remote refreshes
must not clear visible annotations while awaiting the replacement document.
See `docs/annotations.md` before changing this area.

## Print/PDF export

The PDF toolbar button builds a separate A4 print view in the browser. It may
include one department, all departments, or the script alone, with independent
cue, annotation, and stage-direction choices. Export reads the persisted server
documents; pending offline annotation operations are not part of the result.
See `docs/export.md` before changing pagination or print rendering.

## UI behaviour

- Make live controls difficult to activate accidentally.
- Clearly distinguish following, locally paused, waiting, stale, and master
  states.
- Keep a paused follower's controls visible until explicit rejoin.
- Avoid covering script text unnecessarily.
- Support touch, mouse, and stylus input where applicable.
- Modal dialogs must intercept pointer/stylus input even while annotation or
  cue-word-selection mode is active; interaction must not reach script gestures.
- Preserve semantic script position across font-size and responsive reflow.
- Browser display preferences are opened from the gear button. Rail side is a
  browser-local preference. Annotation margin side and width are central,
  revisioned values keyed by department; changing them requires that
  department's editor login. See `docs/settings.md` before adding settings.
- Annotation margins indent script text, not cue graphics. Existing annotations
  move with the text-area coordinate origin when a margin changes.

## Performance and reliability

- Avoid unnecessary high-frequency polling or DOM updates.
- Do not assume a reliable network.
- Expect planned SSE recycling and automatic EventSource reconnects.
- A reconnect or reload must not apply stored stale state or reset a follower
  to the start of a script.
- Avoid races between initial script loading, SSE, local UI initialization,
  master updates, and offline annotation replay.

## Testing

After changing synchronization, test at minimum:

1. One master with one follower, then several followers.
2. Forward scrolling, backwards scrolling, stopping, and explicit jumps.
3. Follower pause, continued master movement, and rejoin.
4. Follower and master page reloads.
5. Temporary SSE loss, polling fallback, SSE recovery, and planned SSE recycle.
6. Initial connection with a state older than 10 seconds: no script or position
   change until a fresh master update arrives.
7. Accepted state becoming older than 10 seconds: interpolation stops.
8. Rejoin with only stale cached state: no jump.
9. Font-size changes on both master and follower.
10. Department cue/annotation display, offline annotation queueing, and revision
    refresh after reconnect.
11. Print export with script-only, one-department, and all-department
    selections; verify source page breaks, long-page overflow, cues, annotation
    margins, and browser print preview.

For UI changes, also check desktop, phone, and tablet layouts. The repository
currently provides manual SSE and pen diagnostics, not an automated browser
test suite; state clearly which scenarios were actually exercised.

## Secrets, runtime data, and Git

- Never add passwords or other credentials to tracked source files.
- Master and department secrets belong in the ignored
  `scripts/passwords.php`, using `scripts/passwords.example.php` as the schema.
  Production must provision the real file separately from Git deployment.
- Do not add copyrighted production scripts to the public repository.
- Treat `scripts/teleprompter_state/`, `show-cues/`, and `show-annotations/` as
  ignored writable deployment data, not source. Their `.gitkeep` files preserve
  directory structure. Use sanitized fixtures elsewhere if tests need examples.
- Previously committed runtime data remains in Git history even after being
  untracked. Do not rewrite history without explicit authorization and a
  coordinated deployment plan.
- Previously committed credentials remain exposed in Git history. Never restore
  `scripts/cue_passwords.php` or hard-code a master password in an endpoint;
  rotate disclosed values before production use.
- Keep commits focused. Do not rewrite Git history unless explicitly asked.
- Do not commit temporary diagnostics or generated operational data.

## When uncertain

Do not guess about existing behaviour. Search the repository and trace the
relevant browser, endpoint, and persisted-data paths first. If an apparent bug
may be intentional show-time behaviour, explain the finding before replacing
it.
