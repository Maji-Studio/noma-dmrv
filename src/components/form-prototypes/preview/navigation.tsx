import { useSyncExternalStore } from "react";
function subscribe(callback: () => void) {
  window.addEventListener("popstate", callback);
  return () => window.removeEventListener("popstate", callback);
}
function useLocation() {
  return useSyncExternalStore(subscribe, () => window.location.href);
}
export function usePathname() { return new URL(useLocation()).pathname; }
export function useSearchParams() { return new URL(useLocation()).searchParams; }
export function useRouter() {
  return { replace(url: string) { window.history.replaceState(null, "", url); window.dispatchEvent(new PopStateEvent("popstate")); } };
}
