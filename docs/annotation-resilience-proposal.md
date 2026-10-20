# Resilient annotation anchors: implementation proposal

Status: the conservative first release is implemented; see
`annotations.md#script-revisions-and-position-review` for its workflow and
limits. The broader publication and word-range work below remains a roadmap.
Annotations follow the latest
published script revision; historical content and annotation states remain
available for recovery. Publishing a new revision must be an explicit operation,
not a side effect of opening a follower or exporting a PDF.

## Existing behaviour and constraints

- `js/annotations-controller.js` creates drawings with a `prompt`, reference
  font and line height, and line-relative coordinates. Rendering looks up that
  prompt ID and silently skips drawings when the block is missing.
- `js/annotation-geometry.js` maps X into the available text area and Y into
  line heights (or block height for legacy drawings). It does not associate a
  circle, arrow, or stroke with the underlying words. Drawings can extend into
  margins or across several blocks despite having one prompt anchor.
- `scripts/annotation_api.php` validates a fixed set of annotation fields.
  Unknown anchor metadata would currently be discarded on save; document
  normalization also discards unknown document-level fields.
- `js/annotation-store.js` caches documents by script and department and queues
  save/delete operations without a script revision. Replay currently replaces
  an annotation with the supplied version, so an old queued save could undo a
  migration unless revision handling changes.
- `js/main.js` fetches the current fragment through `scripts/get_script.php`.
  There is no import/publish operation or historical script store. Changes to a
  deployed file are not automatically loaded into already open browsers.
- `js/pdf-export.js` independently fetches the script and department documents,
  then renders using prompt IDs and its own coordinate conversion.
- Prompt IDs also anchor cues and master/follower positions. Annotation
  migration cannot make arbitrary ID renumbering safe for those other systems.
  Preserve existing IDs during script editing wherever possible.

## Recommended scope

Use complementary ID, text, context, and revision anchors. This follows the
principle of the W3C TextQuoteSelector (`exact`, `prefix`, `suffix`) and
TextPositionSelector, without requiring adoption of the full annotation model:
https://www.w3.org/TR/annotation-model/#selectors

The first release should recover unchanged blocks that move or receive new
IDs. Preserve drawing coordinates exactly. Changed block contents, splits,
merges, missing originals, and ambiguous matches require review unless their
geometry can independently be shown to remain valid. A text match identifies
the passage; it does not prove where existing handwriting belongs within it.

Do not promise word-following until text-range geometry is implemented.
Freehand input has no selected text today, so recording an inferred word as
though the user selected it would create false confidence. Initially capture
the entire block text plus neighbours and structural metadata. Capture precise
text ranges later when selection or reliable hit-testing provides them.

## Data and versioning

Keep script revision separate from annotation document revision. The former
identifies source content; the latter orders department mutations and SSE
notifications. Add a schema version rather than repurposing either value.

Store immutable script snapshots, keyed by script ID and a server-computed
SHA-256 of the exact fragment bytes. Keep both original HTML and a versioned
text index containing ordered prompt IDs, block text, speaker, act, scene,
and offsets into the whole-script text stream. Derive the index from the raw
fragment before cue badges, annotations, visibility settings, or responsive
layout decorate it. Retain hidden stage directions and lyrics. Define
whitespace, Unicode, separators, nested blocks, and two-column reading order
explicitly; retain an offset map from matching text to original text nodes.

Suggested additive annotation metadata:

```json
{
  "sourceRevision": "sha256:...",
  "anchorVersion": 1,
  "anchor": {
    "prompt": "p000482",
    "blockText": "GRETEL: We must leave tomorrow before the witch returns.",
    "previousText": "...",
    "nextText": "...",
    "speaker": "GRETEL",
    "act": "Act I",
    "scene": "Scene 3",
    "blockIndex": 482
  }
}
```

Existing `prompt`, points, pressure data, coordinate modes, IDs, and drawing
styles remain intact. Keep the original record in immutable migration history;
record each resolved placement with target revision, status, matching reason,
and algorithm version. Original index/distance only ranks candidates; it is
never sufficient evidence for automatic placement.

Snapshots and history are private ignored deployment data, outside public
source control and protected from direct web access. Define hosting protection,
backups, deployment persistence, and retention before enabling snapshots.
Copyrighted HTML and quoted dialogue must never become tracked fixtures.

Existing annotations cannot recover text from a revision that was never
captured. Bootstrap them against a confirmed current baseline only when their
anchors are still correct. Otherwise request the old script or manual review;
never silently declare today's text to be their original context.

## Matching and drawing placement

Implement a deterministic pure `js/annotation-migration.js` accepting old/new
script indexes and annotations, returning a dry-run plan without DOM, network,
or storage side effects. A separate browser adapter builds indexes and handles
preview geometry. Keep its normalization version explicit.

