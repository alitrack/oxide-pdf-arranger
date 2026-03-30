import { describe, expect, test } from "bun:test";
import {
  parseThemePreference,
  resolveThemePreference,
  type ThemePreference,
} from "./theme";

describe("parseThemePreference", () => {
  test("accepts only known theme preference values", () => {
    expect(parseThemePreference("light")).toBe("light");
    expect(parseThemePreference("dark")).toBe("dark");
    expect(parseThemePreference("system")).toBe("system");
    expect(parseThemePreference("unknown")).toBe("system");
    expect(parseThemePreference(null)).toBe("system");
  });
});

describe("resolveThemePreference", () => {
  test("uses the system preference when preference is system", () => {
    expect(resolveThemePreference("system", true)).toBe("dark");
    expect(resolveThemePreference("system", false)).toBe("light");
  });

  test("prefers explicit light and dark modes over the system value", () => {
    const explicitModes: ThemePreference[] = ["light", "dark"];
    expect(explicitModes.map((mode) => resolveThemePreference(mode, true))).toEqual([
      "light",
      "dark",
    ]);
  });
});
