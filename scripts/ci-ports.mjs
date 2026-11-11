// Select an unused port group before Supabase starts. Emit only the Actions environment assignment.
import { createServer } from "node:net";
import { getPorts } from "./ports.mjs";

function available(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen({ host: "0.0.0.0", port, exclusive: true }, () => server.close(() => resolve(true)));
  });
}

export async function selectCiSlot(check = available) {
  for (let slot = 0; slot <= 99; slot++) {
    const p = getPorts(slot);
    const ports = [p.web, p.api, ...Object.values(p.supabase)];
    if ((await Promise.all(ports.map(check))).every(Boolean)) return slot;
  }
  throw new Error("No free CI port group available.");
}

if (import.meta.main) {
  console.log(`PICKS_PORT_SLOT=${await selectCiSlot()}`);
}
