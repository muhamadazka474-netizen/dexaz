/**
 * Marker endpoint used ONLY by dexaz-loading.html to detect that the
 * REAL DEXAZ frontend (not some unrelated app that happens to be
 * listening on the same port) is up and ready.
 *
 * Why this exists: the loading page used to consider the frontend
 * "ready" the instant ANY HTTP response came back from
 * http://127.0.0.1:<port>/ using `fetch(..., { mode: "no-cors" })`.
 * In `no-cors` mode the response is opaque - the script can't read the
 * status code or body, only whether the request failed to connect at
 * all. That means if a completely unrelated local app/service happens
 * to be listening on the same port when DEXAZ starts (a startup race:
 * Resolve-PortOrShift in run-dexaz.ps1 only checks the port is free
 * BEFORE launching `npm run dev`; something else can still grab it in
 * the few seconds it takes Next.js to actually bind), the loading page
 * would treat that unrelated app's response - even a plain 404 - as
 * "DEXAZ frontend is ready" and redirect straight into it. That's what
 * produces symptoms like "Cannot GET /login" (a generic Node/Express
 * 404, not Next.js's own 404 page) together with a strict
 * `Content-Security-Policy: default-src 'none'` that isn't set anywhere
 * in this codebase - it belongs to whatever other app answered.
 *
 * This route returns a small JSON marker that only DEXAZ's own Next.js
 * server will ever produce. The loading page now does a real (non
 * no-cors) fetch and checks BOTH that the request succeeded AND that
 * the JSON marker matches before considering the frontend ready -
 * see dexaz-loading.html.
 *
 * Access-Control-Allow-Origin is intentionally permissive here: this
 * endpoint returns no sensitive data (just a static marker) and only
 * exists so the loading page (served from a different origin/port,
 * e.g. http://localhost:4321) can read the response. It has no effect
 * on the CORS policy for the rest of the app / API.
 */
export async function GET() {
  return new Response(
    JSON.stringify({ app: "dexaz-frontend", ok: true }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
      },
    }
  );
}
