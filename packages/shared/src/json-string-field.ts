export function extractTruncatedJsonString(
  text: string,
  field: string,
): string | undefined {
  const marker = `"${field}"`;
  const keyIndex = text.indexOf(marker);
  if (keyIndex === -1) return undefined;
  const colonIndex = text.indexOf(":", keyIndex + marker.length);
  const quoteIndex = colonIndex === -1 ? -1 : text.indexOf('"', colonIndex + 1);
  if (quoteIndex === -1) return undefined;
  const raw = text.slice(quoteIndex + 1).replace(/"\s*[},]?\s*$/, "");
  if (!raw.trim()) return undefined;
  try {
    return JSON.parse(`"${raw.replace(/\\$/, "")}"`) as string;
  } catch {
    return raw.replace(/\\n/g, "\n").replace(/\\"/g, '"');
  }
}
