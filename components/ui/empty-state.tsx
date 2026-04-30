export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="border-2 border-dashed border-slate-200 rounded-2xl p-8 text-center bg-white">
      <p className="text-base font-semibold text-slate-700 mb-1">{title}</p>
      <p className="text-sm text-slate-500">{description}</p>
    </div>
  );
}
