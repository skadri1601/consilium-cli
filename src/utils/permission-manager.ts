import path from "node:path";
import {
  type ReadPermissionLevel as PermissionLevel,
  getCodebasePermissionLevel,
  grantCodebasePermission,
  requestCodebasePermission,
  revokeCodebasePermission,
} from "./codebase-permissions";

export class PermissionManager {
  checkPermission(projectPath: string): PermissionLevel {
    const normalized = path.resolve(projectPath);
    const level = getCodebasePermissionLevel(normalized);
    return level === "unset" ? "deny" : level;
  }

  async requestPermission(projectPath: string): Promise<PermissionLevel> {
    const normalized = path.resolve(projectPath);
    const granted = await requestCodebasePermission(normalized);
    if (!granted) return "deny";
    return this.checkPermission(normalized);
  }

  grantPermission(projectPath: string, level: PermissionLevel): void {
    const normalized = path.resolve(projectPath);
    grantCodebasePermission(normalized, level);
  }

  revokePermission(projectPath: string): void {
    const normalized = path.resolve(projectPath);
    revokeCodebasePermission(normalized);
  }

  listPermissions(): Record<string, PermissionLevel> {
    return {};
  }
}
