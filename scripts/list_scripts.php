<?php
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
require_once __DIR__ . '/util/api_common.php';
$showPassword = loadPasswords()['show'] ?? '';
requireShowAccess($showPassword);

$c = require __DIR__ . '/script_catalog.php';
$out=[];
foreach($c as $id=>$e){
  if(preg_match('/^[A-Za-z0-9_-]+$/',$id) && isset($e['name'],$e['file']) && is_readable($e['file']))
    $out[]=['id'=>$id,'name'=>$e['name']];
}
echo json_encode(['ok'=>true,'scripts'=>$out]);
