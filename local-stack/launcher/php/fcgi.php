<?php
// Minimal FastCGI client (the image has no cgi-fcgi): asks the php-fpm in this container to run
// one script, and prints its output. Usage: php fcgi.php /opt/launcher/warm.php
$script = $argv[1] ?? '/opt/launcher/warm.php';
$sock = @stream_socket_client('tcp://127.0.0.1:9000', $errno, $errstr, 5);
if (! $sock) {
    fwrite(STDERR, "php-fpm not reachable: $errstr\n");
    exit(1);
}
stream_set_timeout($sock, 900);

function rec(int $type, string $content, int $id = 1): string
{
    $len = strlen($content);
    $pad = (8 - ($len % 8)) % 8;

    return pack('CCnnCC', 1, $type, $id, $len, $pad, 0) . $content . str_repeat("\0", $pad);
}
function nv(string $k, string $v): string
{
    $enc = fn ($n) => $n < 128 ? chr($n) : pack('N', $n | 0x80000000);

    return $enc(strlen($k)) . $enc(strlen($v)) . $k . $v;
}

$params = [
    'SCRIPT_FILENAME' => $script,
    'SCRIPT_NAME' => '/' . basename($script),
    'REQUEST_METHOD' => 'GET',
    'REQUEST_URI' => '/' . basename($script),
    'QUERY_STRING' => '',
    'SERVER_SOFTWARE' => 'launcher',
    'REMOTE_ADDR' => '127.0.0.1',
    'SERVER_PROTOCOL' => 'HTTP/1.1',
    'GATEWAY_INTERFACE' => 'CGI/1.1',
];
$body = '';
foreach ($params as $k => $v) {
    $body .= nv($k, $v);
}
fwrite($sock, rec(1, pack('nCx5', 1, 0)) . rec(4, $body) . rec(4, '') . rec(5, ''));

$out = '';
while (! feof($sock)) {
    $h = fread($sock, 8);
    if (strlen($h) < 8) {
        break;
    }
    $r = unpack('Cver/Ctype/nid/nlen/Cpad/Cres', $h);
    $content = $r['len'] ? stream_get_contents($sock, $r['len']) : '';
    if ($r['pad']) {
        fread($sock, $r['pad']);
    }
    if ($r['type'] === 6) {
        $out .= $content;
    } elseif ($r['type'] === 7) {
        fwrite(STDERR, $content);
    } elseif ($r['type'] === 3) {
        break;
    }
}
$pos = strpos($out, "\r\n\r\n");
echo $pos === false ? $out : substr($out, $pos + 4);
