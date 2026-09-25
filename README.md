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

This module requires Dagger engine `v1.0.0-beta.15` or later.

#### Checks and selection

Projects and their test files are collections: `dagger check` lists one check
per test file, addressed as `vitest/projects/tests/test`, and runs the selected
files of each project together:

```bash
# list what would run
dagger check -l --all

# every project's tests
dagger check --vitest

# one project
dagger check --vitest --vitest-project=packages/web

# some test files of one project
dagger check vitest/projects/tests/test \
  --vitest-project=packages/web \
  --vitest-test-file=src/a.test.ts --vitest-test-file=src/b.test.ts

# the keys of each collection
dagger list vitest-projects
dagger list vitest-test-files --vitest-project=packages/web
```

Each project runs in a single `vitest` invocation. When none of its test files
is selected out, that is a plain `npx vitest`, so Vitest's own config decides
what runs. Otherwise the selected files are passed to Vitest by path.

#### Project discovery

Discovery is anchored at the directory you run Dagger from, not at the workspace
root: `dagger check` tests the project you are in and the projects beneath it. A
project is any directory holding a `vitest.config.*` or `vite.config.*` file
(`node_modules` excluded). Project keys are workspace-root-relative, `.` for a
project at the root.

```bash
# from the workspace root of a monorepo holding a/ and b/
dagger list vitest-projects   # -> a, b

# from a/
dagger list vitest-projects   # -> a
```

A directory holding no config of its own sits inside its enclosing project, so
that project is discovered and runs too. To run a single project, enter it or
select it with `--vitest-project`.

#### Test file discovery

Test files are keyed by their path relative to the project root. They are found
by globbing the workspace with Vitest's default `include`,
`**/*.{test,spec}.?(c|m)[jt]s?(x)`, leaving out `node_modules`, `.git` and the
subtrees of nested projects, so listing runs no container. Static discovery does
not read your Vitest config, so:

- A custom `include` or `exclude` in the config is not seen. Files your config
  adds still run whenever the whole project runs (no test file selected out),
  but cannot be selected on their own; files your config excludes are listed
  and, when selected alone, make Vitest report that it found no test files.
- A project where no file matches the default pattern has no test files to
  check, so `dagger check` does not run it. Call the project's `test` function
  from the API to run it.

Vitest treats file arguments as substring filters, so asking it for
`src/a.test.ts` would also run `src/a.test.tsx` or `lib/src/a.test.ts`. To run
exactly the selection, every other discovered test file whose path contains a
selected path is passed to `--exclude`. Vitest 1.x accepts a single `--exclude`
only, so there a selection that needs more than one fails; Vitest 2 and later
have no such limit.

#### Settings

```toml
[modules.vitest.settings]
# Run the package manager's build script before the tests.
build = true
# Flags to pass to every vitest run.
flags = ["--reporter=verbose"]
# The base image and package manager.
baseImageAddress = "node:25-alpine"
packageManager = "npm"
```

#### Files outside the project

Only the project directory is mounted into the test container. When a test
reads a file that lives outside it — typically a fixture shared with code
elsewhere in a monorepo — list workspace-root patterns in `includeExtraFiles`.
They are mounted at their workspace-relative paths alongside the project, so
relative imports that escape the project directory resolve as they do on disk:

```toml
[modules.vitest.settings]
includeExtraFiles = ["testdata/**", "schema/*.json"]
```

#### Tests that call Dagger

Tests are run with access to the Dagger session running them, so a test using a
Dagger SDK connects to that session rather than provisioning an engine of its
own:

```ts
import { connection, dag } from "@dagger.io/dagger"

test("builds", async () => {
  await connection(async () => {
    expect(await dag.container().from("alpine").withExec(["echo", "hi"]).stdout()).toBe("hi\n")
  })
})
```

Such tests are usually slower than the 5s Vitest allows by default, so raise
`testTimeout` in your Vitest config.

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
