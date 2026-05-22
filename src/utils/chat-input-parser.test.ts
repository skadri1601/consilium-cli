import { describe, it, expect } from "vitest";
import {
  parseAtMentions,
  isShellPassthrough,
  extractShellCommand,
  isDangerousShellCommand,
  detectImageBase64Mime,
  isImagePath,
  mimeTypeForPath,
  attachBase64Image,
} from "./chat-input-parser";

describe("parseAtMentions", () => {
  it("returns input unchanged when no @ tokens", () => {
    const result = parseAtMentions("hello world");
    expect(result.cleanedInput).toBe("hello world");
    expect(result.mentions).toEqual([]);
  });

  it("extracts a single @path/to/file mention", () => {
    const result = parseAtMentions("@src/index.ts explain this");
    expect(result.mentions).toEqual(["src/index.ts"]);
    expect(result.cleanedInput).toBe("explain this");
  });

  it("extracts multiple @ mentions", () => {
    const result = parseAtMentions("compare @a/file.ts and @b/file.ts please");
    expect(result.mentions).toEqual(["a/file.ts", "b/file.ts"]);
    expect(result.cleanedInput).toBe("compare and please");
  });

  it("dedupes repeated mentions", () => {
    const result = parseAtMentions("@a.ts then @a.ts again");
    expect(result.mentions).toEqual(["a.ts"]);
  });

  it("respects escaped \\@ and keeps literal @", () => {
    const result = parseAtMentions("send email to user\\@example.com");
    expect(result.mentions).toEqual([]);
    expect(result.cleanedInput).toBe("send email to user@example.com");
  });

  it("ignores @ in middle of word (no leading space)", () => {
    const result = parseAtMentions("user@domain.com asked");
    expect(result.mentions).toEqual([]);
    expect(result.cleanedInput).toBe("user@domain.com asked");
  });

  it("strips trailing punctuation from mention", () => {
    const result = parseAtMentions("read @src/foo.ts, then comment");
    expect(result.mentions).toEqual(["src/foo.ts"]);
    expect(result.cleanedInput).toContain("then comment");
    expect(result.cleanedInput).not.toContain("@src/foo.ts");
  });

  it("ignores @ followed by a bare word without path indicators", () => {
    const result = parseAtMentions("hey @alice can you check");
    expect(result.mentions).toEqual([]);
    expect(result.cleanedInput).toContain("@alice");
  });

  it("accepts dot-prefixed hidden files", () => {
    const result = parseAtMentions("look at @.env.local for keys");
    expect(result.mentions).toEqual([".env.local"]);
  });

  it("handles empty input", () => {
    const result = parseAtMentions("");
    expect(result.cleanedInput).toBe("");
    expect(result.mentions).toEqual([]);
  });

  it("handles only-@-token input", () => {
    const result = parseAtMentions("@foo/bar.ts");
    expect(result.mentions).toEqual(["foo/bar.ts"]);
    expect(result.cleanedInput).toBe("");
  });

  it("accepts windows-style paths", () => {
    const result = parseAtMentions("open @src\\utils\\foo.ts now");
    expect(result.mentions).toEqual(["src\\utils\\foo.ts"]);
  });
});

describe("isShellPassthrough", () => {
  it("returns true for ! prefix with command", () => {
    expect(isShellPassthrough("!ls -la")).toBe(true);
  });

  it("returns false for plain text", () => {
    expect(isShellPassthrough("hello")).toBe(false);
  });

  it("returns false for !! (history expansion)", () => {
    expect(isShellPassthrough("!!")).toBe(false);
  });

  it("returns false for !=", () => {
    expect(isShellPassthrough("!= 5")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isShellPassthrough("")).toBe(false);
  });

  it("returns false for single !", () => {
    expect(isShellPassthrough("!")).toBe(false);
  });

  it("returns true for ! followed by space and command", () => {
    expect(isShellPassthrough("! ls")).toBe(true);
  });
});

describe("extractShellCommand", () => {
  it("strips ! and trims", () => {
    expect(extractShellCommand("!ls -la")).toBe("ls -la");
  });

  it("strips ! plus space", () => {
    expect(extractShellCommand("!  echo hi")).toBe("echo hi");
  });

  it("returns empty string for non-passthrough input", () => {
    expect(extractShellCommand("hello")).toBe("");
  });
});

describe("isDangerousShellCommand", () => {
  it("blocks rm -rf /", () => {
    expect(isDangerousShellCommand("rm -rf /")).toBe(true);
  });

  it("blocks fork bomb", () => {
    expect(isDangerousShellCommand(":(){:|:&};:")).toBe(true);
  });

  it("blocks mkfs", () => {
    expect(isDangerousShellCommand("mkfs.ext4 /dev/sda1")).toBe(true);
  });

  it("allows normal rm", () => {
    expect(isDangerousShellCommand("rm tmp.txt")).toBe(false);
  });

  it("allows ls", () => {
    expect(isDangerousShellCommand("ls -la")).toBe(false);
  });
});

describe("detectImageBase64Mime", () => {
  it("detects PNG header", () => {
    expect(detectImageBase64Mime("iVBORw0KGgoAAAANSUhEUg")).toBe("image/png");
  });

  it("detects JPEG header", () => {
    expect(detectImageBase64Mime("/9j/4AAQSkZJRg")).toBe("image/jpeg");
  });

  it("returns null for non-image data", () => {
    expect(detectImageBase64Mime("plaintext")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(detectImageBase64Mime("")).toBeNull();
  });
});

describe("isImagePath", () => {
  it("accepts .png", () => {
    expect(isImagePath("foo.png")).toBe(true);
  });

  it("accepts .JPEG (case-insensitive)", () => {
    expect(isImagePath("foo.JPEG")).toBe(true);
  });

  it("rejects .txt", () => {
    expect(isImagePath("foo.txt")).toBe(false);
  });
});

describe("mimeTypeForPath", () => {
  it("maps .png to image/png", () => {
    expect(mimeTypeForPath("a.png")).toBe("image/png");
  });

  it("maps .webp to image/webp", () => {
    expect(mimeTypeForPath("a.webp")).toBe("image/webp");
  });

  it("falls back to octet-stream", () => {
    expect(mimeTypeForPath("a.bin")).toBe("application/octet-stream");
  });
});

describe("attachBase64Image", () => {
  it("constructs PNG attachment", () => {
    const att = attachBase64Image("iVBORw0KGgoAAAANSUhEUg");
    expect(att.mimeType).toBe("image/png");
    expect(att.name).toMatch(/\.png$/);
    expect(att.data).toContain("iVBORw0KGgo");
  });

  it("throws on unknown data", () => {
    expect(() => attachBase64Image("not-an-image")).toThrow();
  });
});
