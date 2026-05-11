/**
 * Actual hook implementation that intercepts @vitest/runner module.
 * This file is imported AFTER the loader is registered.
 */

import { format } from "node:util";
import { OtelSDK } from "@dagger.io/telemetry";
import {
  type Attributes,
  type Context,
  context,
  isSpanContextValid,
  type Span,
  SpanStatusCode,
  trace,
} from "@opentelemetry/api";
import { logs, SeverityNumber } from "@opentelemetry/api-logs";
import {
  ATTR_TEST_CASE_NAME,
  ATTR_TEST_CASE_RESULT_STATUS,
  ATTR_TEST_SUITE_NAME,
  ATTR_TEST_SUITE_RUN_STATUS,
  TEST_CASE_RESULT_STATUS_VALUE_FAIL,
  TEST_CASE_RESULT_STATUS_VALUE_PASS,
  TEST_SUITE_RUN_STATUS_VALUE_FAILURE,
  TEST_SUITE_RUN_STATUS_VALUE_IN_PROGRESS,
  TEST_SUITE_RUN_STATUS_VALUE_SKIPPED,
  TEST_SUITE_RUN_STATUS_VALUE_SUCCESS,
} from "@opentelemetry/semantic-conventions/incubating";
import type {
  File,
  FileSpecification,
  Suite,
  startTests,
  Test,
  VitestRunner,
} from "@vitest/runner";
import type { TestError } from "@vitest/utils";
import { Hook } from "import-in-the-middle";

const ATTR_UI_BOUNDARY = "dagger.io/ui.boundary";
const STDIO_STREAM_ATTR = "stdio.stream";
const STDIO_STREAM_STDOUT = 1;
const STDIO_STREAM_STDERR = 2;

__prepareLogExporterEnv();

const sdk = new OtelSDK();
const tracer = trace.getTracer("dagger.io/vitest");
const logger = logs.getLogger("dagger.io/vitest");

type Telemetry = {
  span: Span;
  ctx: Context;
};

type ConsoleMethodName = "debug" | "error" | "info" | "log" | "warn";
type ConsoleStream = "stderr" | "stdout";

const __filesTelemetry = new WeakMap<File, Telemetry>();
const __suitesTelemetry = new WeakMap<Suite, Telemetry>();
const __testsTelemetry = new WeakMap<Test, Telemetry>();
const __PATCHED_CONSOLE_METHOD = Symbol.for("dagger.io/vitest.console.telemetry");
let __emittingConsoleTelemetry = false;

function __prepareLogExporterEnv(): void {
  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    __setEnvIfUnset(
      "OTEL_EXPORTER_OTLP_LOGS_ENDPOINT",
      __logEndpoint(process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT),
    );
  }

  __setEnvIfUnset(
    "OTEL_EXPORTER_OTLP_LOGS_PROTOCOL",
    process.env.OTEL_EXPORTER_OTLP_TRACES_PROTOCOL ?? process.env.OTEL_EXPORTER_OTLP_PROTOCOL,
  );
}

function __setEnvIfUnset(name: string, value?: string): void {
  if (process.env[name] === undefined && value !== undefined) {
    process.env[name] = value;
  }
}

function __logEndpoint(endpoint?: string): string | undefined {
  const logEndpoint = endpoint?.replace(/\/v1\/traces\/?$/, "/v1/logs");
  return logEndpoint !== endpoint ? logEndpoint : undefined;
}

/**
 * Update the testFn of vitest to execute the function inside
 * the test otel context so any span created inside that test
 * will be linked to the right parent span.
 */
function __recordSpansInTest(testFn: any, getCurrentTest: any): any {
  return new Proxy(testFn, {
    apply(target, thisArg, args) {
      const [testName, fn, timeout] = args;

      if (typeof fn !== "function") {
        return Reflect.apply(target, thisArg, args);
      }

      const wrappedFn = async function (this: any) {
        const currentTest = getCurrentTest();
        const testCtx = __testsTelemetry.get(currentTest)?.ctx ?? context.active();

        await context.with(testCtx, async () => {
          await fn.apply(this, arguments);
        });
      };

      return Reflect.apply(target, thisArg, [testName, wrappedFn, timeout]);
    },
  });
}

