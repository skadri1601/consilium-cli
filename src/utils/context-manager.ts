import fs from "node:fs";
import path from "node:path";

export interface FileEntry {
  name: string;
  size: number;
}

export class ContextManager {
  private static readonly MAX_FILE_SIZE = 100 * 1024; // 100KB
  private static readonly MAX_TOTAL_SIZE = 500 * 1024; // 500KB
  private readonly files: Map<string, string> = new Map();
  private readonly images: Map<string, string> = new Map();

  addFile(filePath: string): void {
    const resolved = path.resolve(process.cwd(), filePath);

    if (!fs.existsSync(resolved)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const stats = fs.statSync(resolved);
    if (!stats.isFile()) {
      throw new Error(`Not a file: ${filePath}`);
    }

    if (stats.size > ContextManager.MAX_FILE_SIZE) {
      throw new Error(
        `File too large: ${filePath} (${stats.size} bytes). Max: ${ContextManager.MAX_FILE_SIZE} bytes`,
      );
    }

    const currentSize = this.getTotalSize();
    if (currentSize + stats.size > ContextManager.MAX_TOTAL_SIZE) {
      throw new Error(
        `Total context size would exceed limit. Current: ${currentSize} bytes, adding: ${stats.size} bytes. Max total: ${ContextManager.MAX_TOTAL_SIZE} bytes`,
      );
    }

    const content = fs.readFileSync(resolved, "utf-8");

    if (content.includes("\0")) {
      throw new Error(
        `File appears to be binary: ${filePath}. Only text files are supported.`,
      );
    }

    const name = path.basename(resolved);
    this.files.set(name, content);
  }

  addImage(imagePath: string): void {
    const resolved = path.resolve(process.cwd(), imagePath);

    if (!fs.existsSync(resolved)) {
      throw new Error(`Image not found: ${imagePath}`);
    }

    const stats = fs.statSync(resolved);
    if (!stats.isFile()) {
      throw new Error(`Not a file: ${imagePath}`);
    }

    const base64 = fs.readFileSync(resolved).toString("base64");
    const name = path.basename(resolved);
    this.images.set(name, base64);
  }

  clear(): void {
    this.files.clear();
    this.images.clear();
  }

  getTotalSize(): number {
    return Array.from(this.files.values()).reduce(
      (sum, content) => sum + content.length,
      0,
    );
  }

  getFiles(): FileEntry[] {
    return Array.from(this.files.entries()).map(([name, content]) => ({
      name,
      size: content.length,
    }));
  }

  getFilesWithContent(): Array<{ name: string; content: string }> {
    return Array.from(this.files.entries()).map(([name, content]) => ({
      name,
      content,
    }));
  }

  getImages(): Array<{ name: string; base64: string }> {
    return Array.from(this.images.entries()).map(([name, base64]) => ({
      name,
      base64,
    }));
  }

  buildContext(): string {
    if (this.files.size === 0) return "";

    const sections: string[] = [];

    sections.push("=== CONTEXT FILES ===\n", "Files provided:");
    for (const [name, content] of this.files) {
      sections.push(`- ${name} (${content.length} bytes)`);
    }
    sections.push("");

    for (const [name, content] of this.files) {
      sections.push(
        `--- BEGIN FILE: ${name} ---`,
        content,
        `--- END FILE: ${name} ---\n`,
      );
    }

    sections.push("=== END CONTEXT ===\n");

    return sections.join("\n");
  }
}
