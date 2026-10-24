/** Plain GET form so it works with or without JavaScript (agents included). */
export function AuditForm({ defaultValue = "" }: { defaultValue?: string }) {
  return (
    <form action="/report" method="get" className="flex w-full flex-col gap-2 sm:flex-row">
      <label htmlFor="url" className="sr-only">
        Website URL
      </label>
      <input
        id="url"
        name="url"
        type="text"
        required
        defaultValue={defaultValue}
        placeholder="yourrestaurant.com"
        autoComplete="url"
        className="h-12 flex-1 rounded-xl border border-border bg-card px-4 text-base outline-none focus:ring-2 focus:ring-emerald-500"
      />
      <button type="submit" className="h-12 rounded-xl bg-emerald-600 px-6 font-medium text-white hover:bg-emerald-700">
        Audit site
      </button>
    </form>
  );
}