/**
 * Convert a TestError into an Error object.
 */
function __deserializeError(error: TestError): Error {
  if (error instanceof Error) {
    return error;
  }

  const err = new Error(error.message || "Test failed");
  if (error.stack) {
    err.stack = error.stack;
  }
  if (error.name) {
    err.name = error.name;
  }
  return err;
}

/**
 * If the method exist, use a Proxy to call the given function before
 * the method.
 * Else, simply set the given function as method.
 *
 * @param method The method of VitestRunner to extend.
 * @param fn The function that extends the method.
 * @returns The extended method
 */
function extendVitestRunnerMethod<K extends keyof VitestRunner, M extends VitestRunner[K]>(
  method: M | undefined,
  fn: M,
): M {
  if (method === undefined) {
    return fn;
  }

  return new Proxy(method, {
    apply(target, thisArgs, args) {
      (fn as any)(...args);

      return Reflect.apply(target as any, thisArgs, args);
    },
  });
}

function __patchConsoleTelemetry(): void {
  __patchConsoleMethod("debug", "stdout");
  __patchConsoleMethod("info", "stdout");
  __patchConsoleMethod("log", "stdout");
  __patchConsoleMethod("warn", "stderr");
  __patchConsoleMethod("error", "stderr");
}

function __patchConsoleMethod(method: ConsoleMethodName, stream: ConsoleStream): void {
  const current = console[method] as ((...args: any[]) => void) & {
    [__PATCHED_CONSOLE_METHOD]?: boolean;
  };
  if (current[__PATCHED_CONSOLE_METHOD]) {
    return;
  }

  const original = current.bind(console);
  const patched = ((...args: any[]) => {
    __emitConsoleTelemetry(stream, args);
    return original(...args);
  }) as (typeof console)[typeof method] & { [__PATCHED_CONSOLE_METHOD]?: boolean };

  patched[__PATCHED_CONSOLE_METHOD] = true;
  console[method] = patched;
}

function __emitConsoleTelemetry(stream: ConsoleStream, args: any[]): void {
  if (__emittingConsoleTelemetry) {
    return;
  }

  const activeContext = context.active();
  const activeSpan = trace.getSpan(activeContext);
  if (!activeSpan || !isSpanContextValid(activeSpan.spanContext())) {
    return;
  }

  __emittingConsoleTelemetry = true;
  try {
    logger.emit({
      timestamp: Date.now(),
      observedTimestamp: Date.now(),
      severityNumber: stream === "stderr" ? SeverityNumber.ERROR : SeverityNumber.INFO,
      severityText: stream === "stderr" ? "ERROR" : "INFO",
      body: `${format(...args)}\n`,
      attributes: {
        [STDIO_STREAM_ATTR]: stream === "stderr" ? STDIO_STREAM_STDERR : STDIO_STREAM_STDOUT,
      },
      context: activeContext,
    });
  } catch {
    // Do not let telemetry log emission affect the test run.
  } finally {
    __emittingConsoleTelemetry = false;
  }
}

function __testSpanAttributes(test: Test): Attributes {
  return {
    [ATTR_UI_BOUNDARY]: true,
    [ATTR_TEST_CASE_NAME]: __testCaseName(test),
    [ATTR_TEST_SUITE_NAME]: __testSuiteName(test.suite ?? test.file),
  };
}

function __testSuiteSpanAttributes(suite: File | Suite): Attributes {
  return {
    [ATTR_UI_BOUNDARY]: true,
    [ATTR_TEST_SUITE_NAME]: __testSuiteName(suite),
    [ATTR_TEST_SUITE_RUN_STATUS]: TEST_SUITE_RUN_STATUS_VALUE_IN_PROGRESS,
  };
}

function __testCaseName(test: Test): string {
  return `${__testSuiteName(test.suite ?? test.file)}::${test.name}`;
}

