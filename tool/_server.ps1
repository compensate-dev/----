param([Parameter(Mandatory=$true)][string]$root,[int]$port=8123)
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:$port/")
$listener.Start()

$mime = @{
  '.html'='text/html; charset=utf-8'; '.css'='text/css; charset=utf-8'
  '.js'='application/javascript; charset=utf-8'; '.jpg'='image/jpeg'
  '.jpeg'='image/jpeg'; '.png'='image/png'; '.webp'='image/webp'
  '.svg'='image/svg+xml'; '.mp4'='video/mp4'; '.mp3'='audio/mpeg'
  '.aac'='audio/aac'; '.ttf'='font/ttf'; '.woff'='font/woff'; '.woff2'='font/woff2'
}

while ($listener.IsListening) {
  try { $ctx = $listener.GetContext() } catch { break }
  $state = @($ctx, $root, $mime)
  $cb = [System.Threading.WaitCallback]{
    param($s)
    $c = $s[0]; $rootDir = $s[1]; $mimeMap = $s[2]
    try {
      $rel = [Uri]::UnescapeDataString($c.Request.Url.AbsolutePath.TrimStart('/'))
      if ([string]::IsNullOrEmpty($rel)) { $rel = 'index.html' }
      $safe = $rel -replace '/', '\'
      $file = Join-Path $rootDir $safe
      if (Test-Path -LiteralPath $file -PathType Leaf) {
        $bytes = [IO.File]::ReadAllBytes($file)
        $ext = [IO.Path]::GetExtension($file).ToLower()
        if ($mimeMap.ContainsKey($ext)) { $c.Response.ContentType = $mimeMap[$ext] } else { $c.Response.ContentType = 'application/octet-stream' }
        $c.Response.ContentLength64 = $bytes.Length
        $c.Response.OutputStream.Write($bytes, 0, $bytes.Length)
      } else {
        $c.Response.StatusCode = 404
      }
    } catch { } finally { try { $c.Response.Close() } catch { } }
  }
  [void][System.Threading.ThreadPool]::QueueUserWorkItem($cb, $state)
}
