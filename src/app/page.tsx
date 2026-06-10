/**
 * Temporary design-system smoke test.
 * Validates that the Tailwind v4 pipeline + ported tokens render correctly.
 * Replaced by the real authenticated app shell in a later phase.
 */
export default function HomePage() {
  return (
    <main className="relative z-10 mx-auto flex min-h-dvh max-w-4xl flex-col gap-8 px-6 py-16">
      <header className="flex flex-col gap-2">
        <span className="font-display text-2xl font-semibold tracking-tight text-text-hi">
          Fin<span className="text-purple-500">Core</span>
        </span>
        <h1 className="font-display text-4xl font-semibold text-text-hi">
          Sua vida financeira, com clareza.
        </h1>
        <p className="max-w-xl text-text-mid">
          Scaffold inicial validando o design system. Contas, cartões, parcelamentos e gastos compartilhados
          chegam nas próximas etapas.
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-3">
        <article className="rounded-lg border border-line bg-surface-1 p-6 shadow-2">
          <p className="text-xs font-semibold uppercase tracking-widest text-text-faint">Saldo total</p>
          <p className="tnum mt-2 font-display text-3xl font-semibold text-text-hi">R$ 56.961,55</p>
          <p className="mt-1 text-sm text-mint-500">↑ 8,3% no mês</p>
        </article>
        <article className="rounded-lg border border-line bg-surface-1 p-6 shadow-2">
          <p className="text-xs font-semibold uppercase tracking-widest text-text-faint">Receitas</p>
          <p className="tnum mt-2 font-display text-3xl font-semibold text-mint-500">R$ 14.200,00</p>
        </article>
        <article className="rounded-lg border border-line bg-surface-1 p-6 shadow-2">
          <p className="text-xs font-semibold uppercase tracking-widest text-text-faint">Despesas</p>
          <p className="tnum mt-2 font-display text-3xl font-semibold text-rose-500">R$ 9.080,00</p>
        </article>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="rounded-pill bg-purple-500 px-5 py-2.5 font-semibold text-on-purple shadow-glow transition hover:bg-purple-600"
        >
          Novo lançamento
        </button>
        <span className="rounded-pill bg-mint-soft px-3 py-1 text-sm font-medium text-mint-500">Receita</span>
        <span className="rounded-pill bg-rose-soft px-3 py-1 text-sm font-medium text-rose-500">Despesa</span>
        <span className="rounded-pill bg-amber-soft px-3 py-1 text-sm font-medium text-amber-500">
          Vencimento
        </span>
        <span className="rounded-pill bg-sky-soft px-3 py-1 text-sm font-medium text-sky-500">
          Transferência
        </span>
      </div>
    </main>
  );
}
