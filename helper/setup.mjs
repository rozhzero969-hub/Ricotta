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
