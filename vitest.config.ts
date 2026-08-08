import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"]
    }
  }
});

