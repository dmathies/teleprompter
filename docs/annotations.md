# Annotations

`js/main.js` coordinates live annotation input and synchronization. The
annotation drawing palette is encapsulated in the `<annotation-toolbar>` Web
Component (`js/components/annotation-toolbar.js` and
`js/components/annotation-toolbar.scss`), with its activation toggle hosted in
`<toolbar-sync>` (`js/components/toolbar-sync.js`). `js/annotation-store.js`
owns IndexedDB document caching and the offline operation queue;
`js/annotation-geometry.js` owns live coordinate conversion, scaling, SVG shape
construction, and layer cleanup. Screen styles are defined in
`css/teleprompter.scss` and `annotation-toolbar.scss`, and server persistence is
handled by `scripts/annotation_api.php`. Print annotation rendering remains
separately implemented in `js/pdf-export.js`.

## Data model

Annotation documents are stored in
`show-annotations/<script>_<department>.json` with this envelope:

```json
{
  "script": "show_id",
  "department": "LX",
  "revision": 1,
  "annotations": []
}
```

These JSON files are ignored deployment data. They persist on the server and
must be backed up, but must not be committed to the public repository.

Supported annotation types are `stroke`, `arrow`, `ellipse`, and `text`. Every
annotation has an ID, semantic prompt anchor, color, reference width, reference
font size, reference line height, and coordinate mode. Freehand strokes may
also preserve one pressure value per point.

X coordinates are normalized to the prompt area left after applying the
optional annotation margin: `0` is its left edge and `1` is its right edge.
Existing cue/script padding is not part of that calculation, preserving the
position of saved annotations when margins are disabled. Values below `0` or
above `1` are valid so strokes can occupy a configured left or right annotation
margin. In current line-coordinate mode, Y is expressed in originating line
heights and may extend outside the anchor block so a stroke can cross lines. Do
not clamp existing geometry to the visible block.

## Rendering and input

Annotations render as SVG layers attached to prompt blocks. Geometry and stroke
weight are recalculated for the current layout and font size. Remote revision
refreshes keep the current SVG layers visible until the replacement document is
available, avoiding a blank-frame flicker.

An unlocked department editor can enter explicit annotation mode for mouse,
touch, or pen input. A pen can also open the temporary palette and draw without
turning finger navigation into drawing. Device eraser ends and supported barrel
buttons select path erasing.

A gesture that starts in whitespace between semantic blocks is anchored to the
nearest visible prompt block. Its line-relative Y coordinate may begin above or
below that block, using the same representation already used when a stroke
crosses a block boundary. Toolbar, editor, header, and overview-rail areas are
excluded from this fallback.

Each department may centrally reserve a left or right blank margin. The margin
indents only script text; cues continue across the full prompt. Because
annotation X coordinates use the indented text area's origin and width,
changing the margin shifts existing annotations with the text. See
`settings.md` for the storage, authentication, and layout rules.

Department authentication uses the corresponding entry in the `departments`
map in the ignored `scripts/passwords.php`. It shares configuration storage
with the PRM credential but remains a separate authorization role.

Erasing samples a 10-pixel-wide path and deletes every annotation shape it
touches. The translucent canvas trail is only visual feedback and disappears
shortly after the stroke; it must remain non-interactive.

## Offline storage and synchronization

The browser's IndexedDB database `gaosTeleprompter` contains:

- `annotationDocs`: the latest local document cache keyed by script and
  department;
- `annotationOps`: ordered optimistic save/delete operations waiting for the
  server.

Local drawing updates the display immediately, writes the cached document, and
queues a mutation. The queue flushes after a short debounce and on the browser
`online` event when the department editor is authenticated. Failed operations
remain queued.

The server serializes each JSON-file mutation with `flock`, increments the
document revision, and updates
`scripts/teleprompter_state/annotation_revisions.json`. SSE broadcasts that map.
A client refetches a newer matching document only when it has no pending local
operations; otherwise it keeps its optimistic document and drains its queue.

## Print export

The browser print view re-renders persisted strokes, pressure-sensitive paths,
arrows, ellipses, and text using the print font and the selected department's
central margin. Export fetches the current server document directly; annotations
that exist only in IndexedDB or the offline mutation queue are not included
until they have synchronized successfully. See `export.md`.

## Script revisions and position review

New annotations retain a SHA-256 source revision and an anchor captured from
the pristine script fragment: block text, neighbouring text, speaker, act,
scene, index, and block structure. Original drawing coordinates and pressure
data remain unchanged. `get_script.php` returns the exact content hash in
`X-Script-Revision`; script revision and department document revision are
independent.

An authenticated save captures an immutable copy of that script under
`scripts/teleprompter_state/script_revisions/<script>/<hash>.html`. Snapshots
are ignored, excluded from build output, and covered by the existing direct
web-access prohibition for `teleprompter_state`. Hosting must preserve and back
up this directory along with annotation JSON. Read-only followers and export
never create snapshots. Existing snapshots can be read through the authenticated
annotation `snapshot` action, not through a direct file URL.

After replacing a deployed script, reload clients at a safe point. There is
no automatic live DOM replacement. Revisioned drawings from another source
revision are withheld from the overlay and counted in a review notice, even
when their old prompt IDs happen to exist. Older drawings without captured
context retain their existing behaviour until explicitly reviewed; their
original text cannot be inferred retrospectively.

An authenticated department editor opens **Review** in the annotation toolbar
(or the review notice). The comparison is initially read-only. Unchanged text,
speaker, HTML structure, and embedded styles may produce a suggested block.
Repeated lines, changed content/layout, and strokes extending beyond their
first line require explicit placement. Whole-script text and word similarity
provide manual suggestions for split, merged, or edited passages. Enter or
choose a target block ID to inspect its text, or leave the position blank to
retain an unresolved record. **Apply reviewed positions** commits the whole
department result under a lock, checks the expected document revision, retains
the previous annotations in private history, and announces the new revision
over the existing SSE mechanism. No other department is modified.

The last migration can be undone when there have been no subsequent mutations.
Otherwise rollback is refused to protect later drawings and deletions. Recovery
data can be downloaded from the review dialog. Restoring an old placement does
not make an old-revision drawing safe to display on a different current source;
it may need another explicit placement review.

Offline operations retain their source revision and mutation ID. Stale saves
remain queued with a conflict message, rather than overwriting migrated
anchors. Review offers pending drawings first and requires explicit confirmation
of pending deletions. A successful save updates the baseline of the next local
operation on that drawing; concurrent remote edits return a conflict. Recent
mutation IDs are retained for retry deduplication. Older clients cannot strip
revision metadata from an already revisioned drawing.

Print export checks the script hash against the department response and stops
if revisioned/unresolved drawings cannot be placed safely. Export without
annotations remains available. Word-following circles, geometric warping,
automatic cross-department publication, and a script-upload/staging workflow
are not part of this conservative first release. Existing external deployment
continues to control the active script file; placement changes require explicit
department-editor review.

## Change rules

- Preserve IDs and semantic anchors across schema migrations.
- Do not replace cached optimistic edits with an older server snapshot.
- Keep department authorization separate from master authorization.
- Test drawing, pressure, eraser path intersection, undo, offline reload,
  reconnect/flush, remote revision refresh, font resize, and narrow layouts.
- Treat production annotation files as private writable data, not public test
  fixtures.
