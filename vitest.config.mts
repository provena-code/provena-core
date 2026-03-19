import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    environment: "node",   // or "jsdom" if you need DOM APIs
    include: ["src/**/*.test.ts"], // adjust paths
    silent: false,
    printConsoleTrace: false,
  },
});
