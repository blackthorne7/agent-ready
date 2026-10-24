/** Plain GET form so it works with or without JavaScript (agents included). */
export function AuditForm({ defaultValue = "", id = "url" }: { defaultValue?: string; id?: string }) {
  return (
    <form action="/report" method="get" className="flex w-full flex-col gap-2 text-left">
      <label htmlFor={id} className="font-semibold">
        Your website
      </label>
      <div className="flex flex-wrap gap-2 rounded-2xl border border-border-strong bg-card p-2">
        <input
          id={id}
          name="url"
          type="text"
          required
          defaultValue={defaultValue}
          placeholder="yourbusiness.com"
          autoComplete="url"
          className="h-13 min-w-0 flex-[1_1_240px] bg-transparent px-3.5 text-[19px] text-foreground outline-none placeholder:text-[#8e8e93]"
        />
        <button type="submit" className="h-13 cursor-pointer rounded-xl bg-accent px-6 text-[19px] font-bold text-white hover:brightness-110">
          Get my score
        </button>
      </div>
    </form>
  );
}
