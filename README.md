# @dagger.io/vitest

Vitest reporter with OpenTelemetry support for auto-instrumentation with Dagger.

## Installation

### With Dagger

Requires Dagger v1.0.0-beta.22 or later.

```bash
dagger install github.com/dagger/vitest

# run every Vitest project's tests (no additional setup needed)
dagger check
```

#### Checks and selection

Projects, their test files and each file's tests are collections. `dagger
check` lists one check per test, addressed as
`vitest/projects/test-files/tests/test`:

```bash
# list what would run, one line per test (runs no container)
dagger check -l --all

# every project's tests
dagger check --vitest

# the test check by name (the same thing, alongside other modules' test checks)
dagger check --check test

# one project
dagger check --vitest-project=apps/web

# some test files of one project
dagger check --vitest-project=apps/web \
  --vitest-test-file=src/a.test.ts --vitest-test-file=src/b.test.ts

# a single test, by the full name `vitest list` prints after the file path
dagger check --vitest-test='the sum > adds two numbers'

# the keys of each collection
dagger list vitest-projects -a
dagger list vitest-test-files -a --vitest-project=apps/web
dagger list vitest-tests -a --vitest-test-file=src/a.test.ts
```

| Flag | Selects |
|---|---|
| `--vitest` | every check of this module |
| `--check test` | checks named `test`, in every installed module |
| `--vitest-project=PATH` | a project, by workspace-root-relative root (repeatable) |
| `--vitest-projects` | every project |
| `--vitest-test-file=PATH` | a test file, by project-relative path (repeatable) |
| `--vitest-test-files` | every test file |
| `--vitest-test=NAME` | a test, by full name, or `*` (repeatable) |
| `--vitest-tests` | every test |

The key flags are named after the item types, `VitestProject`,
`VitestTestFile` and `VitestTest`; `dagger check --help` lists the flags in
effect. A test-file path or a test name selects it in every project or file
that has it; `--vitest-project` and `--vitest-test-file` narrow that.

#### Test names, and `*`

Listing never runs Vitest, so a file's tests are read from its source. A
test is keyed by its full name as `vitest list` prints it: the names of its
enclosing `describe`/`suite` calls and its own, joined by ` > `
(`describe('the sum', () => { it('adds two numbers') })` is
`the sum > adds two numbers`). A test gets a key of its own only when its name
is a string literal and every scope around it is the file's top level, the
callback of a named suite, or a plain `{}` block in one of those. `it`, `test`, `.only`, `.concurrent`,
`.sequential`, `.shuffle`, `.fails`, `.skipIf(...)` and `.runIf(...)` are
read; `.skip` and `.todo` tests are not keys.

Some tests are named only at runtime, and get no key of their own:

- `.each` and `.for` rows;
- tests made by a `test.extend` fixture;
- tests whose name is not a literal;
- tests declared in a helper function or another callback, or under a
  condition: `if`/`else`, a loop, `try`/`catch`, `switch`, a ternary or a
  `&&`/`||` expression (whether they register at all depends on the run);
- every test under a suite that is not named.

A file with any such test gets one more key, `*`, standing for exactly the
file's tests its source does not name. A file whose source names no test has
only `*`. `*` is a check like any other: it fails when any of those tests
fails, and passes when none does (or none ran).

#### One run per project

Each selected test has its own check, but all the checks of a project share
one `vitest` run: every check hands the same selection to the same helper,
which builds a byte-identical command, so the engine runs it once. Separate
projects have separate runs, with their own install and container.

- With nothing selected out of a project (no test file and no test removed
  by the selection), the run is a plain `vitest`, so the project's own config
  decides what runs, as on the command line.
- Otherwise the selected test files are passed by path, and when tests are
  selected out too, one anchored `--testNamePattern` matches the selected
  names, their parts escaped and joined by spaces as Vitest joins them (so a
  name holding regexp characters matches only itself).
  A selected `*` adds a negative lookahead matching every name that is not
  one of its file's static names. Test files with no selected test are left
  out. Vitest matches file arguments as substrings (so `src/a.test.ts` would
  also run `src/a.test.tsx` or `lib/src/a.test.ts`), so every other
  discovered test file with the same file name is removed from the container
  first. This holds whatever `include`/`exclude` the Vitest config or its
  inline projects set.

The run writes Vitest's JSON report (`--reporter=json`, next to
`--reporter=default` unless `flags` names reporters of its own), and one
indexing step, in a pinned image, reads it once and writes a bounded result
per check; each check reads only its own. How results are attributed:

- A selected named test that fails fails its own check only.
- A test the source does not name that fails fails its file's `*` check
  when that is selected, and otherwise every selected check of its file.
- A file that fails outside its tests (it does not load, or a hook such as
  `afterAll` throws) fails every selected check in that file.
- A failure in a test file without selected checks (possible when the whole
  project runs: a file the config adds in a form discovery does not read,
  say), an error Vitest reports outside any test file (an unhandled error, a
  config that does not load), or no report at all, fails every check of the
  run.
- A failed install or build step fails every check of that project, naming
  the step. Other projects are unaffected.
- A selected named test the report does not show at all fails as not run
  rather than passing: Vitest left it out of the file (its source names it
  but it never registers, say after an early `return`), or never ran its
  file. A test the report shows in any state was observed: one Vitest skips
  (another test's `.only`, `skipIf`, `runIf`, `ctx.skip()`) passes. With
  `--bail` in `flags`, tests that never started after a reported failure
  are not blamed for it.

Messages keep the last 32 KiB of each diagnostic and mark what they cut.
Logs and test spans belong to the check that starts the shared run; the
other checks share its result. A run is cached like any other container
operation: running unchanged tests again reuses the previous result.

The collections also have plain functions, which are not checks:
`VitestProjects.test(ws)` runs every project, `VitestTestFiles.test(ws)` a
project's selected files in one `vitest` invocation, `VitestTests.test(ws)`
a file's selected tests, and `VitestTestFile.test(ws)` one file. There is no
`.batch` namespace.

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
subtrees of nested projects, and their tests are read from each file (see
above). Listing runs no container: no install, no Vitest. A Vitest config is
code, so it is not evaluated; only the common form that extends Vitest's
defaults is read from the project's own config file, for the string
literals it lists:

```ts
include: [...configDefaults.include, 'checks/**/*.ts'],   // adds these files
exclude: [...configDefaults.exclude, 'e2e/**'],           // leaves these out
```

- Any other `include` or `exclude` is not seen. Files it adds still run
  whenever the whole project runs, and a failure in them fails every check
  of the run, but they have no checks of their own; a file it excludes still
  gets checks, which fail saying Vitest did not run it.
- A project where no file matches has no test files to check, so `dagger
  check` does not run it. Call the project's `test` function from the API
  to run it.
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
  `patches/`, the directories of `file:`/`link:`/`portal:` dependencies and
  injected workspace packages, which the install copies, and the files
  packages name as `bin`, so their commands get linked); the rest of the
  source (minus `.gitignore`d files) is added afterwards, so editing source
  does not re-run the install. npm, pnpm, yarn
  and bun caches and `COREPACK_HOME` are on cache volumes (the pnpm store is
  passed with `--store-dir`, which pnpm 12 requires). A `postinstall`
  that needs other source files fails at this step; pass
  `installFlags = ["--ignore-scripts"]` if the tests don't need it.
- Browsers: Puppeteer's Chrome download on install is left on (Vitest's
  browser mode can use it) and its directory, `~/.cache/puppeteer`, is on a
  cache volume, so it happens once. Playwright downloads nothing on install;
  for browser-mode tests with the Playwright provider, use a base image that
  ships its browsers (e.g. `baseImageAddress = "mcr.microsoft.com/playwright:<version>"`)
  or install them in your `build` script; `~/.cache/ms-playwright` is on a
  cache volume too, so that download also happens once. Cypress's binary download and git hook installers
  (husky, simple-git-hooks) are switched off.
- Vitest runs from the project's own `node_modules/.bin/vitest` (looked up
  from the project to the install root, or through yarn under Plug'n'Play). A
  project with a `package.json` but no vitest installed fails with a message
  saying so; only a project with no `package.json` at all runs `npx vitest`.
- The OpenTelemetry reporter is loaded with `NODE_OPTIONS=--import`; nothing is
  added to your dependencies. It loads what its exporter needs up front, so
  tests that delete globals such as `ReadableStream` or `fetch` don't break
  the export.

A failure names the project and the step, with the end of its output, e.g.
`Vitest project apps/web: install failed (pnpm install --store-dir /root/.pnpm-store, exit 1): ...` or
`Vitest project apps/web: vitest failed (exit 1): ...`.

#### Settings

Settings live in the workspace `dagger.toml`, or can be set with
`dagger settings vitest <name> <value>` and removed with
`dagger settings -u vitest <name>`:

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
`get(key:)` and `subset(keys:)`; each project's `testFiles(ws)` is the
test-file collection, and each test file's `tests` is its test collection.
The collection-level `test` functions and `VitestTestFile.test(ws)` are
plain functions. A test's own `test` is the check: it takes the project's
test-file collection as `selection` (`dagger check` fills it in, filtered),
and a check called through a dependency comes back as a `Check` that has
not run yet, so wrap it:

```dang
let run(check: Check!): Void {
  if (check.pass == false) {
    raise check.error.message ?? "check failed"
  }
  null
}

