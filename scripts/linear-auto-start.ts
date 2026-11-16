import { execFileSync } from "node:child_process";
import { cp, mkdir, access, rename, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

if (process.platform !== "darwin") throw new Error("この補助ツールはmacOS用です。");
const bundleId = "dev.luvpame.linear-restore-helper";
const label = bundleId;
const appName = "Linear翻訳補助.app";
const target = join(homedir(), "Applications", appName);
const binary = join(target, "Contents/MacOS/LinearRestoreHelper");
const plist = join(homedir(), "Library/LaunchAgents", `${label}.plist`);
const domain = `gui/${process.getuid?.()}`;
const command = process.argv[2] ?? "status";
const exists = async (path: string) =>
  access(path, constants.F_OK).then(
    () => true,
    () => false,
  );
const ownBundle = (path: string) =>
  execFileSync(
    "/usr/libexec/PlistBuddy",
    ["-c", "Print :CFBundleIdentifier", join(path, "Contents/Info.plist")],
    { encoding: "utf8" },
  ).trim() === bundleId;

if (command === "stage" || command === "update") {
  const source = resolve("dist/linear-auto-start", appName);
  if (!ownBundle(source)) throw new Error("生成した補助アプリの識別子が異なります。");
  const installed = await exists(target);
  if (installed && command !== "update")
    throw new Error(`補助アプリが既に存在します。上書きせず停止しました: ${target}`);
  if (installed && !ownBundle(target))
    throw new Error("既存アプリの識別子が異なるため更新しません。");
  await mkdir(join(homedir(), "Applications"), { recursive: true });
  const pending = join(homedir(), "Applications", ".Linear翻訳補助.pending.app");
  const backup = join(
    homedir(),
    "Library/Application Support/LuvpameLinearTranslation/previous-helper.app",
  );
  if (await exists(pending)) throw new Error(`配置途中のファイルが残っています: ${pending}`);
  await cp(source, pending, { recursive: true, errorOnExist: true, force: false });
  execFileSync("/usr/bin/codesign", ["--verify", "--strict", pending], { stdio: "inherit" });
  if (installed) {
    if (await exists(backup)) {
      if (!ownBundle(backup)) throw new Error("退避先の識別子が異なるため更新しません。");
      await rm(backup, { recursive: true });
    }
    await mkdir(join(homedir(), "Library/Application Support/LuvpameLinearTranslation"), {
      recursive: true,
    });
    await rename(target, backup);
  }
  try {
    await rename(pending, target);
  } catch (error) {
    if (installed) await rename(backup, target);
    throw error;
  }
  console.log(`補助アプリを配置しました。自動起動の登録状態は変更していません。\n${target}`);
} else if (command === "enable") {
  if (!ownBundle(target)) throw new Error("対象はこの翻訳補助アプリではありません。");
  const info: unknown = JSON.parse(execFileSync(binary, ["--status"], { encoding: "utf8" }));
  if (
    typeof info !== "object" ||
    info === null ||
    !("trusted" in info) ||
    info.trusted !== true ||
    !("verified" in info) ||
    info.verified !== true
  )
    throw new Error("先にアクセシビリティを許可し、補助メニューの接続確認を完了してください。");
  await mkdir(join(homedir(), "Library/LaunchAgents"), { recursive: true });
  execFileSync("/usr/bin/plutil", ["-convert", "xml1", "-o", plist, "-"], {
    input: JSON.stringify({
      Label: label,
      ProgramArguments: ["/usr/bin/open", "-g", "-a", target, "--args", "--watch"],
      RunAtLoad: true,
      ProcessType: "Interactive",
    }),
  });
  try {
    execFileSync("/bin/launchctl", ["bootout", `${domain}/${label}`], { stdio: "ignore" });
  } catch {}
  execFileSync("/bin/launchctl", ["bootstrap", domain, plist], { stdio: "inherit" });
  console.log("翻訳補助のログイン時起動を登録しました。Linearが前面になると復元します。");
} else if (command === "disable") {
  try {
    execFileSync("/bin/launchctl", ["bootout", `${domain}/${label}`], { stdio: "ignore" });
  } catch {}
  if (await exists(plist)) {
    const text = execFileSync("/usr/bin/plutil", ["-convert", "json", "-o", "-", plist], {
      encoding: "utf8",
    });
    const value: unknown = JSON.parse(text);
    if (typeof value !== "object" || value === null || !("Label" in value) || value.Label !== label)
      throw new Error("自動起動ファイルの識別子が異なるため削除しません。");
    const { unlink } = await import("node:fs/promises");
    await unlink(plist);
  }
  console.log(
    "ログイン時の起動を解除しました。稼働中の補助はメニューの「終了」で終了してください。モデルの保存データは保持します。",
  );
} else if (command === "status") {
  const installed = await exists(binary);
  console.log(
    JSON.stringify(
      {
        installed,
        autostartConfigured: await exists(plist),
        app: target,
        ...(installed
          ? { helper: JSON.parse(execFileSync(binary, ["--status"], { encoding: "utf8" })) }
          : {}),
      },
      null,
      2,
    ),
  );
} else {
  throw new Error("使い方: bun run linear:auto-start [stage|update|enable|disable|status]");
}
