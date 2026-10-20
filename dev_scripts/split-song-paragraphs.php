<?php
// Usage: php dev_scripts/split-song-paragraphs.php --script=hansel_gretel [--write]
// Run against an offline working copy, then deploy the script and remapped data
// together. Production content and backups must never be committed to Git.
require_once __DIR__ . '/lib/song-paragraphs.php';
require_once __DIR__ . '/../scripts/util/api_common.php';
require_once __DIR__ . '/../scripts/util/script_revisions.php';

function songBackup(string $file, string $raw): void {
    if (file_put_contents($file, $raw) !== strlen($raw)) throw new RuntimeException('Could not write conversion backup');
}

function songRemapAnchor(array $anchor, array $conversion): array {
    $id = $anchor['prompt'] ?? '';
    if (!isset($conversion['splitBlocks'][$id])) return $anchor;
    if (($anchor['type'] ?? '') === 'word') {
        $target = $conversion['wordMap'][$id][$anchor['wordIndex'] ?? -1] ?? null;
        if (!$target) throw new RuntimeException('Cannot map a word cue in ' . $id);
        if (($anchor['text'] ?? '') !== '' && $anchor['text'] !== $target['text']) {
            throw new RuntimeException('Stored trigger text no longer matches the script in ' . $id);
        }
        return array_merge($anchor, $target, ['fraction' => 0]);
    }
    // Existing paragraph badges are rendered at the block start, regardless
    // of the captured viewport fraction. Keep that same visible placement.
    if (($anchor['type'] ?? '') === 'paragraph') return array_merge($anchor, ['fraction' => 0]);
    $fraction = (float)($anchor['fraction'] ?? 0);
    if ($fraction === 0.0) return $anchor;
    if ($fraction === 1.0) {
        $anchor['prompt'] = end($conversion['splitBlocks'][$id]);
        return $anchor;
    }
    throw new RuntimeException('Fractional anchor in ' . $id . ' needs an explicit placement before splitting');
}

if (realpath($_SERVER['SCRIPT_FILENAME'] ?? '') !== __FILE__) return;
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
$options = getopt('', ['script:', 'write']);
$script = $options['script'] ?? '';
$catalog = require __DIR__ . '/../scripts/script_catalog.php';
if (!is_string($script) || !isValidId($script) || !isset($catalog[$script])) {
    fwrite(STDERR, "Choose an allow-listed --script ID. Add --write to apply an offline conversion.\n"); exit(1);
}
try {
    $source = $catalog[$script]['file'];
    $original = file_get_contents($source);
    if ($original === false) throw new RuntimeException('Script unavailable');
    $conversion = splitSongParagraphs($original);
    $changes = []; $originals = []; $cueCount = 0; $annotationCount = 0; $blocked = [];
    foreach (['show-cues', 'show-annotations'] as $directory) {
        foreach (glob(dirname(__DIR__) . '/' . $directory . '/' . $script . '_*.json') as $file) {
            $raw = file_get_contents($file); $doc = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
            $changed = false;
            if ($directory === 'show-cues') {
                foreach ($doc['cues'] ?? [] as $i => $cue) {
                    try {
                        foreach (['anchor', 'endAnchor'] as $key) {
                            if (isset($cue[$key])) $cue[$key] = songRemapAnchor($cue[$key], $conversion);
                        }
                        if ($cue !== $doc['cues'][$i]) { $doc['cues'][$i] = $cue; $changed = true; $cueCount++; }
                    } catch (RuntimeException $error) { $blocked[] = basename($file) . ': ' . $error->getMessage(); }
                }
            } else {
                foreach ($doc['annotations'] ?? [] as $i => $ann) {
                    if (isset($conversion['splitBlocks'][$ann['prompt'] ?? ''])) {
                        $doc['annotations'][$i]['unresolved'] = true;
                        $changed = true; $annotationCount++;
                    }
                }
            }
            if ($changed) {
                $doc['revision'] = (int)($doc['revision'] ?? 0) + 1;
                $changes[$file] = json_encode($doc, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR) . "\n";
                $originals[$file] = $raw;
            }
        }
    }
    $summary = ['script' => $script, 'splitBlocks' => count($conversion['splitBlocks']),
        'newPositions' => $conversion['added'], 'remappedCues' => $cueCount,
        'annotationsNeedingReview' => $annotationCount, 'blocked' => $blocked, 'written' => false];
    if (isset($options['write']) && $conversion['added']) {
        if ($blocked) throw new RuntimeException(implode("\n", $blocked));
        $oldHash = snapshotScript($script, $original);
        snapshotScript($script, $conversion['html']);
        $backup = dirname(__DIR__) . '/scripts/teleprompter_state/script_revisions/' . $script . '/song-paragraphs-' . bin2hex(random_bytes(6));
        if (!mkdir($backup, 0775, true)) throw new RuntimeException('Could not create conversion backup');
        songBackup($backup . '/source.html', $original);
        foreach ($originals as $file => $raw) songBackup($backup . '/' . basename(dirname($file)) . '-' . basename($file), $raw);
        songBackup($backup . '/mapping.json', json_encode($conversion['splitBlocks'], JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR));
        $originals[$source] = $original;
        $changes[$source] = $conversion['html'];
        // Refuse to overwrite changes made while the conversion was prepared.
        foreach ($originals as $file => $raw) {
            if (file_get_contents($file) !== $raw) throw new RuntimeException('File changed during conversion: ' . basename($file));
        }
        $written = [];
        try {
            foreach ($changes as $file => $raw) {
                $stage = tempnam(dirname($file), '.song-stage-');
                if (file_put_contents($stage, $raw) !== strlen($raw) || !chmod($stage, fileperms($file) & 0777) || !rename($stage, $file)) {
                    @unlink($stage); throw new RuntimeException('Could not replace ' . basename($file));
                }
                $written[] = $file;
            }
        } catch (Throwable $error) {
            foreach (array_reverse($written) as $file) file_put_contents($file, $originals[$file]);
            throw $error;
        }
        $summary['written'] = true;
        $summary['backup'] = $backup;
        $summary['originalRevision'] = $oldHash;
    }
    echo json_encode($summary, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n";
} catch (Throwable $error) { fwrite(STDERR, $error->getMessage() . "\n"); exit(1); }
