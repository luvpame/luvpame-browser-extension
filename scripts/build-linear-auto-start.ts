import { execFileSync } from "node:child_process";
import { mkdir, copyFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const app = resolve("dist/linear-auto-start/Linear翻訳補助.app");
const contents = join(app, "Contents");
const executable = join(contents, "MacOS/LinearRestoreHelper");
await mkdir(join(contents, "MacOS"), { recursive: true });
await mkdir(join(contents, "Resources"), { recursive: true });
const plist = {
  CFBundleIdentifier: "dev.luvpame.linear-restore-helper",
  CFBundleName: "Linear翻訳補助",
  CFBundleDisplayName: "Linear翻訳補助",
  CFBundleExecutable: "LinearRestoreHelper",
  CFBundlePackageType: "APPL",
  CFBundleShortVersionString: "1.0.0",
  CFBundleVersion: "1",
  LSUIElement: true,
  LSMinimumSystemVersion: "15.0",
  NSHighResolutionCapable: true,
};
execFileSync("/usr/bin/plutil", ["-convert", "xml1", "-o", join(contents, "Info.plist"), "-"], {
  input: JSON.stringify(plist),
});
await copyFile(resolve("dist/linear-offline/restore.js"), join(contents, "Resources/restore.js"));
execFileSync(
  "/usr/bin/swiftc",
  [
    "-O",
    "-target",
    `${process.arch === "arm64" ? "arm64" : "x86_64"}-apple-macosx15.0`,
    "-swift-version",
    "6",
    "-strict-concurrency=complete",
    "-module-cache-path",
    "/tmp/luvpame-swift-module-cache",
    "-framework",
    "AppKit",
    "-framework",
    "ApplicationServices",
    resolve("native/linear-restore-helper/main.swift"),
    "-o",
    executable,
  ],
  { stdio: "inherit" },
);
execFileSync(
  "/usr/bin/codesign",
  ["--force", "--sign", "-", "--identifier", plist.CFBundleIdentifier, app],
  { stdio: "inherit" },
);
execFileSync("/usr/bin/codesign", ["--verify", "--strict", app], { stdio: "inherit" });
execFileSync(executable, ["--self-check"], { stdio: "inherit" });
await writeFile(
  resolve("dist/linear-auto-start/build.json"),
  JSON.stringify({ app, executable, bundleId: plist.CFBundleIdentifier }, null, 2),
);
console.log(`補助アプリを生成しました: ${app}`);
