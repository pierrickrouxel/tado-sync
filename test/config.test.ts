import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("applique les valeurs par défaut", () => {
    const config = loadConfig({ GRDF_USERNAME: "me", GRDF_PASSWORD: "pw" });
    expect(config.cron).toBe("0 10 * * *");
    expect(config.lookbackDays).toBe(30);
    expect(config.runOnStart).toBe(true);
    expect(config.tado.homeId).toBeUndefined();
  });

  it("exige les identifiants GRDF", () => {
    expect(() => loadConfig({ GRDF_USERNAME: "me" })).toThrow(/GRDF_PASSWORD/);
  });

  it("valide les nombres et booléens", () => {
    expect(() => loadConfig({ GRDF_USERNAME: "me", GRDF_PASSWORD: "pw", LOOKBACK_DAYS: "abc" })).toThrow(/LOOKBACK_DAYS/);
    expect(loadConfig({ GRDF_USERNAME: "me", GRDF_PASSWORD: "pw", DRY_RUN: "true", TADO_HOME_ID: "12" })).toMatchObject({
      dryRun: true,
      tado: { homeId: 12 },
    });
  });
});
