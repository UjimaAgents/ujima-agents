import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { NextResponse } from "next/server";

const execFileAsync = promisify(execFile);

export const dynamic = "force-dynamic";

export async function POST() {
  if (process.platform !== "win32") {
    return NextResponse.json(
      { code: "ERR_UNSUPPORTED_PLATFORM", message: "Native folder picker is only available on Windows." },
      { status: 400 },
    );
  }

  const script = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
    '$dialog.Description = "Select workspace root"',
    "$dialog.ShowNewFolderButton = $true",
    "$result = $dialog.ShowDialog()",
    "if ($result -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dialog.SelectedPath }",
  ].join("; ");

  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-STA", "-Command", script],
      { timeout: 120000, windowsHide: false, maxBuffer: 1024 * 1024 },
    );

    const selectedPath = stdout.trim();
    if (!selectedPath) {
      return NextResponse.json({ cancelled: true }, { status: 200 });
    }

    return NextResponse.json({ path: selectedPath }, { status: 200 });
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
