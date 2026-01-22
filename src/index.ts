// Main entry point - export the reporter for use in vitest.config.ts
//
import { OtelSDK } from "@dagger.io/telemetry";
import type { Context, Span, Tracer } from "@opentelemetry/api";
import { context, SpanStatusCode, trace } from "@opentelemetry/api";
import type { Reporter, TestCase, TestModule, TestSuite } from "vitest/node";

/**
 * Instrumentation for a test suite or module.
 */
type SuiteInst = {
  /**
   * The span of the suite.
   */
  span: Span;

  /**
   * The otel context of the suite.
   * This can be passed to children suite/tests.
   */
  context: Context;

  /**
   * Set to true if a children failed so the current span
   * status can be set to ERROR.
   */
  failed: boolean;
};

/**
 * OpenTelemetry reporter for Vitest that creates spans for test modules,
 * suites, and individual tests with proper error propagation.
 */
export default class OtelReporter implements Reporter {
  private __sdk = new OtelSDK();
  private __moduleInst = new WeakMap<TestModule, SuiteInst>();
  private __suiteInst = new WeakMap<TestSuite, SuiteInst>();
  private __testInst = new WeakMap<TestCase, Span>();
  private __tracer: Tracer | undefined;

  /**
   * Initialize the OTEL SDK when Vitest starts
   */
  onInit(): void {
    this.__sdk.start();
    this.__tracer = trace.getTracer("dagger.io/vitest");
  }

  /**
   * On test module start, create a span for the entire test file
   */
  onTestModuleStart(testModule: TestModule): void {
    const ctx = context.active();
    const span = this.__tracer?.startSpan(testModule.relativeModuleId, {}, ctx);
    if (span === undefined) {
      return;
    }

    const spanCtx = trace.setSpan(ctx, span);

    this.__moduleInst.set(testModule, {
      span,
      context: spanCtx,
      failed: false,
    });
  }

  /**
   * On test module end, close the span and set status if any test failed
   */
  onTestModuleEnd(testModule: TestModule): void {
    const inst = this.__moduleInst.get(testModule);
    if (inst === undefined) {
      return;
    }

    if (inst.failed) {
      inst.span.setStatus({ code: SpanStatusCode.ERROR });
    }

    inst.span.end();
    this.__moduleInst.delete(testModule);
  }

  /**
   * On suite start, create a span for the test suite (describe block)
   */
  onTestSuiteReady(testSuite: TestSuite): void {
    const ctx = this.getOrCreateContext(testSuite);
    const span = this.__tracer?.startSpan(testSuite.name, {}, ctx);
    if (span === undefined) {
      return;
    }

    const spanCtx = trace.setSpan(ctx, span);

    this.__suiteInst.set(testSuite, {
      span,
      context: spanCtx,
      failed: false,
    });
  }

  /**
   * On suite end, close the span and propagate failures
   */
  onTestSuiteResult(testSuite: TestSuite): void {
    const inst = this.__suiteInst.get(testSuite);
    if (inst === undefined) {
      return;
    }

    if (inst.failed) {
      inst.span.setStatus({ code: SpanStatusCode.ERROR });
      this.setParentAsFailed(testSuite);
    }

    inst.span.end();
    this.__suiteInst.delete(testSuite);
  }

  /**
   * On test start, create a span for the individual test
   */
  onTestCaseReady(testCase: TestCase): void {
    const ctx = this.getOrCreateContext(testCase);
    const span = this.__tracer?.startSpan(testCase.name, {}, ctx);
    if (span) {
      this.__testInst.set(testCase, span);
    }
  }

  /**
   * On test result, set the status and propagate failures
   */
  onTestCaseResult(testCase: TestCase): void {
    const span = this.__testInst.get(testCase);
    if (span === undefined) return;

    const result = testCase.result();

    if (result.state === "passed") {
      span.setStatus({ code: SpanStatusCode.OK });
    } else if (result.state === "failed") {
      // Record the error if available
      const errors = result.errors;
      if (errors && errors.length > 0) {
        for (const error of errors) {
          // Create a proper Error object from the serialized error
          const err = this.deserializeError(error);
          span.recordException(err);
        }
        const firstError = this.deserializeError(errors[0]);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: firstError.message,
        });
      } else {
        span.setStatus({ code: SpanStatusCode.ERROR });
      }

      this.setParentAsFailed(testCase);
    }

    span.end();
    this.__testInst.delete(testCase);
  }

  /**
   * On test run end, shutdown the SDK to flush remaining traces
   */
  async onTestRunEnd(): Promise<void> {
    await this.__sdk.shutdown();
  }

  /**
   * Get or create the context for a test or suite based on its parent
   */
  private getOrCreateContext(entity: TestCase | TestSuite): Context {
    // Get the parent entity to find the context
    const parent = entity.parent;
    if (parent === undefined) {
      return context.active();
    }

    // If parent is a TestModule, use its context
    if ("moduleId" in parent) {
      const inst = this.__moduleInst.get(parent as TestModule);
      if (inst) {
        return inst.context;
      }
    }

    // If parent is a TestSuite, use its context
    if ("type" in parent && parent.type === "suite") {
      const inst = this.__suiteInst.get(parent as TestSuite);
      if (inst) {
        return inst.context;
      }
    }

    // Fallback to active context
    return context.active();
  }

  /**
   * Mark parent suites and modules as failed to propagate errors up
   */
  private setParentAsFailed(entity: TestCase | TestSuite): void {
    const parent = entity.parent;
    if (parent === undefined) {
      return;
    }

    // Mark parent suite as failed
    if ("type" in parent && parent.type === "suite") {
      const inst = this.__suiteInst.get(parent as TestSuite);
      if (inst) {
        inst.failed = true;
      }
      // Recursively mark grandparents
      this.setParentAsFailed(parent as TestSuite);
    }

    // Mark parent module as failed
    if ("moduleId" in parent) {
      const inst = this.__moduleInst.get(parent as TestModule);
      if (inst) {
        inst.failed = true;
      }
    }
  }

  /**
   * Convert a serialized error to a proper Error object
   */
  private deserializeError(error: any): Error {
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
}
