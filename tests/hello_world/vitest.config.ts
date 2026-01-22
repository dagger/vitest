import { defineConfig } from "vitest/config";
import DaggerReporter from "@dagger.io/vitest"

export default defineConfig({
  test: {
    reporters: ["default", new DaggerReporter()]
  },
});
