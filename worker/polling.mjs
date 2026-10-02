// How the worker waits for work. Instead of asking every minute, it asks the server one question that is
// held open until there is something to do (worker/wait, up to ~25 s), so new work starts within a second.
// While a form waits on the PC for its final approval, it checks every POLL_SECONDS instead.
export const WAIT_TIMEOUT_MS=35_000;    // a little longer than the server holds the question open
export const WAIT_FAIL_DELAY_MS=5_000;  // server unreachable: try again after this, never in a tight loop
export const HEARTBEAT_MS=90_000;       // health report when nothing changes (the wait also marks the worker online)

/* One idle turn. Returns true when the server says there is work (check the queue now). */
export async function waitForWork(ask,sleep){
  try{return (await ask())?.work===true}
  catch{await sleep(WAIT_FAIL_DELAY_MS);return false}
}
