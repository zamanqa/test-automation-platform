<?php
// Runs INSIDE php-fpm (sent by fcgi.php), so it fills the OPcache the API's requests share.
// The code is a Windows folder mounted into Docker, where reading a file costs ~40ms: the first
// request on a code path (a sign-in code email, say) compiles hundreds of files and can take ~10s.
//
// used-files.txt (written by the launcher from dump.php) lists the files real requests used, so
// normally only those are compiled (a minute or two). Without it, everything is compiled once
// (~10 minutes, in the background).
set_time_limit(0);
ignore_user_abort(true);
header('Content-Type: text/plain');

$root = '/var/www/html';
$t = microtime(true);
$compiled = 0;
$skipped = 0;
$failed = 0;

// Progress for the launcher's progress bar: 'done total' in /tmp/launcher-warm, every 100 files.
$total = 0;
$progress = function () use (&$compiled, &$skipped, &$failed, &$total) {
    $done = $compiled + $skipped + $failed;
    if ($done % 100 === 0 || $done >= $total) {
        @file_put_contents('/tmp/launcher-warm', $done . ' ' . $total);
    }
};

$compile = function (string $path) use (&$compiled, &$skipped, &$failed, $progress) {
    $progress();
    if (opcache_is_script_cached($path)) {
        $skipped++;

        return;
    }
    try {
        @opcache_compile_file($path) ? $compiled++ : $failed++;
    } catch (Throwable $e) {
        $failed++;
    }
};

$list = __DIR__ . '/used-files.txt';
$mode = 'used-files';
if (is_file($list) && filesize($list) > 0) {
    $files = file($list, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    $total = count($files);
    foreach ($files as $rel) {
        $path = $root . '/' . ltrim($rel, '/');
        if (is_file($path)) {
            $compile($path);
        }
    }
} else {
    $mode = 'everything';
    $total = 18000; // roughly; only used for the progress bar
    foreach (['app', 'config', 'routes', 'bootstrap', 'vendor'] as $dir) {
        if (! is_dir("$root/$dir")) {
            continue;
        }
        $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator("$root/$dir", FilesystemIterator::SKIP_DOTS));
        foreach ($it as $file) {
            $path = $file->getPathname();
            if (substr($path, -4) !== '.php') {
                continue;
            }
            // Test suites, stubs and fixtures are never loaded by the app.
            if (preg_match('#/(tests?|Tests?|stubs?|fixtures?|Fixtures?|docs?)/#', substr($path, strlen($root)))) {
                $skipped++;
                continue;
            }
            $compile($path);
        }
    }
}

$status = opcache_get_status(false);
printf(
    "mode=%s compiled=%d skipped=%d failed=%d seconds=%.1f cached=%d memory_free_mb=%.0f\n",
    $mode, $compiled, $skipped, $failed, microtime(true) - $t,
    $status['opcache_statistics']['num_cached_scripts'] ?? -1,
    ($status['memory_usage']['free_memory'] ?? 0) / 1048576
);
