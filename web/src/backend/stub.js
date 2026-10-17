// Demo builds use src/demo instead of the in-browser Firebase backend.
export async function localCall() {
  throw new Error('Not available in the demo.');
}
export function startAdminJobs() {}
export function stopAdminJobs() {}