testWeb(ws: Workspace!): Void @check {
  let projects = vitest.projects(ws)
  # every project
  projects.test(ws)
  # one project's selected test files, in one vitest invocation
  let files = projects.get(key: "apps/web").testFiles(ws)
  files.subset(keys: ["src/a.test.ts"]).test(ws)
  # a single test file
  let file = files.get(key: "src/a.test.ts")
  file.test(ws)
  # selected tests of that file
  file.tests.subset(keys: ["the sum > adds two numbers"]).test(ws)
  # a single test's check, sharing one run of the files it is handed
  run(file.tests.get(key: "the sum > adds two numbers").test(ws, selection: files.subset(keys: ["src/a.test.ts"])))
}
```

Called directly like this, a test check sees no selection: it runs the
files in `selection` with every one of their tests, by name, and reports
its own result.

`vitest.project(ws, path)` looks a project up by its root, relative to the
workspace cwd. A project also has `list(ws)` (`vitest list` output, failing
when Vitest reports collection errors) and `source(ws)`. From the CLI:

```bash
dagger call vitest project --path=apps/web list
```

To run tests, use `dagger check` (in CI too): `dagger call` on a check
function does not fail the command when the check fails.

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

Tests are run with access to the engine running them, so a test using a Dagger
SDK reaches that engine rather than provisioning one of its own:

```ts
import { connection, dag } from "@dagger.io/dagger"

test("builds", async () => {
  await connection(async () => {
    expect(await dag.container().from("alpine").withExec(["echo", "hi"]).stdout()).toBe("hi\n")
  })
})
```

Each connection opens its own session rather than joining the one running
Vitest, and the workspace's `.git` is mounted, so a test sees the same workspace
it would on your machine. That is what lets a **generated module client** work:

```ts
import { dag } from "@dagger.io/my-module"

test("the module answers", async () => {
  await connection(async () => {
    expect(await dag.myModule().greeting("vitest")).toBe("Hello, vitest!")
  })
})
```

A client serves its module by workspace address before its first query, which
needs a workspace, which is found by walking up to a `.git` directory. Joining
Vitest's own session instead would resolve that address against *this* module
and fail.

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
