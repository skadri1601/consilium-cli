export interface ConfigInfo {
  buildSystem: string;
  testFramework: string;
  envVars: string[];
  hasDocker: boolean;
  hasCI: boolean;
  configFiles: string[];
}

const BUILD_BY_PATH_SNIPPET: Array<[string, string]> = [
  ["webpack", "webpack"],
  ["vite.config", "vite"],
  ["rollup.config", "rollup"],
  ["esbuild", "esbuild"],
  ["turbo.json", "turborepo"],
  ["nx.json", "nx"],
  ["Makefile", "make"],
  ["CMakeLists", "cmake"],
  ["build.gradle", "gradle"],
  ["pom.xml", "maven"],
];

function buildFromPackageJson(content: string): string | null {
  try {
    const pkg = JSON.parse(content) as { scripts?: { build?: string } };
    const script = pkg.scripts?.build;
    if (!script) return null;
    if (/\btsc\b/.test(script)) return "tsc";
    if (/\bnext\b/.test(script)) return "next";
    if (/\bvite\b/.test(script)) return "vite";
  } catch {
    return null;
  }
  return null;
}

function detectBuildSystem(
  files: Map<string, string>,
  fileList: string[],
): string {
  for (const [needle, name] of BUILD_BY_PATH_SNIPPET) {
    if (fileList.some((f) => f.includes(needle))) return name;
  }
  const pkgBody = files.get("package.json");
  if (pkgBody) {
    const fromPkg = buildFromPackageJson(pkgBody);
    if (fromPkg) return fromPkg;
  }
  return "unknown";
}

function detectTestFromPackageJson(content: string): string | null {
  try {
    const pkg = JSON.parse(content);
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (allDeps["vitest"]) return "vitest";
    if (allDeps["jest"]) return "jest";
    if (allDeps["mocha"]) return "mocha";
    if (allDeps["ava"]) return "ava";
    if (allDeps["tape"]) return "tape";
  } catch {
    return null;
  }
  return null;
}

const TEST_BY_PATH: Array<[string, string]> = [
  ["jest.config", "jest"],
  ["vitest.config", "vitest"],
  [".mocharc", "mocha"],
];

function detectTestFromPythonManifests(
  files: Map<string, string>,
): string | null {
  for (const [name, content] of files) {
    if (name !== "pyproject.toml" && name !== "setup.cfg") continue;
    if (content.includes("pytest")) return "pytest";
    if (content.includes("unittest")) return "unittest";
  }
  return null;
}

function detectTestFramework(
  files: Map<string, string>,
  fileList: string[],
): string {
  const pkgBody = files.get("package.json");
  if (pkgBody) {
    const fromPkg = detectTestFromPackageJson(pkgBody);
    if (fromPkg) return fromPkg;
  }
  const fromPython = detectTestFromPythonManifests(files);
  if (fromPython) return fromPython;

  for (const [needle, name] of TEST_BY_PATH) {
    if (fileList.some((f) => f.includes(needle))) return name;
  }
  if (
    fileList.some((f) => f.includes("pytest.ini") || f.includes("conftest.py"))
  )
    return "pytest";

  return "unknown";
}

function detectEnvVars(files: Map<string, string>): string[] {
  const vars = new Set<string>();
  const envRegex = /^([A-Z][A-Z0-9_]+)=/gm;

  for (const [name, content] of files) {
    if (
      name.includes(".env.example") ||
      name.includes(".env.sample") ||
      name.includes(".env.template")
    ) {
      let match;
      while ((match = envRegex.exec(content)) !== null) {
        const key = match[1];
        if (key) vars.add(key);
      }
    }
  }

  return Array.from(vars).sort((a, b) => a.localeCompare(b));
}

function findConfigFiles(fileList: string[]): string[] {
  const configPatterns = [
    "tsconfig",
    "jsconfig",
    ".eslintrc",
    ".prettierrc",
    "babel.config",
    ".babelrc",
    "postcss.config",
    "tailwind.config",
    ".editorconfig",
    "jest.config",
    "vitest.config",
    "webpack.config",
    "vite.config",
    "rollup.config",
    "turbo.json",
    "nx.json",
    "lerna.json",
    ".dockerignore",
    "docker-compose",
    "Dockerfile",
    ".github/workflows",
    ".gitlab-ci",
    "Jenkinsfile",
    "pyproject.toml",
    "setup.cfg",
    "setup.py",
    "tox.ini",
    "Cargo.toml",
    "go.mod",
    "go.sum",
  ];

  return fileList
    .filter((f) => configPatterns.some((p) => f.includes(p)))
    .sort((a, b) => a.localeCompare(b));
}

export function analyzeConfig(
  files: Map<string, string>,
  fileList: string[],
): ConfigInfo {
  return {
    buildSystem: detectBuildSystem(files, fileList),
    testFramework: detectTestFramework(files, fileList),
    envVars: detectEnvVars(files),
    hasDocker: fileList.some(
      (f) => f.includes("Dockerfile") || f.includes("docker-compose"),
    ),
    hasCI: fileList.some(
      (f) =>
        f.includes(".github/workflows") ||
        f.includes(".gitlab-ci") ||
        f.includes("Jenkinsfile") ||
        f.includes(".circleci"),
    ),
    configFiles: findConfigFiles(fileList),
  };
}
