// Opens Cat Cams in a browser once `npm start` is serving.
//
// This lives outside the stack on purpose. `npm start` runs `docker compose up`
// alongside a `sass --watch`, and containers restart on their own — an opener
// wired into the stack would spawn a new tab each time. Run once per
// `npm start` instead, and exit as soon as the port answers.
//
// Set OPEN_BROWSER=0 to skip.

import { spawn } from "node:child_process";

const PORT = process.env.PORT || "54999";
const URL = `http://localhost:${PORT}/`;
const TIMEOUT_MS = 90000; // docker compose can pull or build before nginx listens
const POLL_MS = 500;

if (process.env.OPEN_BROWSER === "0") process.exit(0);

const opener =
  process.platform === "darwin" ? ["open", [URL]]
  : process.platform === "win32" ? ["cmd", ["/c", "start", "", URL]]
  : ["xdg-open", [URL]];

// Any HTTP response means nginx is up — a 403 or a 404 counts just as much as
// a 200. Only a connection failure means "not yet".
async function isUp() {
  try {
    await fetch(`${URL}health`, { signal: AbortSignal.timeout(POLL_MS * 2) });
    return true;
  } catch {
    return false;
  }
}

const deadline = Date.now() + TIMEOUT_MS;
while (Date.now() < deadline) {
  if (await isUp()) {
    spawn(opener[0], opener[1], { stdio: "ignore", detached: true }).unref();
    process.exit(0);
  }
  await new Promise((r) => setTimeout(r, POLL_MS));
}

console.warn(`[open] Stack did not answer within ${TIMEOUT_MS / 1000}s; open ${URL} yourself.`);
