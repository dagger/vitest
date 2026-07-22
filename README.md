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

#### Project discovery

Discovery is anchored at the directory you run Dagger from, not at the workspace
root: `dagger check` tests the project you are in and the projects beneath it. A
project is any directory holding a `vitest.config.*` or `vite.config.*` file
(`node_modules` excluded).

```bash
# from the workspace root of a monorepo holding a/ and b/
dagger call vitest projects   # -> a, b

# from a/
dagger call vitest projects   # -> .
```

A directory holding no config of its own sits inside its enclosing project, so
that project is reported as a `..`-relative path and runs too. To run a single
project, enter it.

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

## Span Attributes

Test spans include `dagger.io/ui.boundary` plus OpenTelemetry test semantic convention attributes: `test.case.name`, `test.case.result.status`, and `test.suite.name`.

Suite spans include `dagger.io/ui.boundary`, `test.suite.name`, and `test.suite.run.status`.

Console output captured by Vitest is also emitted as OpenTelemetry log records associated with the test span, using `stdio.stream` to distinguish stdout and stderr.

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