function __testSuiteName(suite: File | Suite): string {
  const file = (suite as Suite).file;
  const fileName = file?.name ?? suite.name;
  const names = __suiteNames(suite);

  return [fileName, ...names].join("::");
}

function __suiteNames(suite?: File | Suite): string[] {
  const names: string[] = [];
  let current = suite as Suite | undefined;

  while (current && (current as any).filepath === undefined) {
    names.unshift(current.name);
    current = current.suite;
  }

  return names;
}

function __testCaseResultStatus(state?: string): string {
  if (state === "fail") {
    return TEST_CASE_RESULT_STATUS_VALUE_FAIL;
  }
  if (state === "skip" || state === "todo") {
    // The semconv package only defines pass/fail well-known values; custom values are allowed.
    return "skipped";
  }
  return TEST_CASE_RESULT_STATUS_VALUE_PASS;
}

function __testSuiteRunStatus(state?: string): string {
  if (state === "fail") {
    return TEST_SUITE_RUN_STATUS_VALUE_FAILURE;
  }
  if (state === "skip" || state === "todo") {
    return TEST_SUITE_RUN_STATUS_VALUE_SKIPPED;
  }
  return TEST_SUITE_RUN_STATUS_VALUE_SUCCESS;
}

function addTelemetryToRunner(runner: VitestRunner): VitestRunner {
  // Happen before a test file run.
  // Create an otel context for that file and start a span.
  runner.onBeforeRunFiles = extendVitestRunnerMethod(runner.onBeforeRunFiles, ([file]: File[]) => {
    __patchConsoleTelemetry();

    if (!file) return;

    // The name is the filepath related to the root dir.
    const filename = file.name;

    const parentCtx = context.active();
    const fileSpan = tracer.startSpan(
      filename,
      { attributes: __testSuiteSpanAttributes(file) },
      parentCtx,
    );
    const fileSpanCtx = trace.setSpan(parentCtx, fileSpan);
    const telemetry = { span: fileSpan, ctx: fileSpanCtx };

    __filesTelemetry.set(file, telemetry);
  });

  // Happen after a test file ran.
  // Close the file span, eventually set an error if a test failed in that file.
  runner.onAfterRunFiles = extendVitestRunnerMethod(runner.onAfterRunFiles, ([file]: File[]) => {
    if (!file) return;

    const fileSpan = __filesTelemetry.get(file)?.span;
    if (fileSpan === undefined) return;

    fileSpan.setAttribute(ATTR_TEST_SUITE_RUN_STATUS, __testSuiteRunStatus(file.result?.state));

    if (file.result?.state === "fail") {
      fileSpan.setStatus({ code: SpanStatusCode.ERROR });
    } else if (file.result?.state === "pass") {
      fileSpan.setStatus({ code: SpanStatusCode.OK });
    }

    fileSpan.end();
  });

  // Happen before a test group start.
  // Look for the suite parent's context, either the file span context
  // or a parent suite.
  // Start a span with that context.
  runner.onBeforeRunSuite = extendVitestRunnerMethod(runner.onBeforeRunSuite, (suite: Suite) => {
    if ((suite as any).filepath !== undefined) {
      return;
    }

    let parentCtx = __filesTelemetry.get(suite.file)?.ctx;
    if (suite.suite) {
      parentCtx = __suitesTelemetry.get(suite.suite)?.ctx;
    }

    if (!parentCtx) {
      parentCtx = context.active();
    }

    const suiteSpan = tracer.startSpan(
      suite.name,
      { attributes: __testSuiteSpanAttributes(suite) },
      parentCtx,
    );
    const suiteSpanCtx = trace.setSpan(parentCtx, suiteSpan);

    const telemetry = {
      span: suiteSpan,
      ctx: suiteSpanCtx,
    };

    __suitesTelemetry.set(suite, telemetry);
  });

  // Happen a test suite complete.
  // Close the group span, eventually set an error if the suite failed.
  runner.onAfterRunSuite = extendVitestRunnerMethod(runner.onAfterRunSuite, (suite: Suite) => {
    const suiteSpan = __suitesTelemetry.get(suite)?.span;
    if (suiteSpan === undefined) return;

    suiteSpan.setAttribute(ATTR_TEST_SUITE_RUN_STATUS, __testSuiteRunStatus(suite.result?.state));

    if (suite.result?.state === "fail") {
      suiteSpan.setStatus({
        code: SpanStatusCode.ERROR,
      });
    } else if (suite.result?.state === "pass") {
      suiteSpan.setStatus({ code: SpanStatusCode.OK });
    }

    suiteSpan.end();
  });

  // Happn before test run.
  // Start a span with the test's name.
  runner.onBeforeRunTask = extendVitestRunnerMethod(runner.onBeforeRunTask, (test: Test) => {
    let parentCtx = __filesTelemetry.get(test.file)?.ctx ?? context.active();
    if (test.suite) {
      parentCtx = __suitesTelemetry.get(test.suite)?.ctx ?? parentCtx;
    }

    const testSpan = tracer.startSpan(
      test.name,
      { attributes: __testSpanAttributes(test) },
      parentCtx,
    );
    const testSpanCtx = trace.setSpan(parentCtx, testSpan);
    const telemetry = { span: testSpan, ctx: testSpanCtx };

    __testsTelemetry.set(test, telemetry);
  });

  // Happen on test completion.
  // Close the span, eventually set an error if the test failed.
  runner.onAfterRunTask = extendVitestRunnerMethod(runner.onAfterRunTask, (test: Test) => {
    const testSpan = __testsTelemetry.get(test)?.span;
    if (!testSpan) return;

    testSpan.setAttribute(ATTR_TEST_CASE_RESULT_STATUS, __testCaseResultStatus(test.result?.state));

    if (test.result?.state === "fail") {
      const errors = test.result.errors;
      let errorMessage: string | undefined;
      if (errors) {
        for (const error of errors) {
          testSpan.recordException(__deserializeError(error));
        }

        errorMessage = __deserializeError(errors[0])?.message ?? "Test failed";
      }

      testSpan.setStatus({
        code: SpanStatusCode.ERROR,
        message: errorMessage,
      });
    } else if (test.result?.state === "pass") {
      testSpan.setStatus({ code: SpanStatusCode.OK });
    }

    testSpan.end();
  });

  return runner;
}

