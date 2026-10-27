param([Parameter(Mandatory=$true)][string]$root,[int]$port=8123)
Add-Type -AssemblyName System.Web
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:$port/")
$listener.Start()
while ($listener.IsListening) {
  try { $ctx = $listener.GetContext() } catch { break }
  $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart('/'))
  if ([string]::IsNullOrEmpty($rel)) { $rel = 'index.html' }
  $safe = $rel -replace '/', '\'
  $file = Join-Path $root $safe
  if (Test-Path -LiteralPath $file -PathType Leaf) {
    $bytes = [IO.File]::ReadAllBytes($file)
    $ext = [IO.Path]::GetExtension($file).ToLower()
    switch ($ext) {
      '.html' { $ctx.Response.ContentType = 'text/html; charset=utf-8' }
      '.css'  { $ctx.Response.ContentType = 'text/css; charset=utf-8' }
      '.js'   { $ctx.Response.ContentType = 'application/javascript; charset=utf-8' }
      '.jpg'  { $ctx.Response.ContentType = 'image/jpeg' }
      '.jpeg' { $ctx.Response.ContentType = 'image/jpeg' }
      '.png'  { $ctx.Response.ContentType = 'image/png' }
      '.webp' { $ctx.Response.ContentType = 'image/webp' }
      '.svg'  { $ctx.Response.ContentType = 'image/svg+xml' }
      '.mp4'  { $ctx.Response.ContentType = 'video/mp4' }
      '.mp3'  { $ctx.Response.ContentType = 'audio/mpeg' }
      '.aac'  { $ctx.Response.ContentType = 'audio/aac' }
      '.ttf'  { $ctx.Response.ContentType = 'font/ttf' }
      '.woff' { $ctx.Response.ContentType = 'font/woff' }
      '.woff2' { $ctx.Response.ContentType = 'font/woff2' }
      default { $ctx.Response.ContentType = 'application/octet-stream' }
    }
    $ctx.Response.ContentLength64 = $bytes.Length
    $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  } else {
    $ctx.Response.StatusCode = 404
  }
  $ctx.Response.Close()
}
