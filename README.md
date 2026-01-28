# @dagger.io/vitest

Vitest reporter with OpenTelemetry support for auto-instrumentation with Dagger.

## Installation

### With Dagger

```bash
dagger toolchain install github.com/dagger/vitest

# Execute vitest through the toolchain (no additional setup needed)
dagger check
```

You can customize vitest using [`customization`](https://docs.dagger.io/core-concepts/toolchains/#customizing-toolchains)

### As a library

If you prefer to directly install the vitest library, run:

```bash
npm install --save-dev @dagger.io/vitest
```

Then set the import in your `NODE_OPTIONS` when executing your tests:

```shell
NODE_OPTIONS="$NODE_OPTIONS --import @dagger.io/vitest/register" npx vitest run
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
        ├─ SELECT * FROM users (inside test span)
        └─ Container.withExec(...) (inside test span)
      └─ test 2 (test span)
```

## License

Apache-2.0
