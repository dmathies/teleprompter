# Show script format

## Delivery and copyright

Show scripts are trusted HTML fragments stored in `show-scripts/`. They are
allow-listed by `scripts/script_catalog.php`, returned by `get_script.php`, and
inserted into the teleprompter's `#content` element.

Copyrighted production scripts are deployed separately and must not be added to
the public repository. The repository intentionally tracks only the
public-domain Pirates test fragment. A catalog entry whose file is absent is
omitted by `list_scripts.php`.

This mirrors the runtime-data policy: deployment-owned content remains on disk
across releases without becoming public repository content.

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

Useful semantic metadata includes:

- `data-page`: source page label;
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
- Test with stage directions both hidden and shown, multiple font sizes, and
  desktop/phone/tablet widths.
