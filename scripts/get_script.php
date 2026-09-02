<?php
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
$c = require __DIR__ . '/script_catalog.php';
$id=$_GET['id']??'';
if(!preg_match('/^[A-Za-z0-9_-]+$/',$id) || !isset($c[$id])){http_response_code(404);exit('Unknown script');}
$f=$c[$id]['file'];
if(!is_readable($f)){http_response_code(404);exit('Script unavailable');}
readfile($f);
