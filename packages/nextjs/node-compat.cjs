/**
 * One line of Node compatibility, loaded before Next.js starts.
 *
 * Node 22 shipped the Web Storage API behind `--experimental-webstorage`; from
 * Node 25 the global exists by default, but without `--localstorage-file` it is
 * an empty stub with no `getItem`. RainbowKit — like most browser libraries —
 * decides whether it is in a browser by asking `typeof localStorage`, which is
 * now `"object"` on the server, so it calls a method that isn't there and the
 * prerender of any page that mounts a wallet button dies with:
 *
 *   TypeError: localStorage.getItem is not a function
 *
 * Removing the stub puts the server back to how every library expects it to
 * look. It is loaded with `--require` rather than from `next.config.ts` because
 * prerendering happens in worker processes, and `NODE_OPTIONS` is inherited by
 * those workers while a module-level statement in the config is not.
 *
 * The guard means this is a no-op everywhere it isn't needed: a real browser
 * localStorage has `getItem`, and Node 20/22 has no global at all.
 */
if (typeof globalThis.localStorage !== "undefined" && typeof globalThis.localStorage.getItem !== "function") {
  delete globalThis.localStorage;
  delete globalThis.sessionStorage;
}
