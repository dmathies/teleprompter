# Annotations

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

X coordinates are normalized to prompt width. In current line-coordinate mode,
Y is expressed in originating line heights and may extend outside the anchor
block so a stroke can cross lines. Do not clamp existing geometry to the visible
block.

## Rendering and input

Annotations render as SVG layers attached to prompt blocks. Geometry and stroke
weight are recalculated for the current layout and font size.

An unlocked department editor can enter explicit annotation mode for mouse,
touch, or pen input. A pen can also open the temporary palette and draw without
turning finger navigation into drawing. Device eraser ends and supported barrel
buttons select path erasing.

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

## Change rules

- Preserve IDs and semantic anchors across schema migrations.
- Do not replace cached optimistic edits with an older server snapshot.
- Keep department authorization separate from master authorization.
- Test drawing, pressure, eraser path intersection, undo, offline reload,
  reconnect/flush, remote revision refresh, font resize, and narrow layouts.
- Treat production annotation files as private writable data, not public test
  fixtures.
