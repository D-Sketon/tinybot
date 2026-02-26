import { describe, expect, it } from "vitest";

import {
  asOptionalString,
  asOptionalStringArray,
} from "../../../src/core/tools/base.ts";

describe("base helpers", () => {
  it("asOptionalString returns string or undefined", () => {
    expect(asOptionalString("x")).toBe("x");
    expect(asOptionalString(1)).toBeUndefined();
    expect(asOptionalString(undefined)).toBeUndefined();
  });

  it("asOptionalStringArray returns array only for string-only arrays", () => {
    expect(asOptionalStringArray(["a", "b"])!.length).toBe(2);
    expect(asOptionalStringArray(["a", 1 as any])).toBeUndefined();
    expect(asOptionalStringArray("not an array" as any)).toBeUndefined();
  });
});