1. Validate unique prompt IDs and snapshot integrity.
2. Match stable IDs, but verify text/context too: an ID may have been reused.
3. Match unchanged blocks uniquely using text, speaker, neighbours, and scene.
4. Align the whole-script token stream between confirmed matches. This can
   identify split/merge candidates and insertions without assuming one-to-one
   paragraph correspondence. Use bounded diff work and deterministic limits;
   a global diff alone is insufficient for moved passages or repeated lyrics.
5. Search remaining passages for moved exact matches, then fuzzy candidates.
   Treat act/scene/speaker as evidence rather than absolute restrictions because
   passages and headings can move. Require a clear margin over the next best
   candidate; fuzzy scores are not probabilities.
6. Classify each result as unchanged, automatically relocatable, needs review,
   or unmatched. Preserve every input, including unmatched annotations.

Automatic relocation in the first release requires an unchanged equivalent
block structure and content plus unambiguous identity. If a stroke spills into
neighbouring blocks, require the relevant surrounding structure to remain
equivalent too; otherwise request review. Text-equivalent HTML/style changes
can alter geometry and must not be assumed safe merely because text matches.

Repeated songs, short lines such as "Yes", swapped speakers, and deleted
passages must not resolve solely by proximity. Show the reason and candidate
alternatives in preview. Uncertain drawings stay recoverable but are excluded
from the active overlay and print output, with a visible unresolved count and
an explicit warning before exporting incomplete annotations.

Later, text-range anchoring can translate a single-line circle with its matched
word using DOM Range rectangles. Support the same placement logic in print.
Multi-line handwriting, arrows connecting different passages, and changed
wrapping require separate treatment; do not warp arbitrary handwriting or
discard its original points to make it fit.

## Publication, authorization, and concurrency

Provide an authenticated revision staging and publication operation. Adapt the
existing external file-deployment workflow to stage candidate content first;
replacing the active file before capturing the old version loses information.
Migration must not begin independently in every browser or on a public GET.

The browser computes a dry-run proposal from authoritative snapshots. PHP
validates bounds, source/target snapshot identity, department authorization,
and expected annotation document revision under a lock before accepting it.
For automatic migration, use a trusted administrative publisher running the
same pure matching module; department editors may commit their own migration
plans. A department login must never grant writes to other departments. Define
the publication authority before implementation; do not reuse show access as
an administrative credential.

Retain immutable source annotation states and migration plans. Publish a
versioned manifest only after target snapshots and per-department migration
results are durable, so a partial failure cannot mix active versions. Recheck
source document revisions at publication or recompute affected plans. Readers
must request a matching script/document revision and retry on a mismatch.
Rollback creates a new document revision with restored placements and an audit
record; it must not erase subsequent drawings or resurrect later deletions.

Tag cached documents and queued operations with source script revision and
base annotation version. On reconnect, rebase an old save using retained
snapshots or return a structured conflict for review. Never acknowledge and
remove an unresolved operation. Detect concurrent edits to the same annotation;
deletes continue to address stable annotation IDs. Legacy clients without
revision metadata must receive a reload/conflict response when unsafe, rather
than silently stripping metadata or overwriting migrated records.

Continue department annotation SSE revision notifications after publication.
Add script revision detection, but do not hot-swap a running performance's DOM
or reset playback on a revision event. Coordinate script activation and client
reload at an explicit safe point, preserving existing freshness and rejoin
rules. A client still showing an old snapshot must not display new-revision
placements on it. Export remains read-only and checks revision consistency.

## Delivery sequence and verification

1. Add backward-compatible metadata validation, baseline capture, private
   immutable snapshots, and revision-aware offline operations. No automatic
   relocation yet.
2. Add the pure dry-run matcher and a comparison/recovery interface. Test on
   sanitized script pairs; no production mutation during this phase.
3. Enable conservative automatic block relocation with validated publication,
   conflict detection, history, and rollback. The minimal unresolved/review UI
   belongs in this release, not after fuzzy matching is enabled.
4. Add word-range attachment and geometry translation as a separate feature.

Automate fixtures for inserted/reordered/renumbered blocks, ID reuse, repeated
lyrics, punctuation/whitespace edits, split/merged blocks, missing scenes,
deleted targets, Unicode text, legacy records, cross-block strokes, unchanged
HTML versus changed layout, concurrent edits, stale offline saves, and retry
idempotency. Verify byte-preserved points/pressure data and no lost unmatched
records. Test failed publication and rollback after later edits/deletes.

Manually exercise Chrome/Safari desktop, phone/tablet reflow, margins, drawing,
eraser/undo, cached offline reload, reconnect, remote revision refresh, print
with one/all departments, and master/follower pause/rejoin across explicit
script activation. Unit tests cannot establish visual placement accuracy.
