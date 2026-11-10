<?php
// Structured text edits only: callers cannot supply markup or change existing IDs.
function editorParse(string $html): array {
    if (!class_exists('DOMDocument')) throw new RuntimeException('Script editing requires the PHP DOM extension');
    $doc = new DOMDocument('1.0', 'UTF-8');
    $previous = libxml_use_internal_errors(true);
    try {
        $ok = $doc->loadHTML('<!doctype html><html><head><meta charset="UTF-8"></head><body><div id="tp-editor-source">' . $html . '</div></body></html>', LIBXML_NONET);
    } finally { libxml_clear_errors(); libxml_use_internal_errors($previous); }
    $root = $doc->getElementById('tp-editor-source');
    if (!$ok || !$root) throw new RuntimeException('Could not parse script');
    $blocks = []; $maximum = 0;
    foreach ((new DOMXPath($doc))->query('.//*[@data-prompt-id]', $root) as $block) {
        $id = $block->getAttribute('data-prompt-id');
        if (!preg_match('/^p[0-9]{6}$/', $id) || isset($blocks[$id]) || $block->parentNode !== $root) {
            throw new RuntimeException('Editing requires unique top-level prompt IDs');
        }
        $blocks[$id] = $block;
        $maximum = max($maximum, (int)substr($id, 1));
    }
    if (!$blocks) throw new RuntimeException('No editable script blocks');
    return [$doc, $root, $blocks, $maximum];
}

function editorText(DOMNode $node): string {
    if ($node instanceof DOMText) return $node->nodeValue;
    if (strtolower($node->nodeName) === 'br') return "\n";
    $text = '';
    foreach ($node->childNodes as $child) $text .= editorText($child);
    return $text;
}

function editorFields(DOMNode $node, string $path = ''): array {
    if ($node instanceof DOMText) {
        return trim($node->nodeValue) === '' ? [] : [['key' => $path, 'label' => 'Text', 'value' => $node->nodeValue]];
    }
    if (!$node instanceof DOMElement || in_array(strtolower($node->tagName), ['style', 'script', 'br'], true)) return [];
    $simple = true;
    foreach ($node->childNodes as $child) {
        if (!$child instanceof DOMText && !($child instanceof DOMElement && strtolower($child->tagName) === 'br')) $simple = false;
    }
    if ($simple) {
        $class = $node->getAttribute('class');
        $label = 'Text';
        foreach (['character' => 'Character / heading', 'dialog' => 'Dialogue', 'lyrics-speaker' => 'Singer / heading', 'lyrics' => 'Lyrics', 'stage-direction' => 'Stage direction'] as $token => $name) {
            if (in_array($token, preg_split('/\s+/', $class), true)) { $label = $name; break; }
        }
        return [['key' => $path, 'label' => $label, 'value' => editorText($node)]];
    }
    $fields = [];
    foreach ($node->childNodes as $i => $child) {
        $fields = array_merge($fields, editorFields($child, $path === '' ? (string)$i : $path . '.' . $i));
    }
    return $fields;
}

function editorModel(string $html): array {
    [, , $blocks] = editorParse($html);
    $rows = [];
    foreach ($blocks as $id => $block) {
        $kind = editorBlockKind($block);
        $rows[] = ['id' => $id, 'kind' => $kind ?? $block->getAttribute('class'),
            'speakerMissing' => $kind !== null && !editorDescendantWithClass($block, $kind === 'dialogue' ? 'character' : 'lyrics-speaker'),
            'page' => $block->getAttribute('data-page'), 'act' => $block->getAttribute('data-act'),
            'scene' => $block->getAttribute('data-scene'), 'fields' => editorFields($block)];
    }
    return $rows;
}

function editorHasClass(DOMElement $node, string $class): bool {
    return in_array($class, preg_split('/\s+/', trim($node->getAttribute('class'))), true);
}

function editorDescendantWithClass(DOMElement $block, string $class): ?DOMElement {
    foreach ($block->getElementsByTagName('*') as $node) {
        if ($node instanceof DOMElement && editorHasClass($node, $class)) return $node;
    }
    return null;
}

function editorBlockKind(DOMElement $block): ?string {
    if (editorHasClass($block, 'cue') && !editorHasClass($block, 'act-heading') && !editorHasClass($block, 'scene-heading') &&
        editorDescendantWithClass($block, 'dialog')) return 'dialogue';
    if (editorHasClass($block, 'lyrics-block') &&
        editorDescendantWithClass($block, 'lyrics')) return 'lyrics';
    return null;
}