// Hook into @vitest/runner to wrap test and describe functions
new Hook(["@vitest/runner"], (exported: any, _name: string, _baseDir: any) => {
  const getCurrentTest = exported.getCurrentTest;

  // Hook in test/it to record spans emitted inside the test.
  if (exported.test && typeof exported.test === "function") {
    const originalTest = exported.test;
    const proto = Object.getPrototypeOf(originalTest);

    exported.test = __recordSpansInTest(originalTest, getCurrentTest);
    // Preserve prototype and properties
    Object.setPrototypeOf(exported.test, proto);
  }

  if (exported.it && typeof exported.it === "function") {
    const originalTest = exported.it;
    const proto = Object.getPrototypeOf(originalTest);

    exported.it = __recordSpansInTest(originalTest, getCurrentTest);
    // Preserve prototype and properties
    Object.setPrototypeOf(exported.it, proto);
  }

  // Hook in startTests to modify the given Vitest runner so it can traces
  // group/test and files.
  if (exported.startTests && typeof exported.startTests === "function") {
    const originalStartTests = exported.startTests as typeof startTests;
    const proto = Object.getPrototypeOf(originalStartTests);

    exported.startTests = async function (
      this: any,
      specs: string[] | FileSpecification[],
      runner: VitestRunner,
    ): Promise<File[]> {
      sdk.start();
      __patchConsoleTelemetry();

      try {
        return await originalStartTests.apply(this, [specs, addTelemetryToRunner(runner)]);
      } finally {
        // Let Vitest flush console logs scheduled with queueMicrotask before shutting down.
        await new Promise<void>((resolve) => queueMicrotask(resolve));

        // Shutdown SDK after all tests complete
        await sdk.shutdown();
      }
    };

    Object.setPrototypeOf(exported.startTests, proto);
  }

  // Important: Return the modified exports
  return exported;
});
