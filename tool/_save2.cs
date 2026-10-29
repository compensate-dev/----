// 接收 _embed-textures.html POST 的转码结果，写入项目根 map-textures.js（转码专用，用完即停）
using System;
using System.IO;
using System.Net;
using System.Text;

class SaveServer {
  static void Main() {
    var l = new HttpListener();
    l.Prefixes.Add("http://127.0.0.1:8199/");
    l.Start();
    Console.WriteLine("LISTENING 8199");
    while (true) {
      HttpListenerContext c = null;
      try { c = l.GetContext(); } catch { break; }
      try {
        if (c.Request.HttpMethod == "POST") {
          string body = new StreamReader(c.Request.InputStream, Encoding.UTF8).ReadToEnd();
          File.WriteAllText(@"c:\Users\Admin（无密码）\.copilot\chats\风月一场梦，江山万里愁\map-textures.js", body);
          byte[] b = Encoding.UTF8.GetBytes("SAVED " + body.Length);
          c.Response.Headers.Add("Access-Control-Allow-Origin", "*");
          c.Response.ContentType = "text/plain";
          c.Response.ContentLength64 = b.Length;
          c.Response.OutputStream.Write(b, 0, b.Length);
          Console.WriteLine("SAVED " + body.Length);
        } else {
          c.Response.Headers.Add("Access-Control-Allow-Origin", "*");
          byte[] b = Encoding.UTF8.GetBytes("OK");
          c.Response.ContentType = "text/plain";
          c.Response.ContentLength64 = b.Length;
          c.Response.OutputStream.Write(b, 0, b.Length);
        }
      } catch { } finally { try { c.Response.Close(); } catch { } }
    }
  }
}
