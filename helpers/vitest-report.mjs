// vitest-report reads the JSON report of one shared Vitest run and writes a
// bounded failure message (or an empty, passing result) for each selected
// test check, at <output>/<file index>/<test index>. The indices are
// positions in the selection, which the module sorts before writing it, so
// test names and file paths never become file names.
//
// A selected file lists its selected names and its static names (every name
// its source gives a test). The name "*" stands for the file's other tests:
// every test the report shows in the file that is not one of its static
// names.
//
// It runs with node or bun and needs nothing beyond their standard library.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const diagnosticLimit = 32 << 10;
const resultLimit = 3 * diagnosticLimit;

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) throw new Error(`unexpected argument ${arg}`);
    const eq = arg.indexOf("=");
    if (eq >= 0) {
      out[arg.slice(2, eq)] = arg.slice(eq + 1);
    } else {
      out[arg.slice(2)] = argv[++i];
    }
  }
  return out;
}

// The last diagnosticLimit bytes of a text, marked when cut.
function tail(text) {
  const bytes = Buffer.from(text ?? "");
  if (bytes.length <= diagnosticLimit) return bytes.toString();
  return (
    "[earlier output omitted; showing diagnostic tail]\n" +
    bytes.subarray(bytes.length - diagnosticLimit).toString()
  );
}

