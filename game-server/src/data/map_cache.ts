import { readFileSync } from "fs";

const _cache = new Map<string, any>();

export function getCachedFile<T = any>(filePath: string): T {
  if (_cache.has(filePath)) return _cache.get(filePath) as T;
  const data: T = JSON.parse(readFileSync(filePath, "utf-8"));
  _cache.set(filePath, data);
  return data;
}
