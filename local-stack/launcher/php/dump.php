<?php
// Runs inside php-fpm (via fcgi.php). Lists the scripts real requests have used (OPcache hits > 0),
// relative to the code root, so the next warm-up compiles only those instead of all ~18,000 files.
header('Content-Type: text/plain');
$root = '/var/www/html/';
$s = opcache_get_status(true);
foreach (($s['scripts'] ?? []) as $path => $info) {
    if (($info['hits'] ?? 0) > 0 && str_starts_with($path, $root)) {
        echo substr($path, strlen($root)), "\n";
    }
}
