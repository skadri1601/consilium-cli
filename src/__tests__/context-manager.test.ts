import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ContextManager } from "../utils/context-manager";

describe("ContextManager", () => {
  let manager: ContextManager;
  let tmpDir: string;

  beforeEach(() => {
    manager = new ContextManager();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function createTempFile(name: string, content: string): string {
    const filePath = path.join(tmpDir, name);
    fs.writeFileSync(filePath, content, "utf-8");
    return filePath;
  }

  function createTempImage(name: string): string {
    const filePath = path.join(tmpDir, name);
    fs.writeFileSync(
      filePath,
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]),
    );
    return filePath;
  }

  describe("addFile", () => {
    it("adds a valid text file", () => {
      const filePath = createTempFile("test.txt", "hello world");
      manager.addFile(filePath);

      const files = manager.getFiles();
      expect(files).toHaveLength(1);
      expect(files[0].name).toBe("test.txt");
    });

    it("throws for non-existent file", () => {
      expect(() => manager.addFile(path.join(tmpDir, "nope.txt"))).toThrow(
        "File not found",
      );
    });

    it("throws for directory path", () => {
      expect(() => manager.addFile(tmpDir)).toThrow("Not a file");
    });

    it("throws for file exceeding max size", () => {
      const bigPath = createTempFile("big.txt", "x".repeat(101 * 1024));
      expect(() => manager.addFile(bigPath)).toThrow("File too large");
    });

    it("throws when total size would exceed limit", () => {
      const content = "x".repeat(90 * 1024);
      for (let i = 0; i < 5; i++) {
        const fp = createTempFile(`file${i}.txt`, content);
        manager.addFile(fp);
      }
      const extra = createTempFile("extra.txt", content);
      expect(() => manager.addFile(extra)).toThrow(
        "Total context size would exceed",
      );
    });

    it("throws for binary file", () => {
      const binPath = path.join(tmpDir, "binary.dat");
      const buf = Buffer.alloc(100);
      buf[50] = 0;
      fs.writeFileSync(binPath, buf);
      expect(() => manager.addFile(binPath)).toThrow("binary");
    });
  });

  describe("addImage", () => {
    it("adds an image file", () => {
      const imgPath = createTempImage("photo.png");
      manager.addImage(imgPath);

      const images = manager.getImages();
      expect(images).toHaveLength(1);
      expect(images[0].name).toBe("photo.png");
      expect(images[0].base64.length).toBeGreaterThan(0);
    });

    it("throws for non-existent image", () => {
      expect(() => manager.addImage(path.join(tmpDir, "missing.png"))).toThrow(
        "Image not found",
      );
    });

    it("throws for directory as image", () => {
      expect(() => manager.addImage(tmpDir)).toThrow("Not a file");
    });
  });

  describe("removeFile / getFiles", () => {
    it("getFiles returns empty initially", () => {
      expect(manager.getFiles()).toEqual([]);
    });

    it("getFiles returns added files", () => {
      createTempFile("a.txt", "aaa");
      createTempFile("b.txt", "bbb");
      manager.addFile(path.join(tmpDir, "a.txt"));
      manager.addFile(path.join(tmpDir, "b.txt"));

      const files = manager.getFiles();
      expect(files).toHaveLength(2);
      const names = files.map((f) => f.name);
      expect(names).toContain("a.txt");
      expect(names).toContain("b.txt");
    });

    it("file size reflects content length", () => {
      const content = "hello world";
      const fp = createTempFile("sized.txt", content);
      manager.addFile(fp);

      const files = manager.getFiles();
      expect(files[0].size).toBe(content.length);
    });
  });

  describe("getImages", () => {
    it("returns empty initially", () => {
      expect(manager.getImages()).toEqual([]);
    });

    it("returns added images with base64 data", () => {
      const imgPath = createTempImage("icon.png");
      manager.addImage(imgPath);

      const images = manager.getImages();
      expect(images).toHaveLength(1);
      expect(typeof images[0].base64).toBe("string");
    });
  });

  describe("clear", () => {
    it("removes all files and images", () => {
      const fp = createTempFile("file.txt", "content");
      const imgPath = createTempImage("img.png");
      manager.addFile(fp);
      manager.addImage(imgPath);

      expect(manager.getFiles()).toHaveLength(1);
      expect(manager.getImages()).toHaveLength(1);

      manager.clear();

      expect(manager.getFiles()).toEqual([]);
      expect(manager.getImages()).toEqual([]);
    });

    it("resets total size to zero", () => {
      const fp = createTempFile("data.txt", "some content");
      manager.addFile(fp);
      expect(manager.getTotalSize()).toBeGreaterThan(0);

      manager.clear();
      expect(manager.getTotalSize()).toBe(0);
    });
  });

  describe("getTotalSize", () => {
    it("returns 0 when empty", () => {
      expect(manager.getTotalSize()).toBe(0);
    });

    it("sums all file content lengths", () => {
      const fp1 = createTempFile("a.txt", "abc");
      const fp2 = createTempFile("b.txt", "defgh");
      manager.addFile(fp1);
      manager.addFile(fp2);

      expect(manager.getTotalSize()).toBe(8);
    });
  });

  describe("buildContext", () => {
    it("returns empty string when no files", () => {
      expect(manager.buildContext()).toBe("");
    });

    it("includes file names and content", () => {
      const fp = createTempFile("src.ts", "const x = 1;");
      manager.addFile(fp);

      const context = manager.buildContext();
      expect(context).toContain("CONTEXT FILES");
      expect(context).toContain("src.ts");
      expect(context).toContain("const x = 1;");
      expect(context).toContain("BEGIN FILE");
      expect(context).toContain("END FILE");
      expect(context).toContain("END CONTEXT");
    });

    it("lists all files with sizes", () => {
      const fp1 = createTempFile("one.txt", "aaa");
      const fp2 = createTempFile("two.txt", "bbbbb");
      manager.addFile(fp1);
      manager.addFile(fp2);

      const context = manager.buildContext();
      expect(context).toContain("one.txt (3 bytes)");
      expect(context).toContain("two.txt (5 bytes)");
    });
  });

  describe("getFilesWithContent", () => {
    it("returns name and content pairs", () => {
      const fp = createTempFile("code.js", 'console.log("hi")');
      manager.addFile(fp);

      const result = manager.getFilesWithContent();
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("code.js");
      expect(result[0].content).toBe('console.log("hi")');
    });
  });
});