function editorSetClass(DOMElement $node, string $class, bool $enabled): void {
    $classes = preg_split('/\s+/', trim($node->getAttribute('class')));
    $classes = array_values(array_filter($classes, static fn($value) => $value !== '' && $value !== $class));
    if ($enabled) $classes[] = $class;
    $node->setAttribute('class', implode(' ', $classes));
}

function editorRenameElement(DOMElement $node, string $tag): DOMElement {
    $replacement = $node->ownerDocument->createElement($tag);
    foreach ($node->attributes as $attribute) $replacement->setAttribute($attribute->name, $attribute->value);
    while ($node->firstChild) $replacement->appendChild($node->firstChild);
    $node->parentNode->replaceChild($replacement, $node);
    return $replacement;
}

function editorChangeBlockType(DOMElement $block, string $kind): void {
    $current = editorBlockKind($block);
    if (!in_array($current, ['dialogue', 'lyrics'], true) ||
        !in_array($kind, ['dialogue', 'lyrics'], true)) throw new InvalidArgumentException('Only dialogue and lyrics blocks can change type');
    if ($kind === $current) return;

    $speaker = editorDescendantWithClass($block, $current === 'dialogue' ? 'character' : 'lyrics-speaker');
    $text = editorDescendantWithClass($block, $current === 'dialogue' ? 'dialog' : 'lyrics');
    if (!$text) throw new InvalidArgumentException('Block does not have editable dialogue or lyrics text');

    if ($speaker) {
        editorSetClass($speaker, $current === 'dialogue' ? 'character' : 'lyrics-speaker', false);
        editorSetClass($speaker, $kind === 'dialogue' ? 'character' : 'lyrics-speaker', true);
    } elseif ($kind === 'dialogue') {
        $speaker = $block->ownerDocument->createElement('span');
        $speaker->setAttribute('class', 'character');
        $block->insertBefore($speaker, $text);
        $block->insertBefore($block->ownerDocument->createTextNode(' '), $text);
    }
    $text = editorRenameElement($text, $kind === 'dialogue' ? 'span' : 'div');
    editorSetClass($text, $current === 'dialogue' ? 'dialog' : 'lyrics', false);
    editorSetClass($text, $kind === 'dialogue' ? 'dialog' : 'lyrics', true);

    editorSetClass($block, $current === 'dialogue' ? 'cue' : 'lyrics-block', false);
    editorSetClass($block, $kind === 'dialogue' ? 'cue' : 'lyrics-block', true);
}

function editorSetText(DOMNode $node, string $text): void {
    if (strlen($text) > 100000 || !preg_match('//u', $text) || strpos($text, "\0") !== false) throw new InvalidArgumentException('Invalid or oversized text');
    $text = str_replace(["\r\n", "\r"], "\n", $text);
    if ($node instanceof DOMText) { $node->nodeValue = $text; return; }
    while ($node->firstChild) $node->removeChild($node->firstChild);
    foreach (explode("\n", $text) as $i => $line) {
        if ($i) $node->appendChild($node->ownerDocument->createElement('br'));
        $node->appendChild($node->ownerDocument->createTextNode($line));
    }
}

