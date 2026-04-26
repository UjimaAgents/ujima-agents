import { NextResponse } from "next/server";
import { fetchUjimaApi } from "@/lib/ujima-api";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const response = await fetchUjimaApi("/api/bootstrap");
    const payload = await response.json();

    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    return NextResponse.json(
      {
        code: "ERR_UPSTREAM_UNAVAILABLE",
        message: error instanceof Error ? error.message : "Unable to reach the Ujima API.",
      },
      { status: 503 },
    );
  }
}
