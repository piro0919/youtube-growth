// src/types/page-props.ts
// eslint-disable-next-line filenames/match-regex
export type PageProps<
  Params extends Record<string, string> = Record<string, string>,
  SearchParams extends Record<string, string | string[] | undefined> = Record<
    string,
    string | string[] | undefined
  >,
> = Readonly<{
  params: Promise<Params>;
  searchParams: Promise<SearchParams>;
}>;

export type LayoutProps<
  Params extends Record<string, string> = Record<string, string>,
> = Readonly<{
  children: React.ReactNode;
  params?: Promise<Params>;
}>;
