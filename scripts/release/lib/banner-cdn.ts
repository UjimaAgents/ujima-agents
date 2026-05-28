/** Public CDN URL for README banner (jsDelivr mirrors the npm package). */
export function bannerCdnUrl(version = 'latest'): string {
  return `https://cdn.jsdelivr.net/npm/@ujima/agents@${version}/assets/banner.png`;
}
