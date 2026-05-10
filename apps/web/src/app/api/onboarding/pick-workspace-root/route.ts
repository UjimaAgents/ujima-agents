import { execFile } from "node:child_process";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type PickOutcome = { path: string } | { cancelled: true };

export async function POST() {
  if (process.env.VERCEL) {
    return NextResponse.json(
      {
        code: "ERR_UNSUPPORTED_DEPLOYMENT",
        message:
          "Folder browse only works when the web app runs on your own computer (same machine as the browser). On hosted deployments, enter the workspace path manually.",
      },
      { status: 400 },
    );
  }

  try {
    const outcome = await pickWorkspaceFolder();
    if ("cancelled" in outcome) {
      return NextResponse.json({ cancelled: true }, { status: 200 });
    }
    return NextResponse.json({ path: outcome.path }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      {
        code: "ERR_PICK_WORKSPACE_ROOT",
        message: error instanceof Error ? error.message : "Unable to open folder picker.",
      },
      { status: 500 },
    );
  }
}

function pickWorkspaceFolder(): Promise<PickOutcome> {
  switch (process.platform) {
    case "win32":
      return pickWindows();
    case "darwin":
      return pickMacOS();
    case "linux":
      return pickLinux();
    default:
      return Promise.reject(
        new Error(`Native folder picker is not implemented for platform "${process.platform}".`),
      );
  }
}

function pickWindows(): Promise<PickOutcome> {
  const script = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
    '$dialog.Description = "Select workspace root"',
    "$dialog.ShowNewFolderButton = $true",
    "$result = $dialog.ShowDialog()",
    "if ($result -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dialog.SelectedPath }",
  ].join("; ");

  return execFileOutcome("powershell.exe", ["-NoProfile", "-STA", "-Command", script], {
    windowsHide: false,
  });
}

function pickMacOS(): Promise<PickOutcome> {
  return execFileOutcome(
    "osascript",
    ["-e", 'POSIX path of (choose folder with prompt "Select workspace root")'],
    {},
  );
}

async function pickLinux(): Promise<PickOutcome> {
  try {
    return await execFileOutcome(
      "zenity",
      ["--file-selection", "--directory", "--title=Select workspace root", "--modal"],
      {},
    );
  } catch (first) {
    if ((first as NodeJS.ErrnoException).code !== "ENOENT") {
      throw first;
    }
  }
  try {
    return await execFileOutcome("kdialog", ["--getexistingdirectory", process.cwd()], {});
  } catch (second) {
    if ((second as NodeJS.ErrnoException).code !== "ENOENT") {
      throw second;
    }
  }
  throw new Error(
    "Install zenity or kdialog for a native folder picker on Linux, or enter the path manually.",
  );
}

function execFileOutcome(
  command: string,
  args: readonly string[],
  options: { windowsHide?: boolean },
): Promise<PickOutcome> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args as string[],
      { timeout: 120_000, maxBuffer: 1024 * 1024, ...options },
      (error, stdout) => {
        const text = stdout.toString().trim();
        if (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code === "ENOENT") {
            reject(error);
            return;
          }
          if (!text) {
            resolve({ cancelled: true });
            return;
          }
          reject(error);
          return;
        }
        if (!text) {
          resolve({ cancelled: true });
          return;
        }
        resolve({ path: text });
      },
    );
  });
}
