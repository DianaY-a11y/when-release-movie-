import { redirect } from "next/navigation";

type SearchParams = Promise<{ s?: string }>;

// The calendar is now the home page. Preserve old links (including share scenarios).
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { s } = await searchParams;
  redirect(s ? `/?s=${s}` : "/");
}
