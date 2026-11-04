// Rico's secrets live in the Mac's Keychain (service "ricotta-rico"), never in a file, the app or a
// message: the helper's own token for the Ricotta Orders API, and how to sign in to Ricotta Restaurant.
import { execFileSync } from "node:child_process";

const SERVICE = "ricotta-rico";
export function readSecret(name) {
  try {
    return execFileSync("/usr/bin/security", ["find-generic-password", "-s", SERVICE, "-a", name, "-w"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}
export function saveSecret(name, value) {
  execFileSync("/usr/bin/security", ["add-generic-password", "-U", "-s", SERVICE, "-a", name, "-w", value], { stdio: "ignore" });
}
