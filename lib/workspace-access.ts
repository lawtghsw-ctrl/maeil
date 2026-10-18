/** Global platform pages expose aggregates. Customer work requires a selected firm. */
export function requiresFirmWorkspace(pathname: string): boolean {
  return !(pathname === "/" || pathname === "/analytics" || pathname === "/account" || pathname === "/platform" || pathname.startsWith("/platform/"));
}