function editorApply(string $html, array $operations): array {
    if (count($operations) > 500) throw new InvalidArgumentException('Save at most 500 changes at a time');
    [$doc, $root, $blocks, $maximum] = editorParse($html);
    $ids = []; $changed = false;
    foreach ($operations as $op) {
        if (!is_array($op)) throw new InvalidArgumentException('Invalid change');
        $target = $op['target'] ?? '';
        if (!is_string($target) || !isset($blocks[$target])) throw new InvalidArgumentException('Unknown paragraph');
        $block = $blocks[$target];
        if (($op['action'] ?? '') === 'update') {
            $values = $op['fields'] ?? null;
            if (!is_array($values)) throw new InvalidArgumentException('Invalid fields');
            $allowed = [];
            foreach (editorFields($block) as $field) $allowed[$field['key']] = $field['value'];
            foreach ($values as $key => $value) {
                $key = (string)$key;
                if (!array_key_exists($key, $allowed) || !is_string($value)) throw new InvalidArgumentException('Unknown text field');
                if ($value === $allowed[$key]) continue;
                $node = $block;
                if ($key !== '') foreach (explode('.', $key) as $index) $node = $node->childNodes->item((int)$index);
                editorSetText($node, $value);
                $changed = true;
            }
        } elseif (($op['action'] ?? '') === 'set-speaker') {
            $kind = editorBlockKind($block);
            $speaker = $op['speaker'] ?? null;
            if (!$kind || !is_string($speaker) || trim($speaker) === '' || strlen($speaker) > 1000) throw new InvalidArgumentException('Invalid speaker');
            $existing = editorDescendantWithClass($block, $kind === 'dialogue' ? 'character' : 'lyrics-speaker');
            if (!$existing) {
                $text = editorDescendantWithClass($block, $kind === 'dialogue' ? 'dialog' : 'lyrics');
                $existing = $doc->createElement('span');
                $existing->setAttribute('class', $kind === 'dialogue' ? 'character' : 'lyrics-speaker');
                $block->insertBefore($existing, $text->parentNode === $block ? $text : $text->parentNode);
                if ($kind === 'dialogue') $block->insertBefore($doc->createTextNode(' '), $text->parentNode === $block ? $text : $text->parentNode);
            }
            editorSetText($existing, $speaker);
            $changed = true;
        } elseif (($op['action'] ?? '') === 'delete') {
            $block->parentNode->removeChild($block);
            unset($blocks[$target]);
            $changed = true;
        } elseif (($op['action'] ?? '') === 'change-type') {
            $kind = $op['kind'] ?? '';
            if (!is_string($kind)) throw new InvalidArgumentException('Invalid block type');
            $previousKind = editorBlockKind($block);
            editorChangeBlockType($block, $kind);
            if ($previousKind !== $kind) $changed = true;
        } elseif (($op['action'] ?? '') === 'insert') {
            $key = $op['key'] ?? '';
            $kind = $op['kind'] ?? '';
            $classes = ['paragraph' => 'cue', 'dialogue' => 'cue', 'lyrics' => 'lyrics-block',
                'direction' => 'stage-direction', 'act' => 'cue act-heading',
                'scene' => 'cue scene-heading', 'song' => 'lyrics-block song-heading'];
            if (!is_string($key) || !preg_match('/^new-[0-9]+$/', $key) || isset($blocks[$key]) ||
                !is_string($kind) || !isset($classes[$kind]) || !in_array($op['side'] ?? '', ['before', 'after'], true)) throw new InvalidArgumentException('Invalid insertion');
            $text = $op['text'] ?? null; $speaker = $op['speaker'] ?? '';
            if (!is_string($text) || trim($text) === '' || !is_string($speaker) || strlen($speaker) > 1000) throw new InvalidArgumentException('Text is required');
            if (++$maximum > 999999) throw new InvalidArgumentException('No available prompt IDs');
            $id = 'p' . str_pad((string)$maximum, 6, '0', STR_PAD_LEFT);
            $new = $doc->createElement('div');
            $new->setAttribute('class', $classes[$kind]); $new->setAttribute('data-prompt-id', $id);
            foreach (['data-page', 'data-act', 'data-scene'] as $attribute) {
                if ($block->hasAttribute($attribute)) $new->setAttribute($attribute, $block->getAttribute($attribute));
            }
            if ($kind === 'act') $new->setAttribute('data-act', $text);
            if ($kind === 'scene') $new->setAttribute('data-scene', $text);
            $append = function(string $tag, string $class, string $value) use ($doc, $new) {
                $child = $doc->createElement($tag); $child->setAttribute('class', $class);
                editorSetText($child, $value); $new->appendChild($child);
            };
            if ($kind === 'dialogue') { $append('span', 'character', $speaker); $new->appendChild($doc->createTextNode(' ')); $append('span', 'dialog', $text); }
            elseif ($kind === 'lyrics') { $append('span', 'lyrics-speaker', $speaker); $append('div', 'lyrics', $text); }
            elseif ($kind === 'paragraph') $append('span', 'dialog', $text);
            elseif ($kind === 'direction') editorSetText($new, $text);
            else $append('span', $kind === 'song' ? 'lyrics-speaker' : 'character', $text);
            $root->insertBefore($new, $op['side'] === 'before' ? $block : $block->nextSibling);
            $blocks[$key] = $new; $ids[$key] = $id; $changed = true;
        } else throw new InvalidArgumentException('Unknown change');
    }
    $output = '';
    foreach ($root->childNodes as $child) $output .= $doc->saveHTML($child);
    // Re-parse to enforce the ID invariant after every mutation.
    editorParse($output);
    return ['html' => $changed ? $output : $html, 'ids' => $ids];
}

function editorWrite(string $file, string $html): void {
    $stage = tempnam(dirname($file), '.script-edit-');
    if (!$stage) throw new RuntimeException('Could not prepare script save');
    try {
        if (file_put_contents($stage, $html) !== strlen($html) || !chmod($stage, fileperms($file) & 0777) || !rename($stage, $file)) {
            throw new RuntimeException('Could not save script; check server write permissions');
        }
    } finally { if (is_file($stage)) @unlink($stage); }
}
