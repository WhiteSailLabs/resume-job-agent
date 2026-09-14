import { redirect } from 'next/navigation';

export default async function LegacyComparePage({
  searchParams,
}: {
  searchParams: Promise<{ tailored?: string | string[] }>;
}) {
  const params = await searchParams;
  const tailoredId = Array.isArray(params.tailored) ? params.tailored[0] : params.tailored;

  if (!tailoredId) redirect('/resumes');
  redirect(`/resumes/${encodeURIComponent(tailoredId)}?view=changes`);
}
