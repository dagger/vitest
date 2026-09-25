# @dagger.io/vitest

Vitest reporter with OpenTelemetry support for auto-instrumentation with Dagger.

## Installation

### With Dagger

Requires Dagger engine `v1.0.0-beta.15` or later. That release is not out yet,
so for now this module only loads on a development engine.

```bash
dagger install github.com/dagger/vitest

# run every Vitest project's tests (no additional setup needed)
dagger check
```

#### Checks and selection

Projects and their test files are collections. `dagger check` lists one check
per test file, addressed as `vitest/projects/tests/test`, and runs the selected
files of each project together, in one `vitest` invocation per project:

```bash
# list what would run, one line per test file
dagger check -l --all

# every project's tests
dagger check --vitest

# one project
dagger check --vitest-project=apps/web

# some test files of one project
dagger check vitest/projects/tests/test \
  --vitest-project=apps/web \
  --vitest-test-file=src/a.test.ts --vitest-test-file=src/b.test.ts

# the keys of each collection
dagger list vitest-projects -a
dagger list vitest-test-files -a --vitest-project=apps/web
```

| Flag | Selects |
|---|---|
| `--vitest` | every check of this module |
| `--vitest-project=PATH` | a project, by workspace-root-relative root (repeatable) |
| `--vitest-test-file=PATH` | a test file, by project-relative path (repeatable) |

The key flags are named after the item types, `VitestProject` and
`VitestTestFile`; `dagger check --help` lists the flags in effect.

When none of a project's test files is selected out, the project runs as a
plain `npx vitest`, so Vitest's own config decides what runs. Otherwise the
selected files are passed to Vitest by path.

#### Running from a subdirectory

Discovery is anchored at the directory you run Dagger from, so `cd` selects
projects without any flag:

- at a project root, that project and the projects below it;
- inside a project's subdirectory, that project, plus any project below the
  directory;
- in a directory that belongs to no project, the projects below it.

```bash
# a monorepo holding apps/web and apps/admin
cd apps/web/src && dagger check     # runs apps/web only
cd apps && dagger list vitest-projects -a   # -> apps/admin, apps/web
```

Project keys are workspace-root-relative whatever the directory, `.` for a
project at the root.

#### Discovery

A project is any directory holding a `vitest.config.*` or `vite.config.*`
file, found with `Workspace.findRoots` (`node_modules` excluded). A project
inside another one is a project of its own. Note that a whole run of the outer
project is a plain `npx vitest` there, which also picks up the inner project's
files unless the outer config excludes them.

Test files are keyed by their path relative to the project root. They are
found by one ripgrep search per project with Vitest's default `include`,
`**/*.{test,spec}.?(c|m)[jt]s?(x)`, pruning `node_modules`, `.git` and the
subtrees of nested projects. Listing runs no container. Static discovery does
not read your Vitest config, so:

- A custom `include` or `exclude` in the config is not seen. Files your config
  adds still run whenever the whole project runs (no test file selected out),
  but cannot be selected on their own; files your config excludes are listed
  and, when selected alone, make Vitest report that it found no test files.
- A project where no file matches the default pattern has no test files to
  check, so `dagger check` does not run it. Call the project's `test` function
  from the API to run it.
- Empty files are not listed.

Vitest treats file arguments as substring filters, so asking it for
`src/a.test.ts` would also run `src/a.test.tsx` or `lib/src/a.test.ts`. To run
exactly the selection, every other discovered test file whose path contains a
selected path is passed to `--exclude`. Vitest 1.x accepts a single `--exclude`
only, so there a selection that needs more than one fails; Vitest 2 and later
have no such limit.

#### Settings

Settings live in the workspace `dagger.toml`, or can be set with
`dagger settings vitest <name> <value>`:

```toml
[modules.vitest.settings]
# Run the package manager's build script before the tests. Default: false.
build = true
# Flags to pass to every vitest run. Default: [].
flags = ["--reporter=verbose"]
# The base image. Default: "node:25-alpine".
baseImageAddress = "node:25-alpine"
# The package manager: npm, yarn or pnpm. Default: "npm".
packageManager = "npm"
# Extra files mounted next to the project (see below). Default: [].
includeExtraFiles = []
```

#### Using it from another module

`projects(ws)` returns the project collection. Collections expose `keys`,
`get(key:)`, `subset(keys:)` and `batch`; each project's `tests(ws)` is the
test-file collection. A check called through a dependency comes back as a
`Check` that has not run yet, so wrap it:

```dang
let run(check: Check!): Void {
  if (check.pass == false) {
    raise check.error.message ?? "check failed"
  }
  null
}

testWeb(ws: Workspace!): Void @check {
  let projects = vitest.projects(ws)
  # every project, as a plain function
  projects.batch.test(ws)
  # one project's selected test files
  let tests = projects.get(key: "apps/web").tests(ws)
  run(tests.subset(keys: ["src/a.test.ts"]).batch.test(ws))
  # a single test file
  run(tests.get(key: "src/a.test.ts").test(ws))
}
```

`vitest.project(ws, path)` looks a project up by its root, relative to the
workspace cwd. A project also has `list(ws)` (`vitest list` output) and
`source(ws)`.

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

or `dagger settings vitest includeExtraFiles '["testdata/**", "schema/*.json"]'`.

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
