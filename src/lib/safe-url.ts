/**
 * Provider-relayed URLs (publisher links, image hotlinks) are untrusted remote
 * input that ends up in executable-capable or request-issuing attributes
 * (`href`, `img src`) — and `recipes` rows written before the S-04 hardening
 * could in principle carry anything. Whatever is not plain http(s) is
 * discarded; every caller renders fine without it.
 */
export function safeUrl(url: string | null): URL | null {
  if (!url) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed : null;
}
