import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { withLocalWeb } from "../src/localWeb";

const app = () => new Hono().get("/api/config", (c) => c.json({ ok: true }));
describe("Expo local browser access", () => {
  it("allows the selected LAN origin and localhost equivalent including auth preflight", async () => {
    for (const origin of ["http://192.168.1.2:8082", "http://localhost:8082", "http://127.0.0.1:8082"]) {
      const response = await withLocalWeb(app(), "http://192.168.1.2:8082").request("/api/config", {
        method: "OPTIONS",
        headers: {
          Origin: origin,
          "Access-Control-Request-Method": "PUT",
          "Access-Control-Request-Headers": "authorization,content-type",
        },
      });
      expect(response.status).toBe(204);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin);
      expect(response.headers.get("Access-Control-Allow-Headers")).toContain("Authorization");
    }
  });
  it("does not permit other origins or ports", async () => {
    for (const origin of ["https://example.com", "http://localhost:8083"]) {
      const response = await withLocalWeb(app(), "http://192.168.1.2:8082").request("/api/config", {
        headers: { Origin: origin },
      });
      expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    }
  });
  it("does not add cross-origin access to the ordinary API", async () => {
    const response = await withLocalWeb(app()).request("/api/config", {
      headers: { Origin: "http://localhost:8082" },
    });
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});
