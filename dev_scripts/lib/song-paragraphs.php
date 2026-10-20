<?php
// Offline conversion only. Runtime script loading never invents prompt IDs.
function songHasClass(DOMElement $node, string $class): bool {
    return in_array($class, preg_split('/\s+/', $node->getAttribute('class')), true);
}

function songMeaningful(array $nodes): bool {
    foreach ($nodes as $node) {
        if ($node instanceof DOMElement || trim($node->textContent) !== '') return true;
    }
    return false;
}

function songStanzas(DOMElement $lyrics): array {
    $parts = []; $current = []; $breaks = 0;
    $flush = function(bool $separator = true) use (&$parts, &$current, $lyrics) {
        // The blank-line separator becomes a paragraph boundary, not stray BRs.
        while ($separator && $current) {
            $last = end($current);
            if (($last instanceof DOMElement && strtolower($last->tagName) === 'br') ||
                ($last instanceof DOMText && trim($last->textContent) === '')) array_pop($current);
            else break;
        }
        if (songMeaningful($current)) {
            $part = $lyrics->cloneNode(false);
            foreach ($current as $child) $part->appendChild($child);
            $parts[] = $part;
        }
        $current = [];
    };
    foreach (iterator_to_array($lyrics->childNodes) as $child) {
        if ($child instanceof DOMElement && strtolower($child->tagName) === 'br') {
            $breaks++;
            if ($breaks === 2) $flush();
            if ($breaks < 2) $current[] = $child;
            continue;
        }
        if ($child instanceof DOMText && trim($child->textContent) === '' && $breaks) {
            if ($breaks < 2) $current[] = $child;
            continue;
        }
        $breaks = 0;
        // Explicit paragraph children are stanza boundaries as well.
        if ($child instanceof DOMElement && in_array(strtolower($child->tagName), ['p', 'div'], true)) {
            $flush(); $current[] = $child; $flush();
        } else $current[] = $child;
    }
    $flush(false);
    return $parts;
}

function songColumnParts(DOMElement $column): array {
    $parts = []; $current = []; $hasLyrics = false;
    $flush = function() use (&$parts, &$current, &$hasLyrics) {
        if (songMeaningful($current)) $parts[] = $current;
        $current = []; $hasLyrics = false;
    };
    foreach (iterator_to_array($column->childNodes) as $child) {
        if ($child instanceof DOMElement && songHasClass($child, 'lyrics-speaker')) {
            if ($hasLyrics) $flush();
            $current[] = $child;
        } elseif ($child instanceof DOMElement && songHasClass($child, 'lyrics')) {
            foreach (songStanzas($child) as $stanza) {
                if ($hasLyrics) $flush();
                $current[] = $stanza; $hasLyrics = true;
            }
        } else $current[] = $child;
    }
    $flush();
    return $parts;
}

