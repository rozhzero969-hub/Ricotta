export const MAX_IDLE_POLL_MS=60_000;
// Keep open approval forms responsive; empty queues back off to one check per minute.
export function nextPollDelay(previous,busy,activeDelay){
  return busy?activeDelay:Math.min(MAX_IDLE_POLL_MS,Math.max(activeDelay,previous*2));
}
