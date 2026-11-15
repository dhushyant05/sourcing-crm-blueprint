import type { Category } from './types';

export function sortByName<T extends { name: string }>(rows: T[]) {
  return [...rows].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

export function childrenOf(categories: Category[], parentId: string | null | undefined) {
  return sortByName(categories.filter((c) => (parentId ? c.parentId === parentId : !c.parentId)));
}

export function topLevel(categories: Category[]) {
  const ids = new Set(categories.map((c) => c.id));
  return sortByName(categories.filter((c) => !c.parentId || !ids.has(c.parentId)));
}

export function categoryBySlug(categories: Category[], slug?: string | null) {
  if (!slug) return undefined;
  return categories.find((c) => c.slug === slug);
}

export function breadcrumbOf(categories: Category[], start?: Category | { id?: string; slug?: string | null; name?: string | null } | null) {
  if (!start) return [] as Category[];
  const byId = new Map(categories.map((c) => [c.id, c]));
  const bySlug = new Map(categories.map((c) => [c.slug, c]));
  let cur: Category | undefined = ('slug' in start && start.slug && bySlug.get(start.slug))
    || ('id' in start && start.id && byId.get(start.id))
    || undefined;
  if (!cur && 'name' in start && start.name && start.slug) {
    return [{ id: start.id ?? start.slug, slug: start.slug, name: start.name, parentId: null }];
  }
  const path: Category[] = [];
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    path.unshift(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return path;
}

export function descendantIds(categories: Category[], rootId: string) {
  const kids = new Map<string, Category[]>();
  for (const c of categories) {
    const k = c.parentId || '';
    kids.set(k, [...(kids.get(k) ?? []), c]);
  }
  const out = new Set<string>([rootId]);
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    for (const ch of kids.get(id) ?? []) {
      if (out.has(ch.id)) continue;
      out.add(ch.id);
      stack.push(ch.id);
    }
  }
  return out;
}

export function inCategoryTree(product: { category?: { id?: string; slug?: string | null } | null; categoryId?: string | null; categorySlug?: string | null }, cat: Category, categories: Category[]) {
  const ids = descendantIds(categories, cat.id);
  const slugs = new Set(categories.filter((c) => ids.has(c.id)).map((c) => c.slug));
  return (product.category?.id && ids.has(product.category.id))
    || (product.categoryId && ids.has(product.categoryId))
    || (product.category?.slug && slugs.has(product.category.slug))
    || (product.categorySlug && slugs.has(product.categorySlug));
}

export function optionLabel(categories: Category[], cat: Category) {
  const path = breadcrumbOf(categories, cat);
  return path.map((c) => c.name).join(' / ');
}
