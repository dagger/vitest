# @dagger.io/vitest

Vitest reporter with OpenTelemetry support for auto-instrumentation with Dagger.

## Installation

### With Dagger

Requires Dagger v1.0.0-beta.15 or later.

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

# the test check by name (the same thing, alongside other modules' test checks)
dagger check --check test

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
| `--check test` | checks named `test`, in every installed module |
| `--vitest-project=PATH` | a project, by workspace-root-relative root (repeatable) |
| `--vitest-projects` | every project |
| `--vitest-test-file=PATH` | a test file, by project-relative path (repeatable) |
| `--vitest-tests` | every test file |

The key flags are named after the item types, `VitestProject` and
`VitestTestFile`; `dagger check --help` lists the flags in effect.

When none of a project's test files is selected out, the project runs as a
plain `vitest`, so Vitest's own config decides what runs. Otherwise only the
selected files run: they are passed to Vitest by path, and because Vitest
matches file arguments as substrings (so `src/a.test.ts` would also run
`src/a.test.tsx` or `lib/src/a.test.ts`), every other discovered test file with
the same file name is removed from the container first. This holds whatever
`include`/`exclude` the Vitest config or its inline projects set.

If the Vitest config defines projects you don't want to run in a container,
such as browser or e2e projects, name the ones to run with Vitest's `--project`
flag:

```toml
[modules.vitest.settings]
flags = ["--project", "unit*"]
```

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
project is a plain `vitest` there, which also picks up the inner project's
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

#### Installing dependencies

Each project is installed from its install root: the nearest enclosing
workspace root (a directory with `pnpm-workspace.yaml`, or a `package.json`
with `"workspaces"`), else the nearest directory with a lockfile, else the
nearest `package.json`. That directory is mounted, dependencies are installed
there, and Vitest runs with the project directory as its working directory, so
`workspace:` and `catalog:` dependencies resolve.

- The package manager comes from the install root's `package.json`
  `"packageManager"` field, else its lockfile (`pnpm-lock.yaml` or
  `pnpm-workspace.yaml`, `yarn.lock`, `bun.lock`/`bun.lockb`, otherwise npm),
  unless the `packageManager` setting names one. pnpm and yarn run through
  corepack, which is installed when the image lacks it (as `node:25` images
  do) and honours the field's version.
- The install sees only the files it reads (every `package.json`, lockfiles,
  `pnpm-workspace.yaml`, `.npmrc`, `.yarnrc*`, `.yarn/{releases,plugins,patches}`,
  `patches/`); the rest of the source (minus `.gitignore`d files) is added
  afterwards, so editing source does not re-run the install. npm, pnpm, yarn
  and bun caches and `COREPACK_HOME` are on cache volumes. A `postinstall`
  that needs other source files fails at this step; pass
  `installFlags = ["--ignore-scripts"]` if the tests don't need it.
- Browser downloads (Playwright, Puppeteer) are left on, since Vitest may run
  browser tests; Cypress's binary download and git hook installers (husky,
  simple-git-hooks) are switched off.
- Vitest runs from the project's own `node_modules/.bin/vitest` (looked up
  from the project to the install root, or through yarn under Plug'n'Play). A
  project with a `package.json` but no vitest installed fails with a message
  saying so; only a project with no `package.json` at all runs `npx vitest`.
- The OpenTelemetry reporter is loaded with `NODE_OPTIONS=--import`; nothing is
  added to your dependencies.

A failure names the project and the step, with the end of its output, e.g.
`Vitest project apps/web: install failed (pnpm install, exit 1): ...` or
`Vitest project apps/web: vitest failed (exit 1): ...`.

#### Settings

Settings live in the workspace `dagger.toml`, or can be set with
`dagger settings vitest <name> <value>`:

```toml
[modules.vitest.settings]
# The package manager: npm, pnpm, yarn or bun. Default: "" (detect).
packageManager = "pnpm"
# Flags appended to the install command. Default: [].
installFlags = ["--ignore-scripts"]
# Environment variables for the install and the tests, as KEY=VALUE. Default: [].
environment = ["TZ=UTC", "NODE_ENV=test"]
# Run the package manager's build script before the tests. Default: false.
build = true
# Flags to pass to every vitest run, and to `list`. Default: [].
flags = ["--reporter=verbose"]
# The base image. Default: "node:25-alpine".
baseImageAddress = "node:25-alpine"
# Extra workspace files mounted at their paths (see below). Default: [].
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
workspace cwd. A project also has `list(ws)` (`vitest list` output, failing
when Vitest reports collection errors) and `source(ws)`. From the CLI:

```bash
dagger call vitest project --path=apps/web list
```

#### Files outside the project

Only the project's install root is mounted into the test container. When a
test reads a file that lives outside it — typically a fixture shared with code
elsewhere in a monorepo — list workspace-root patterns in `includeExtraFiles`.
They are mounted at their workspace-relative paths, so relative imports that
escape the install root resolve as they do on disk:

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
