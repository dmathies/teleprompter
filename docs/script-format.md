# Show script format

## Delivery and copyright

Show scripts are trusted HTML fragments stored in `show-scripts/`. They are
allow-listed by `scripts/script_catalog.php`, returned by `get_script.php`, and
inserted into the teleprompter's `#content` element.

Live fragment loading and decoration are coordinated in `js/main.js`.
`js/semantic-position.js` maps stable prompt IDs and fractions to live DOM
geometry, and `js/cue-text.js` enumerates the text used for cue word anchors.
`js/pdf-export.js` fetches and decorates a fresh copy for print. Shared screen
styles for recognized script structures live in `css/teleprompter.scss`; the
export module maintains its own print stylesheet.

Copyrighted production scripts are deployed separately and must not be added to
the public repository. The repository intentionally tracks only the
public-domain Pirates test fragment. A catalog entry whose file is absent is
omitted by `list_scripts.php`.

This mirrors the runtime-data policy: deployment-owned content remains on disk
across releases without becoming public repository content.

## Browser script editor

In PRM master mode, **Edit script** opens a separate text editor at the current
block and stops playback. Search by text or source page, correct the block's
text fields, or insert a paragraph, dialogue, lyrics, stage direction, or heading
before/after it. New lyrics retain line breaks. Existing inline markup and paired
lyrics columns are preserved; complex blocks expose separate text fields.
Dialogue blocks can be changed to lyrics and vice versa. The type conversion
preserves the block's prompt ID, metadata, and inline text markup; review cues
and annotations on changed text after saving.
A dialogue or lyrics block with no character/singer shows an input to add one.
Existing blocks can be marked for deletion and restored until Save; deleted
blocks leave their cues and annotations orphaned, so review them afterwards. The
server recovery copy keeps the deleted text.
There is no raw HTML editing or moving of existing blocks. Unsaved new
blocks can be removed, and Cancel asks before discarding a changed draft.

Save writes the catalog's script file through `scripts/script_editor_api.php`.
It requires PRM authentication; a department login does not grant access. The
server accepts structured text operations, escapes inserted text, retains every
existing prompt ID, and allocates IDs above the current maximum for new blocks.
New blocks inherit their neighbouring block's page, act, and scene context.
Simultaneous edits use a content-hash check: a stale draft cannot overwrite a
newer save. Failed saves retain the draft; drafts are not stored offline.

Before replacing the script atomically, the server keeps immutable copies of
both revisions under the private `scripts/teleprompter_state/script_revisions/`
directory. These provide an administrative recovery copy, not an in-app Undo.
The script file and its parent directory must be writable by PHP, and PHP's DOM
extension must be enabled. Deployment must preserve edited production scripts
and private backups.

The saving browser reloads at its semantic position. Other open followers receive
a **Script updated — Load changes** notice over SSE or polling, including after
reconnect. They load changes explicitly, preserve their semantic position, and
remain locally paused until Rejoin. Distribute changes to all devices before
resuming playback into new material. Print export reads the saved version.

IDs preserve block identity, not word identity or drawing geometry. Review word
cues and fractional anchors in edited text. Annotations use the existing
revision-review workflow; script editing never rewrites department documents or
pending offline annotation operations. Before editing legacy scripts with
annotations, capture the baseline with the department's Review action.

## Semantic blocks

Every positionable block must have a unique, stable prompt ID:

```html
<div class="cue" data-prompt-id="p000123" data-page="12" data-act="Act I">
  <span class="character">NAME:</span>
  <span class="dialog">Text</span>
</div>
```

Prompt IDs currently use `p` followed by six digits. Never renumber existing
IDs merely because content is inserted or reformatted: saved master positions,
cues, and annotations all refer to them.

New annotations record a script-content hash and surrounding block text.
Authenticated saves (and authenticated editor loads) capture private source
snapshots for future review. Before revising a production script with legacy
annotations, use the annotation toolbar's Review action to confirm their
current positions and capture a baseline. Earlier source text cannot be
recovered if it was overwritten before being captured. See
`annotations.md#script-revisions-and-position-review` for migration limits.

Useful semantic metadata includes:

- `data-page`: source page label; print export starts a new A4 sheet when this
  value changes and repeats it in the footer;
- `data-act`: act label;
- `data-scene`: optional scene context.

## Recognized structures

- `.cue` with `.character` and `.dialog` for dialogue.
- `.act-heading` for act transitions.
- `.scene-heading` for scene navigation.
- `.lyrics-block`, `.lyrics-speaker`, and `.lyrics` for songs.
- `.song-heading` for song navigation.
- `.stage-direction` for block directions and `.stage-inline` for inline
  directions.
- `.two-column-lyrics` with `.lyrics-column` children for paired material.

Stage directions are hidden by default and become visible below an ancestor
with `.show-stage-directions`. Two-column material must collapse to one column
on narrow screens; current fragments use a 700-pixel breakpoint.

## Fragment constraints

- Do not include `<html>`, `<head>`, or `<body>` wrappers.
- A fragment may contain scoped script-specific `<style>` rules, but selectors
  must not interfere with the fixed toolbar or other application UI.
- Treat fragment content as trusted: it is inserted with `innerHTML`, not
  sanitized at runtime.
- Keep markup valid and avoid duplicate prompt IDs.
- Ensure every visible semantic section, including headings, lyrics, and stage
  directions, has an anchor if master/follower positioning may land there.
- Keep every block that must appear in print/PDF export as a direct child of the
  fragment; export copies only top-level `data-prompt-id` elements.
- Give every exported block a `data-page` value when reliable source-page
  grouping and footer labels are required.
- Do not rely on fragment `<style>` rules for print appearance. Export uses its
  own fixed stylesheet and understands the recognized structures listed above.
- Test with stage directions both hidden and shown, multiple font sizes, and
  desktop/phone/tablet widths.

## Song paragraph positions

Each verse/chorus and singer change should start a separate top-level semantic
block. For simultaneous paired singing, use one top-level `.two-column-lyrics`
block per corresponding verse/chorus pair, with two `.lyrics-column` children.
Keep an empty partner column when only one singer continues. Do not add nested
prompt IDs inside the columns: synchronization and print rely on top-level
semantic blocks. A word cue can still target either singer within the pair.

For an existing deployed fragment, the offline converter can preview the split:

```sh
php dev_scripts/split-song-paragraphs.php --script=hansel_gretel
```

It recognizes blank-line stanza separators, explicit lyric paragraphs, and
repeated `.lyrics-speaker` headings. It preserves each original ID on the first
section and allocates later IDs above the script's current maximum. It does not
guess unmarked musical sections or split ordinary dialogue. Running it again
leaves converted content unchanged.

Add `--write` to apply the conversion to an **offline working copy**. The tool
retains original HTML, affected cue/annotation JSON, and the ID mapping beneath
the private `scripts/teleprompter_state/script_revisions/` directory. Word cues
are remapped by their original text-node tokens and checked against their stored
trigger text. Existing block-start paragraph cues stay at the section start.
Interior fractional end anchors require explicit placement before conversion;
the tool refuses to guess. Annotations on split blocks are retained unresolved
for the department's Review workflow.

Deploy the converted fragment and any remapped department data together outside
an active performance, then reload all clients. Do not commit production script
content, live department data, or conversion backups to Git.
