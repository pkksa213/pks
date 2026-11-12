<?php
// Public timetable endpoint for Android/iOS. No accounts or credentials.
header('Content-Type: application/json; charset=UTF-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, HEAD, OPTIONS');
header('Cache-Control: no-store');
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method === 'OPTIONS') {
    http_response_code(204);
    exit;
}
if ($method !== 'GET' && $method !== 'HEAD') {
    http_response_code(405);
    header('Allow: GET, HEAD, OPTIONS');
    echo '{"error":"method_not_allowed"}';
    exit;
}
if (!is_readable(__DIR__ . '/data.json')) {
    http_response_code(503);
    echo '{"error":"schedule_unavailable"}';
    exit;
}
if ($method !== 'HEAD') {
    readfile(__DIR__ . '/data.json');
}
