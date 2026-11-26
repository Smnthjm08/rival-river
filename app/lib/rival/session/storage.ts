/** sessionStorage in the browser (per tab, survives a reload), memory elsewhere. */
const memory = new Map<string, string>();

export const store = {
  get: (k: string) =>
    typeof sessionStorage !== "undefined"
      ? sessionStorage.getItem(k)
      : memory.get(k) ?? null,
  set: (k: string, v: string) =>
    typeof sessionStorage !== "undefined"
      ? sessionStorage.setItem(k, v)
      : void memory.set(k, v),
  remove: (k: string) =>
    typeof sessionStorage !== "undefined"
      ? sessionStorage.removeItem(k)
      : void memory.delete(k),
};
