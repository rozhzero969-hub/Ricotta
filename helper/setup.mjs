// One-time setup on Rozha's Mac: `node helper/setup.mjs`.
// Asks for the Ricotta Restaurant sign-in (typed by Rozha, never shown) and keeps it in the Keychain,
// makes Rico's own API token, keeps it in the Keychain and gives it to the Ricotta Orders API as the
// RICO_HELPER_TOKEN secret (with the Supabase command line, which must already be signed in).
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { createInterface } from "node:readline";
import { readSecret, saveSecret } from "./keychain.mjs";

const PROJECT = "pxufdcyqjtmtklmrjodg";
function ask(question, hidden = false) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) rl._writeToOutput = (s) => { if (s.includes(question)) process.stdout.write(question); };
    rl.question(question, (a) => { rl.close(); if (hidden) process.stdout.write("\n"); resolve(a.trim()); });
  });
}

// `node helper/setup.mjs --launcher`: installs Rico's launcher, which macOS starts at every login, so the
// Start Rico, Practice mode and Stop Rico buttons in the app and on Telegram work without Terminal.
if (process.argv.includes("--launcher")) {
  const { writeFileSync, mkdirSync, realpathSync } = await import("node:fs");
  const { dirname, join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const here = dirname(fileURLToPath(import.meta.url));
  const plist = join(homedir(), "Library", "LaunchAgents", "com.ricotta.rico-launcher.plist");
  const logs = join(homedir(), "Library", "Logs");
  mkdirSync(dirname(plist), { recursive: true }); mkdirSync(logs, { recursive: true });
  const x = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  writeFileSync(plist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.ricotta.rico-launcher</string>
  <key>ProgramArguments</key><array><string>${x(realpathSync(process.execPath))}</string><string>${x(join(here, "launcher.mjs"))}</string></array>
  <key>WorkingDirectory</key><string>${x(dirname(here))}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${x(join(logs, "RicoLauncher.log"))}</string>
  <key>StandardErrorPath</key><string>${x(join(logs, "RicoLauncher.log"))}</string>
</dict></plist>
`);
  const uid = process.getuid();
  try { execFileSync("/bin/launchctl", ["bootout", `gui/${uid}`, plist], { stdio: "ignore" }); } catch {}
  execFileSync("/bin/launchctl", ["bootstrap", `gui/${uid}`, plist], { stdio: "ignore" });
  console.log("Rico's launcher is installed and running. It starts by itself whenever you log in.\nUse Start Rico, Practice mode and Stop Rico in the app's Receipts tab or in Telegram.");
  process.exit(0);
}
console.log("Rico setup. What you type for the password and PIN is not shown and is kept only in this Mac's Keychain.\n");
const user = await ask("Ricotta Restaurant username: ");
const pass = await ask("Ricotta Restaurant password: ", true);
const pin = await ask("Ricotta Restaurant PIN (Enter to skip): ", true);
if (!user || !pass) { console.log("A username and password are needed. Nothing was saved."); process.exit(1); }
saveSecret("rr-username", user);
saveSecret("rr-password", pass);
if (pin) saveSecret("rr-pin", pin);

if (!readSecret("helper-token") || process.argv.includes("--new-token")) {
  const token = randomBytes(32).toString("hex");
  const cli = [`${homedir()}/.local/bin/supabase`, "/opt/homebrew/bin/supabase", "/usr/local/bin/supabase"].find((p) => existsSync(p));
  if (!cli) { console.log("The Supabase command line was not found, so Rico's token could not be sent. Nothing changed."); process.exit(1); }
  execFileSync(cli, ["secrets", "set", `RICO_HELPER_TOKEN=${token}`, "--project-ref", PROJECT], { stdio: "ignore" });
  saveSecret("helper-token", token);
  console.log("Rico's token is made and sent to Ricotta Orders.");
}
console.log("Done. Start Rico with: node helper/rico-helper.mjs");
