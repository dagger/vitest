# @dagger.io/vitest

Vitest reporter with OpenTelemetry support for auto-instrumentation with Dagger.

## Installation

### With Dagger

```bash
dagger toolchain install github.com/dagger/vitest

dagger check
```

### As a library

```bash
npm install --save-dev @dagger.io/vitest
```

## Usage

You can either set the flag `--reporter=@dagger.io/vitest` or update your vitest config file to use the reporter:

```typescript
import { defineConfig } from "vitest/config";
import DaggerReporter from "@dagger.io/vitest";

export default defineConfig({
  test: {
    reporters: [
      "default", // Keep the default reporter for console output
      new OtelReporter(), // add `as any` if you got a typing issue
    ],
  },
});
```

That's it! The reporter will automatically create OpenTelemetry spans for:

- **Test files** (modules)
- **Test suites** (describe blocks)
- **Individual tests** (it/test blocks)

## Span Hierarchy

```
test-file.ts (module span)
  └─ describe block (suite span)
      ├─ test 1 (test span)
      └─ test 2 (test span)
```

## License

Apache-2.0
