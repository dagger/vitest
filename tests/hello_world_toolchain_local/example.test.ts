import { describe, it, expect } from "vitest";

import { trace } from "@opentelemetry/api";

const tracer = trace.getTracer("dagger.io/vitest");

describe("Example Test Suite", () => {
  it("should pass", () => {
    tracer.startActiveSpan("inside test", (span) => {
      expect(1 + 1).toBe(2);
      span.end();
    });
  });

  it("should also pass", () => {
    expect(true).toBe(true);
  });

  describe("Nested Suite", () => {
    it("nested test passes", () => {
      expect("hello").toBe("hello");
    });

    it("nested test fails", () => {
      expect(1).toBe(2);
    });
  });
});

describe("Another Suite", () => {
  it("passes in different suite", () => {
    expect([1, 2, 3]).toHaveLength(3);
  });
});
