param([string]$root = "", [int]$port = 8131)
if (-not $root) { $root = Split-Path -Parent $MyInvocation.MyCommand.Path }

$src = @"
using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Threading;

public static class InkServer {
    static string rootDir;
    static HttpListener listener;

    static string MimeOf(string ext) {
        switch (ext) {
            case ".html": return "text/html; charset=utf-8";
            case ".css":  return "text/css; charset=utf-8";
            case ".js":   return "application/javascript; charset=utf-8";
            case ".jpg":  return "image/jpeg";
            case ".jpeg": return "image/jpeg";
            case ".png":  return "image/png";
            case ".webp": return "image/webp";
            case ".svg":  return "image/svg+xml";
            case ".mp3":  return "audio/mpeg";
            case ".mp4":  return "video/mp4";
            case ".ttf":  return "font/ttf";
            case ".woff": return "font/woff";
            case ".woff2":return "font/woff2";
            default:      return "application/octet-stream";
        }
    }

    static void Loop() {
        listener.BeginGetContext(new AsyncCallback(OnContext), null);
    }

    static void OnContext(IAsyncResult ar) {
        HttpListener ctx = null;
        try { ctx = listener.EndGetContext(ar); } catch (Exception) { }
        Loop();
        if (ctx != null) {
            try { Serve(ctx); } catch (Exception) { }
            try { ctx.Response.Close(); } catch (Exception) { }
        }
    }

    static void Serve(HttpListener ctx) {
        string rel = Uri.UnescapeDataString(ctx.Request.Url.AbsolutePath.TrimStart('/'));
        if (string.IsNullOrEmpty(rel)) rel = "index.html";
        string file = Path.Combine(rootDir, rel.Replace('/', Path.DirectorySeparatorChar));
        if (File.Exists(file)) {
            string ext = Path.GetExtension(file).ToLowerInvariant();
            ctx.Response.ContentType = MimeOf(ext);
            ctx.Response.Headers["Cache-Control"] = "no-cache";
            byte[] bytes = File.ReadAllBytes(file);
            ctx.Response.ContentLength64 = bytes.Length;
            ctx.Response.OutputStream.Write(bytes, 0, bytes.Length);
        } else {
            ctx.Response.StatusCode = 404;
        }
    }

    public static void Run(string root, int port) {
        rootDir = root;
        string[] prefixes = { "http://127.0.0.1:" + port + "/", "http://localhost:" + port + "/" };
        bool started = false;
        foreach (string p in prefixes) {
            try {
                listener = new HttpListener();
                listener.Prefixes.Add(p);
                listener.Start();
                Console.WriteLine("LISTENING " + port + " via " + p);
                Loop();
                started = true;
                break;
            } catch (Exception) { }
        }
        if (!started) { Console.WriteLine("START FAILED"); return; }
        Thread.Sleep(Timeout.Infinite);
    }
}
"@
Add-Type -TypeDefinition $src -Language CSharp
[InkServer]::Run($root, $port)
