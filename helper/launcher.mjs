// Rico's launcher on Rozh's Mac: started by macOS when she logs in (see setup.mjs --launcher), it waits
// for "Start Rico", "Practice mode" or "Stop Rico" from the app or Telegram, starts or stops Rico
// (rico-helper.mjs) in that mode, and reports how it went. No Terminal window is needed.
// What Rico prints goes to ~/Library/Logs/Rico.log.
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { readSecret } from "./keychain.mjs";

const API = "https://pxufdcyqjtmtklmrjodg.supabase.co/functions/v1/api";
const HERE = dirname(fileURLToPath(import.meta.url));
const LOG = createWriteStream(join(homedir(), "Library", "Logs", "Rico.log"), { flags: "a" });
const note = (s) => LOG.write(`${new Date().toISOString()} ${s}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let child = null, mode = null;
const token = () => readSecret("helper-token");
async function call(body, ms) {
  const t = token();
  if (!t) return null;
  try {
    const res = await fetch(`${API}/helper/launcher`, { method: "POST", headers: { "content-type": "application/json", "x-helper-token": t },
      body: JSON.stringify({ running: !!child, mode, ...body }), redirect: "error", signal: AbortSignal.timeout(ms) });
    return res.ok ? await res.json() : null;
  } catch { return null; }
}
/* How a start or stop went goes to the server at once (the app and Telegram hear it straight away),
   on its own request, so it never waits behind the long wait for the next command. */
async function report(text) {
  note(text);
  for (let i = 0; i < 5; i++) { if (await call({ result: text, take: false }, 15_000)) return; await sleep(2000); }
}

function start(m) {
  mode = m;
  const label = m === "practice" ? "Rico (practice mode, nothing is saved)" : "Rico";
  const me = spawn(process.execPath, [join(HERE, "rico-helper.mjs"), ...(m === "practice" ? ["--practice"] : [])], { cwd: dirname(HERE), stdio: ["ignore", "pipe", "pipe"] });
  child = me;
  // Keep the Mac awake while Rico is running. macOS releases the assertion when his process exits.
  me.once("spawn", () => {
    const awake = spawn("/usr/bin/caffeinate", ["-i", "-w", String(me.pid)], { stdio: "ignore", detached: true });
    awake.on("error", (e) => note("caffeinate: " + e.message));
    awake.unref();
  });
  let ready = false, lastLine = "";
  const timer = setTimeout(() => {
    if (!ready && child === me && !me.stopping) report(`${label} started, but the lists haven't loaded after 2 minutes. Check the Mac.`);
  }, 120_000);
  const read = (line) => {
    if (!line) return;
    LOG.write(line + "\n");
    lastLine = line;
    if (child !== me || me.stopping) return;
    const ok = line.match(/read (\d+) items, (\d+) suppliers, (\d+) zones/);
    if (ok && !ready) {
      ready = true;
      clearTimeout(timer);
      report(`${label} is on: signed in to Ricotta Restaurant and read ${ok[1]} items, ${ok[2]} suppliers and ${ok[3]} zones.`);
    } else if (!ready && /Could not read the lists|not set up|did not accept|could not sign in/i.test(line)) {
      report(`${label} couldn't load: ${line.replace(/^\S+ \S+ /, "")}`);
    }
  };
  for (const input of [me.stdout, me.stderr]) createInterface({ input, crlfDelay: Infinity }).on("line", read);
  const finish = () => {
    clearTimeout(timer);
    if (child !== me) return false;
    child = null;
    mode = null;
    return !me.stopping;
  };
  me.on("error", (error) => {
    if (me.pid) { note("Rico process: " + error.message); return; }
    if (finish()) report(`${label} couldn't start: ${error.message}`);
  });
  me.on("exit", (code) => {
    if (finish()) report(`Rico stopped by himself${code ? ` (${lastLine.slice(0, 200)})` : ""}.`);
  });
}
function stop() {
  return new Promise((done) => {
    if (!child) return done();
    const me = child;
    me.stopping = true;
    const timer = setTimeout(() => { if (child === me) me.kill("SIGKILL"); }, 15_000);
    const stopped = () => {
      clearTimeout(timer);
      me.off("exit", stopped);
      me.off("close", stopped);
      done();
    };
    me.once("exit", stopped);
    me.once("close", stopped);
    me.kill("SIGINT");
  });
}

// The launcher itself being stopped (log out, restart, an update) stops Rico with it.
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, async () => { await stop(); process.exit(0); });
note("launcher started");
for (;;) {
  // Waits up to 20 s on the server, which answers the moment Start or Stop is pressed.
  const answer = await call({ wait: 20 }, 35_000);
  if (!answer) { await sleep(3000); continue; }
  const cmd = answer.command;
  if (cmd === "stop") { await stop(); report("Rico is off."); }
  else if (cmd === "real" || cmd === "practice") {
    if (child && mode === cmd) report(`Rico is already on${cmd === "practice" ? " in practice mode" : ""}.`);
    else { await stop(); start(cmd); }
  }
}
