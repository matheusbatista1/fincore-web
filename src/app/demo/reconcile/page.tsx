import { getWorkspaceView } from "@/application/use-cases/get-workspace-view";
import { requireDemo } from "@/infrastructure/demo/demo-flag";
import { DEMO_USER_ID, demoRepository } from "@/infrastructure/demo/demo-repository";
import { demoStatement } from "@/infrastructure/demo/demo-statement";
import { demoWorkspace } from "@/infrastructure/demo/demo-workspace";
import { ReconcileView } from "@/presentation/components/reconcile/reconcile-view";
import { Icon } from "@/presentation/components/ui/icon";
import { currentMonthInBrazil, todayInBrazil } from "@/shared/formatting/now";
import { demoReconcileAction } from "./actions";

/** Excel reads accents right only with a byte-order mark; built here, never typed into the source. */
const BOM = String.fromCharCode(0xfeff);

/**
 * The real "Conferir extrato" screen over the made-up household, with the bank statement that
 * goes with it ready to download: a file with a few differences left in on purpose.
 */
export default async function DemoReconcile() {
  requireDemo();
  const today = todayInBrazil();
  const workspace = await getWorkspaceView(demoRepository(today), DEMO_USER_ID);
  const statement = demoStatement(demoWorkspace(today), today);

  return (
    <div className="col gap-4">
      <div className="card card-pad">
        <p className="rc-note" style={{ marginBottom: 10 }}>
          Para experimentar, baixe o extrato de exemplo da conta corrente e escolha-o abaixo. Ele tem três
          linhas que faltam no app, um lançamento que o banco não tem, três pedágios lançados como um só e uma
          compra com o estorno dela.
        </p>
        <a
          id="demo-statement"
          className="btn btn-ghost btn-sm"
          download={statement.fileName}
          href={`data:text/csv;charset=utf-8,${encodeURIComponent(BOM + statement.csv)}`}
        >
          <Icon name="file-down" size={15} />
          Baixar extrato de exemplo
        </a>
      </div>
      <ReconcileView
        accounts={workspace.accounts.map((a) => ({ id: a.id, bank: a.bank, name: a.name }))}
        cards={workspace.cards.map((c) => ({ id: c.id, bank: c.bank, product: c.product }))}
        currentMonth={currentMonthInBrazil()}
        initialAccountId={statement.accountId}
        ask={demoReconcileAction}
      />
    </div>
  );
}
