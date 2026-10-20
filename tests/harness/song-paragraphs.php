<?php
require __DIR__ . '/../../dev_scripts/split-song-paragraphs.php';
$html = stream_get_contents(STDIN);
$result = splitSongParagraphs($html);
$second = splitSongParagraphs($result['html']);
$doc = new DOMDocument();
$doc->loadHTML('<meta charset="UTF-8"><div id="root">' . $result['html'] . '</div>', LIBXML_NOERROR | LIBXML_NOWARNING);
$xpath = new DOMXPath($doc);
$rows = [];
foreach ($xpath->query('//*[@id="root"]/*[@data-prompt-id]') as $row) {
    $columns = [];
    foreach ($row->childNodes as $child) {
        if ($child instanceof DOMElement && songHasClass($child, 'lyrics-column')) $columns[] = $child->textContent;
    }
    $rows[] = ['prompt' => $row->getAttribute('data-prompt-id'), 'text' => $row->textContent,
        'columns' => $columns, 'page' => $row->getAttribute('data-page')];
}
$result['rows'] = $rows;
$result['idempotent'] = $second['added'] === 0 && $second['html'] === $result['html'];
$result['remapped'] = [];
foreach ($result['wordMap'] as $id => $words) {
    foreach ($words as $index => $word) {
        $result['remapped'][] = songRemapAnchor(['type' => 'word', 'prompt' => $id, 'wordIndex' => $index], $result);
    }
}
echo json_encode($result, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
