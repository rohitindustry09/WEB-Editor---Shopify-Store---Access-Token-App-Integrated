import { guardOpen } from "@/lib/auth/openGuard";
import { bgJobZip, getBgJob } from "@/lib/bgJobs";
import { JOB_ID } from "@/lib/bgJobTypes";
import { serveFileWithRange } from "@/lib/serveFile";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/**
 * A page a browser is shown when it opens a download link that isn't ready yet (a run still working, or its zip still being
 * packed). It keeps checking and starts the download by itself the moment the file is ready — so the link works whenever it is
 * opened, and can be left open.
 */
function waitingPage(id: string): Response {
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Preparing your download</title>
<style>
  :root{color-scheme:light dark}
  body{font:16px/1.5 system-ui,sans-serif;margin:0;min-height:100vh;display:grid;place-items:center;background:Canvas;color:CanvasText}
  main{max-width:30rem;padding:2rem;text-align:center}
  .spin{width:2.2rem;height:2.2rem;margin:0 auto 1rem;border:3px solid color-mix(in srgb,CanvasText 20%,transparent);border-top-color:CanvasText;border-radius:50%;animation:s 0.9s linear infinite}
  @keyframes s{to{transform:rotate(360deg)}}
  .bar{height:6px;border-radius:3px;background:color-mix(in srgb,CanvasText 15%,transparent);overflow:hidden;margin:1rem 0 .5rem}
  .bar i{display:block;height:100%;width:0;background:CanvasText;transition:width .4s}
  p{margin:.4rem 0}.muted{opacity:.7;font-size:.9rem}
  button{font:inherit;padding:.5rem 1rem;border-radius:.5rem;border:1px solid currentColor;background:transparent;color:inherit;cursor:pointer;margin-top:.8rem}
</style></head>
<body><main>
  <div class="spin" id="spin"></div>
  <h1 id="title" style="font-size:1.3rem;margin:.2rem 0">Preparing your download…</h1>
  <p id="msg" class="muted">One moment.</p>
  <div class="bar" id="bar" hidden><i id="fill"></i></div>
  <button id="retry" hidden>Try again</button>
</main>
<script>
(function () {
  var id = ${JSON.stringify(id)};
  var api = "/api/bg-jobs/" + encodeURIComponent(id);
  var $ = function (n) { return document.getElementById(n); };
  var started = false;
  function say(title, msg, showSpin) { $("title").textContent = title; $("msg").textContent = msg; $("spin").style.display = showSpin === false ? "none" : "block"; }
  function size(n) { return n > 1073741824 ? (n / 1073741824).toFixed(2) + " GB" : n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.round(n / 1024) + " KB"; }
  function poll() {
    fetch(api, { cache: "no-store" }).then(function (r) {
      if (r.status === 404) { say("This download isn't available here", "It was deleted, or it belongs to another browser. Open the app in the browser where you started it.", false); return null; }
      return r.json();
    }).then(function (data) {
      if (!data) return;
      var j = data.job;
      if (j.download === "ready") {
        if (!started) { started = true; say("Your download is starting", (j.downloadBytes ? size(j.downloadBytes) + " — " : "") + "if nothing happens, use the link below.", false); location.href = api + "/download"; $("msg").innerHTML += ' <a href="' + api + '/download">Download</a>'; }
        return;
      }
      if (j.status === "queued" || j.status === "running") {
        var total = j.total + j.copyTotal, done = j.done + j.copied;
        say("This run is still working", done + " of " + total + " images done. The download will start by itself when it's finished.");
        $("bar").hidden = false; $("fill").style.width = (total ? Math.min(100, done / total * 100) : 0) + "%";
      } else if (j.download === "failed") {
        say("The download couldn't be prepared", j.downloadError || "Something went wrong.", false); $("bar").hidden = true; $("retry").hidden = false; return;
      } else if (j.download === "none" && j.done + j.copied === 0) {
        say("Nothing to download", "This run didn't produce any images.", false); return;
      } else {
        say("Packing your images into one zip…", "This happens once. The download starts automatically.");
      }
      setTimeout(poll, 2000);
    }).catch(function () { setTimeout(poll, 4000); });
  }
  $("retry").onclick = function () {
    $("retry").hidden = true; say("Preparing your download…", "One moment.");
    fetch(api, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "prepare" }) }).then(function () { setTimeout(poll, 1000); });
  };
  poll();
})();
</script></body></html>`;
  return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

const wantsPage = (request: Request): boolean => (request.headers.get("accept") ?? "").includes("text/html");

async function respond(request: Request, { params }: Context, headOnly: boolean): Promise<Response> {
  const open = await guardOpen(request);
  if (open.denied) return open.denied;
  const visitor = open.visitor;

  const id = (await params).id;
  if (!JOB_ID.test(id)) return new Response("No such run.", { status: 404 });

  const zip = await bgJobZip(id, visitor);
  if (!zip) {
    // A browser opening the link gets a page that waits and then starts the download; anything else gets a plain status.
    if (wantsPage(request) && !headOnly) return waitingPage(id);
    const job = await getBgJob(id, visitor);
    if (!job) return new Response("No such run.", { status: 404 });
    return new Response(job.download === "preparing" ? "The download is still being prepared — try again in a moment." : "There is no download for this run yet.", { status: 409 });
  }

  const safeName = zip.name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").trim() || "download";
  const response = serveFileWithRange(request, zip.path, zip.size, { filename: `${safeName}.background-customised.zip`, modified: zip.modified });
  // A HEAD request (download managers use it to learn the size) gets the same headers and no body.
  if (headOnly) {
    await response.body?.cancel();
    return new Response(null, { status: response.status, headers: response.headers });
  }
  return response;
}

/**
 * Downloads a run's results. The zip was packed ONCE on the server when the run ended, so this just serves a real file: its size
 * is known (a real progress bar), and `Range` / ETag work, so a download that drops part-way resumes instead of failing.
 */
export async function GET(request: Request, context: Context) {
  return respond(request, context, false);
}

export async function HEAD(request: Request, context: Context) {
  return respond(request, context, true);
}
