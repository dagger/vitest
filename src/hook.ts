/**
 * Actual hook implementation that intercepts @vitest/runner module.
 * This file is imported AFTER the loader is registered.
 */

import { OtelSDK } from "@dagger.io/telemetry";
import {
  type Context,
  context,
  type Span,
  SpanStatusCode,
  trace,
} from "@opentelemetry/api";
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

const sdk = new OtelSDK();
const tracer = trace.getTracer("dagger.io/vitest");

type Telemetry = {
  span: Span;
  ctx: Context;
};

const __filesTelemetry = new WeakMap<File, Telemetry>();
const __suitesTelemetry = new WeakMap<Suite, Telemetry>();
const __testsTelemetry = new WeakMap<Test, Telemetry>();

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
        const testCtx =
          __testsTelemetry.get(currentTest)?.ctx ?? context.active();

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
function extendVitestRunnerMethod<
  K extends keyof VitestRunner,
  M extends VitestRunner[K],
>(method: M | undefined, fn: M): M {
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

function addTelemetryToRunner(runner: VitestRunner): VitestRunner {
  // Happen before a test file run.
  // Create an otel context for that file and start a span.
  runner.onBeforeRunFiles = extendVitestRunnerMethod(
    runner.onBeforeRunFiles,
    ([file]: File[]) => {
      if (!file) return;

      // The name is the filepath related to the root dir.
      const filename = file.name;

      const parentCtx = context.active();
      const fileSpan = tracer.startSpan(filename, {}, parentCtx);
      const fileSpanCtx = trace.setSpan(parentCtx, fileSpan);

      __filesTelemetry.set(file, { span: fileSpan, ctx: fileSpanCtx });
    },
  );

  // Happen after a test file ran.
  // Close the file span, eventually set an error if a test failed in that file.
  runner.onAfterRunFiles = extendVitestRunnerMethod(
    runner.onAfterRunFiles,
    ([file]: File[]) => {
      if (!file) return;

      const fileSpan = __filesTelemetry.get(file)?.span;
      if (fileSpan === undefined) return;

      if (file.result?.state === "fail") {
        fileSpan.setStatus({ code: SpanStatusCode.ERROR });
      }

      fileSpan.end();
    },
  );

  // Happen before a test group start.
  // Look for the suite parent's context, either the file span context
  // or a parent suite.
  // Start a span with that context.
  runner.onBeforeRunSuite = extendVitestRunnerMethod(
    runner.onBeforeRunSuite,
    (suite: Suite) => {
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

      const suiteSpan = tracer.startSpan(suite.name, {}, parentCtx);
      const suiteSpanCtx = trace.setSpan(parentCtx, suiteSpan);

      __suitesTelemetry.set(suite, {
        span: suiteSpan,
        ctx: suiteSpanCtx,
      });
    },
  );

  // Happen a test suite complete.
  // Close the group span, eventually set an error if the suite failed.
  runner.onAfterRunSuite = extendVitestRunnerMethod(
    runner.onAfterRunSuite,
    (suite: Suite) => {
      const suiteSpan = __suitesTelemetry.get(suite)?.span;
      if (suiteSpan === undefined) return;

      if (suite.result?.state === "fail") {
        suiteSpan.setStatus({
          code: SpanStatusCode.ERROR,
        });
      }

      suiteSpan.end();
    },
  );

  // Happn before test run.
  // Start a span with the test's name.
  runner.onBeforeRunTask = extendVitestRunnerMethod(
    runner.onBeforeRunTask,
    (test: Test) => {
      let parentCtx = __filesTelemetry.get(test.file)?.ctx ?? context.active();
      if (test.suite) {
        parentCtx = __suitesTelemetry.get(test.suite)?.ctx ?? parentCtx;
      }

      const testSpan = tracer.startSpan(test.name, {}, parentCtx);
      const testSpanCtx = trace.setSpan(parentCtx, testSpan);

      __testsTelemetry.set(test, { span: testSpan, ctx: testSpanCtx });
    },
  );

  // Happen on test completion.
  // Close the span, eventually set an error if the test failed.
  runner.onAfterRunTask = extendVitestRunnerMethod(
    runner.onAfterRunTask,
    (test: Test) => {
      const testSpan = __testsTelemetry.get(test)?.span;
      if (!testSpan) return;

      if (test.result?.state === "fail") {
        const errors = test.result.errors;
        let errorMessage: string | undefined;
        if (errors) {
          for (const error of errors) {
            testSpan.recordException(__deserializeError(error));
          }

          errorMessage =
            __deserializeError(errors[0])?.message ?? "Test failed";
        }

        testSpan.setStatus({
          code: SpanStatusCode.ERROR,
          message: errorMessage,
        });
      }

      testSpan.end();
    },
  );

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

      try {
        return await originalStartTests.apply(this, [
          specs,
          addTelemetryToRunner(runner),
        ]);
      } finally {
        // Shutdown SDK after all tests complete
        await sdk.shutdown();
      }
    };

    Object.setPrototypeOf(exported.startTests, proto);
  }

  // Important: Return the modified exports
  return exported;
});
