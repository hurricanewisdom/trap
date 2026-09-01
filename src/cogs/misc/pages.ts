// The same page shape the information cog uses, kept here so this cog does not
// reach into another one's shared file.
export function pagesOf(
  heading: string,
  lines: string[],
  perPage = 10,
  footer?: string,
): unknown[][] {
  if (lines.length === 0) {
    return [[{ type: 10, content: `### ${heading}\n-# ${footer ?? "nothing here"}` }]];
  }

  const count = Math.ceil(lines.length / perPage);
  return Array.from({ length: count }, (_, page) => {
    const slice = lines.slice(page * perPage, (page + 1) * perPage);
    const tail = [footer, count > 1 ? `page ${page + 1} of ${count}` : null]
      .filter(Boolean)
      .join(" · ");
    return [
      {
        type: 10,
        content: [`### ${heading}`, ...slice, ...(tail ? [`-# ${tail}`] : [])].join("\n"),
      },
    ];
  });
}
