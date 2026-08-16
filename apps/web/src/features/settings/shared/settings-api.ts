import { clientFetchJson, clientFetchVoid } from "@/lib/client-api";

export async function settingsFetch<T>(
  url: string,
  init?: RequestInit,
  fallbackMessage = "Request failed",
): Promise<T> {
  return clientFetchJson<T>(url, init, fallbackMessage);
}

export async function settingsFetchVoid(
  url: string,
  init?: RequestInit,
  fallbackMessage = "Request failed",
): Promise<void> {
  return clientFetchVoid(url, init, fallbackMessage);
}
