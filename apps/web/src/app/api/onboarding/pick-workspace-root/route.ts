import { execFile } from "node:child_process";
import { NextResponse } from "next/server";
import { daemonFetch } from "@/server/ujima-daemon";

export const dynamic = "force-dynamic";

type PickOutcome = { path: string } | { cancelled: true };
let lastPickAt = 0;

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ code: "ERR_FORBIDDEN", message: "Invalid request origin." }, { status: 403 });
  }
  if (Date.now() - lastPickAt < 5_000) {
    return NextResponse.json({ code: "ERR_RATE_LIMIT", message: "Please wait before opening another folder picker." }, { status: 429 });
  }
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
    const bootstrap = await daemonFetch("/api/bootstrap");
    const state = await bootstrap.json().catch(() => null) as { onboardingStatus?: string; organizations?: unknown[] } | null;
    if (!bootstrap.ok || state?.onboardingStatus !== "pending" || (state.organizations?.length ?? 0) > 0) {
      return NextResponse.json({ code: "ERR_ONBOARDING_COMPLETE", message: "Complete workspace setup is unavailable." }, { status: 409 });
    }
    lastPickAt = Date.now();
    const outcome = await pickWorkspaceFolder();
    if ("cancelled" in outcome) {
      return NextResponse.json({ cancelled: true }, { status: 200 });
    }
    return NextResponse.json({ path: outcome.path }, { status: 200 });
  } catch {
    return NextResponse.json(
      {
        code: "ERR_PICK_WORKSPACE_ROOT",
        message: "Unable to open folder picker.",
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
    "[System.Windows.Forms.Application]::EnableVisualStyles()",
    "$owner = New-Object System.Windows.Forms.Form",
    '$owner.Text = "Ujima Folder Picker"',
    "$owner.TopMost = $true",
    "$owner.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen",
    "$owner.ShowInTaskbar = $false",
    "$owner.WindowState = [System.Windows.Forms.FormWindowState]::Minimized",
    "$owner.Opacity = 0",
    "$owner.Show()",
    "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
    '$dialog.Description = "Select workspace root"',
    "$dialog.ShowNewFolderButton = $true",
    "$result = $dialog.ShowDialog($owner)",
    "$owner.Close()",
    "$owner.Dispose()",
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
      (error, stdout, stderr) => {
        const text = stdout.toString().trim();
        const errorText = stderr.toString().trim();
        if (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code === "ENOENT") {
            reject(error);
            return;
          }
          if (code === "ETIMEDOUT") {
            reject(
              new Error(
                "Folder picker timed out before a selection was made. If no dialog appeared, it may be behind other windows.",
              ),
            );
            return;
          }
          if (!text && ((command === "osascript" && /user canceled|user cancelled/i.test(errorText)) || (!errorText && code === "1"))) {
            resolve({ cancelled: true });
            return;
          }
          reject(new Error(errorText || `Folder picker failed (${command}).`));
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

function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}
