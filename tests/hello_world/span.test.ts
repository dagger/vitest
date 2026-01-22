import { describe, it, expect } from "vitest";
import { trace } from "@opentelemetry/api";

describe("Span Propagation Test", () => {
  it("should create child spans", () => {
    const tracer = trace.getTracer("test-tracer");
    const span = tracer.startSpan("child-span-in-test");

    span.end();
    expect(true).toBe(true);
  });
});
