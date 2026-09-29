import { describe, expect, it } from "vitest";
import { fetchAvisoList } from "../src/senamhiList.js";
import { fetchAvisoMap } from "../src/senamhiWfs.js";

describe.skipIf(process.env.RUN_LIVE !== "1")(
  "fuentes oficiales en vivo",
  () => {
    it("lista al menos un aviso activo y su WFS responde", async () => {
      const rows = await fetchAvisoList();
      const active = rows.find(
        (row) => row.status === "emitido" || row.status === "vigente",
      );
      expect(active).toBeDefined();
      let found = false;
      for (const mapa of [1, 2, 3]) {
        if (await fetchAvisoMap(active!.nro, mapa, active!.year)) {
          found = true;
          break;
        }
      }
      expect(found).toBe(true);
    }, 45_000);
  },
);