function readOptional(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function outputTail(stdout, stderr) {
  const parts = [stdout, stderr].map((s) => (s ?? "").trim()).filter((s) => s !== "");
  return parts.length === 0 ? "" : `${tail(parts.join("\n"))}\n`;
}

const rest = "*";

// A test's key, built from its parts as the module builds keys from the
// source: its suites' titles and its own, joined by " > ". Vitest before 2
// lists the file's own suite, named "", first; it is no part of the key.
function testName(assertion) {
  const ancestors = [...(assertion.ancestorTitles ?? [])];
  if (ancestors[0] === "") ancestors.shift();
  return [...ancestors, assertion.title].join(" > ");
}

function failureOf(assertion) {
  return `${testName(assertion)} failed\n${(assertion.failureMessages ?? []).join("\n")}`;
}

// summarize returns the failure message of every selected check, keyed by
// "<file index>/<test index>"; an empty message is a pass.
export function summarize({ report, selection, root, exitCode, stdout, stderr, bail }) {
  const output = outputTail(stdout, stderr);
  const files = new Map();
  for (const s of selection) {
    if (typeof s.file !== "string" || s.file === "") {
      throw new Error(`invalid selected test file ${JSON.stringify(s.file)}`);
    }
    if (files.has(s.file)) throw new Error(`duplicate selected test file ${s.file}`);
    const tests = new Map();
    for (const name of s.names) {
      if (typeof name !== "string" || name === "") {
        throw new Error(`invalid selected test ${JSON.stringify(name)} in ${s.file}`);
      }
      if (tests.has(name)) throw new Error(`duplicate selected test ${name} in ${s.file}`);
      tests.set(name, { failed: false, observed: false, log: [] });
    }
    files.set(s.file, {
      tests,
      statics: new Set(s.statics ?? []),
      seen: false,
      failed: false,
      namedFailure: false,
      messages: [],
      // Failures of the file's unnamed tests when "*" is not selected.
      restFailures: [],
    });
  }

  let anyFailure = false;
  const uncheckedFiles = new Map();
  for (const result of report?.testResults ?? []) {
    const name = String(result.name ?? "");
    const file = name.startsWith(root) ? name.slice(root.length) : name;
    const assertions = result.assertionResults ?? [];
    const fileFailed = result.status === "failed";
    const failed = assertions.filter((a) => a.status === "failed");
    anyFailure = anyFailure || fileFailed || failed.length > 0;
    const f = files.get(file);
    if (f === undefined) {
      if (fileFailed || failed.length > 0) {
        const messages = uncheckedFiles.get(file) ?? [];
        if (result.message) messages.push(result.message);
        messages.push(...failed.map(failureOf));
        uncheckedFiles.set(file, messages);
      }
      continue;
    }
    // A file runs once per Vitest project that includes it, so it can
    // appear more than once; its results are merged.
    f.seen = true;
    f.failed = f.failed || fileFailed;
    f.namedFailure = f.namedFailure || failed.length > 0;
    if (result.message) f.messages.push(result.message);
    for (const a of assertions) {
      const key = testName(a);
      const isStatic = f.statics.has(key);
      const t = f.tests.get(isStatic ? key : rest);
      if (t === undefined) {
        // A static test that is not selected ran only because the name
        // pattern also matched it: its own check covers it. An unnamed test
        // whose "*" is not selected fails the file's selected checks.
        if (!isStatic && a.status === "failed") f.restFailures.push(failureOf(a));
        continue;
      }
      // Any state counts as observed: a test Vitest skipped (.only elsewhere
      // in the file, skipIf, ctx.skip()) was registered, and passes.
      t.observed = true;
      if (a.status === "failed") {
        t.failed = true;
        t.log.push(isStatic ? (a.failureMessages ?? []).join("\n") : failureOf(a));
      }
    }
  }

  let globalFailure = "";
  if (report === null) {
    globalFailure = `vitest wrote no report (exit ${exitCode})\n${output}`;
  } else if (uncheckedFiles.size > 0) {
    const names = [...uncheckedFiles.keys()].sort();
    const details = names.map((f) => `${f}:\n${uncheckedFiles.get(f).join("\n")}`).join("\n");
    globalFailure = `failures in test files without selected test checks: ${names.join(", ")}\n${tail(details)}\n${output}`;
  } else if (exitCode !== 0 && !anyFailure) {
    // Unhandled errors, a config that fails to load, or no test files found:
    // Vitest exits non-zero with no failing test or file in the report.
    globalFailure = `shared vitest command failed (exit ${exitCode})\n${output}`;
  }

  const results = new Map();
  selection.forEach((s, fileIndex) => {
    const f = files.get(s.file);
    s.names.forEach((name, testIndex) => {
      const t = f.tests.get(name);
      let failure = globalFailure;
      if (failure === "") {
        if (t.failed) {
          failure = `${name} failed\n${tail(t.log.join("\n"))}\n`;
        } else if (f.failed && (f.messages.length > 0 || !f.namedFailure)) {
          // The file failed outside its tests: it did not load, or a hook
          // such as afterAll threw.
          failure = `test file failed outside a selected test check (vitest exit ${exitCode})\n${tail(f.messages.join("\n"))}\n`;
        } else if (f.restFailures.length > 0) {
          failure = `a test the source does not name failed, and "*" is not selected (vitest exit ${exitCode})\n${tail(f.restFailures.join("\n"))}\n`;
        } else if (t.observed) {
          // passed
        } else if (bail && anyFailure) {
          // --bail stops the run at a reported failure, so later tests do not
          // start. That failure is reported on its own check, not on theirs.
        } else if (!f.seen) {
          failure = `${name} did not run: vitest did not run ${s.file} (exit ${exitCode})\n${output}`;
        } else if (name === rest) {
          // "*" passes when no unnamed test failed, even with none observed.
        } else {
          failure = `${name} did not run: vitest ran ${s.file} without it\n`;
        }
      }
      // Every result stays well below File.contents' limit.
      if (Buffer.byteLength(failure) > resultLimit) {
        failure = `${Buffer.from(failure).subarray(0, resultLimit).toString()}\n[remaining diagnostics omitted]\n`;
      }
      results.set(`${fileIndex}/${testIndex}`, failure);
    });
  });
  return results;
}

function main() {
  const opts = args(process.argv.slice(2));
  const selection = JSON.parse(readFileSync(opts.selection, "utf8"));
  const text = readOptional(opts.report);
  let report = null;
  if (text !== null) {
    try {
      report = JSON.parse(text);
    } catch {
      report = null;
    }
  }
  const results = summarize({
    report,
    selection,
    root: opts.root ?? "",
    exitCode: Number(opts["exit-code"] ?? 0),
    stdout: readOptional(opts.stdout),
    stderr: readOptional(opts.stderr),
    bail: opts.bail === "true",
  });
  for (const [key, failure] of results) {
    const file = join(opts.output, key);
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, failure);
  }
}

if ((process.argv[1] ?? "").endsWith("vitest-report.mjs")) {
  main();
}