function splitSongParagraphs(string $html): array {
    $doc = new DOMDocument('1.0', 'UTF-8');
    $doc->loadHTML('<!doctype html><html><head><meta charset="UTF-8"></head><body><div id="song-conversion-source">' . $html . '</div></body></html>', LIBXML_NONET | LIBXML_NOERROR | LIBXML_NOWARNING);
    $root = $doc->getElementById('song-conversion-source');
    if (!$root) throw new RuntimeException('Could not parse script fragment');
    $xpath = new DOMXPath($doc);
    $seen = []; $next = 0;
    foreach ($xpath->query('.//*[@data-prompt-id]', $root) as $node) {
        $id = $node->getAttribute('data-prompt-id');
        if (!preg_match('/^p[0-9]{6}$/', $id) || isset($seen[$id])) throw new RuntimeException('Invalid or duplicate prompt ID: ' . $id);
        $seen[$id] = true; $next = max($next, (int)substr($id, 1));
    }
    $wordMap = []; $splitBlocks = []; $added = 0;
    foreach (iterator_to_array($root->childNodes) as $block) {
        if (!$block instanceof DOMElement || !$block->hasAttribute('data-prompt-id') || songHasClass($block, 'song-heading')) continue;
        if (!songHasClass($block, 'lyrics-block') && !songHasClass($block, 'two-column-lyrics')) continue;
        $oldId = $block->getAttribute('data-prompt-id');
        // Temporary token identities let saved word cues follow moved content.
        $index = 0;
        foreach (iterator_to_array($xpath->query('.//text()', $block)) as $text) {
            if (in_array(strtolower($text->parentNode->nodeName), ['style', 'script'], true)) continue;
            preg_match_all('/\S+/u', $text->nodeValue, $matches, PREG_OFFSET_CAPTURE);
            if (!$matches[0]) continue;
            $fragment = $doc->createDocumentFragment(); $offset = 0;
            foreach ($matches[0] as [$word, $start]) {
                if ($start > $offset) $fragment->appendChild($doc->createTextNode(substr($text->nodeValue, $offset, $start - $offset)));
                $token = $doc->createElement('span');
                $token->setAttribute('data-song-word-origin', $oldId . ':' . $index++);
                $token->appendChild($doc->createTextNode($word)); $fragment->appendChild($token);
                $offset = $start + strlen($word);
            }
            if ($offset < strlen($text->nodeValue)) $fragment->appendChild($doc->createTextNode(substr($text->nodeValue, $offset)));
            $text->parentNode->replaceChild($fragment, $text);
        }
        $columns = [];
        if (songHasClass($block, 'two-column-lyrics')) {
            foreach (iterator_to_array($block->childNodes) as $child) {
                if ($child instanceof DOMElement && songHasClass($child, 'lyrics-column')) $columns[] = $child;
                elseif (trim($child->textContent) !== '') throw new RuntimeException('Unexpected content outside lyrics columns in ' . $oldId);
            }
        }
        $parts = $columns ? array_map('songColumnParts', $columns) : [songColumnParts($block)];
        $count = max(array_map('count', $parts));
        if ($count === 0) continue;
        $rows = [];
        for ($rowIndex = 0; $rowIndex < $count; $rowIndex++) {
            $row = $block->cloneNode(false);
            if ($rowIndex === 0) $id = $oldId;
            else {
                if (++$next > 999999) throw new RuntimeException('No available prompt IDs');
                $id = 'p' . str_pad((string)$next, 6, '0', STR_PAD_LEFT); $added++;
            }
            $row->setAttribute('data-prompt-id', $id);
            if ($count > 1) $row->setAttribute('data-song-section', (string)($rowIndex + 1));
            if ($columns) {
                foreach ($columns as $columnIndex => $column) {
                    $target = $column->cloneNode(false);
                    foreach ($parts[$columnIndex][$rowIndex] ?? [] as $child) $target->appendChild($child);
                    $row->appendChild($target);
                }
            } else foreach ($parts[0][$rowIndex] as $child) $row->appendChild($child);
            $block->parentNode->insertBefore($row, $block); $rows[] = $row;
        }
        if ($count > 1) $splitBlocks[$oldId] = array_map(fn($row) => $row->getAttribute('data-prompt-id'), $rows);
        $block->parentNode->removeChild($block);
        $mapped = 0;
        foreach ($rows as $row) {
            $newIndex = 0;
            foreach ($xpath->query('.//*[@data-song-word-origin]', $row) as $token) {
                [$origin, $oldIndex] = explode(':', $token->getAttribute('data-song-word-origin'));
                $wordMap[$origin][(int)$oldIndex] = ['prompt' => $row->getAttribute('data-prompt-id'), 'wordIndex' => $newIndex++, 'text' => $token->textContent];
                $mapped++;
            }
        }
        if ($mapped !== $index) throw new RuntimeException('Conversion would lose words in ' . $oldId);
    }
    foreach (iterator_to_array($xpath->query('.//*[@data-song-word-origin]', $root)) as $token) {
        $token->parentNode->replaceChild($doc->createTextNode($token->textContent), $token);
    }
    $root->normalize();
    $output = '';
    foreach ($root->childNodes as $child) $output .= $doc->saveHTML($child);
    // A second run should leave a converted script byte-for-byte unchanged.
    return ['html' => $added ? $output : $html, 'added' => $added, 'splitBlocks' => $splitBlocks, 'wordMap' => $wordMap];
}
