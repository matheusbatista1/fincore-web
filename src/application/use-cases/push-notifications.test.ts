import { describe, expect, it, vi } from "vitest";
import type { PushDevice } from "@/domain/entities/push-device";
import type { ExpenseTransaction, Transaction } from "@/domain/entities/transaction";
import type { DueDigest } from "@/domain/services/due-digest";
import type { FinanceRepository, Workspace } from "../ports/finance-repository";
import type { PushOutcome, PushSender } from "../ports/push-sender";
import {
  digestMessage,
  forgetPushDevice,
  getPushMessage,
  notifyDue,
  registerPushDevice,
  sendTestPush,
} from "./push-notifications";

const TODAY = "2026-06-14";
const PHONE = "https://web.push.apple.com/phone";
const LAPTOP = "https://fcm.googleapis.com/fcm/send/laptop";

/** `Intl` separates "R$" from the figure with a no-break space; the tests read plain ones. */
const plain = (text: string): string => text.replace(/ /g, " ");

const boleto = (cents: number, date: string, description = "Internet"): ExpenseTransaction => ({
  id: `${description}-${date}`,
  kind: "expense",
  description,
  date,
  amountCents: -cents,
  categoryId: null,
  source: "boleto",
  cardId: null,
  accountId: null,
  linkedAccountId: null,
  splits: [],
  myShareCents: cents,
  installment: null,
  recurrence: null,
  billMonthOverride: null,
});

const device = (endpoint: string): PushDevice => ({ id: endpoint, endpoint, p256dh: "key", auth: "secret" });

function repoWith(transactions: Transaction[], devices: PushDevice[] = []) {
  const ws: Workspace = {
    accounts: [],
    creditCards: [],
    people: [],
    categories: [],
    transactions,
    settlements: [],
    budgets: [],
    goals: [],
    cardBillDates: [],
    cardBillPayments: [],
  };
  const raw = {
    loadWorkspace: vi.fn(async () => ws),
    listPushDevices: vi.fn(async () => devices),
    savePushDevice: vi.fn(async () => undefined),
    deletePushDevice: vi.fn(async () => undefined),
  };
  return { repo: raw as unknown as FinanceRepository, raw };
}

const senderAnswering = (outcomes: Record<string, PushOutcome>) => {
  const send = vi.fn(async (endpoint: string) => outcomes[endpoint] ?? "sent");
  return { sender: { send } satisfies PushSender, send };
};

describe("digestMessage", () => {
  const item = (label: string, cents: number) => ({ label, cents, date: TODAY }) as const;
  const digest = (over: Partial<DueDigest>): DueDigest => ({ overdue: [], today: [], tomorrow: [], ...over });

  it("puts what is due today in the title, and each group on its own line", () => {
    const message = digestMessage(
      digest({
        today: [item("Fatura Nubank", 80_000), item("Internet", 12_000)],
        tomorrow: [item("Aluguel", 185_000)],
        overdue: [item("Condomínio", 8_000)],
      }),
    );
    expect(plain(message.title)).toBe("Vence hoje: R$ 920,00");
    expect(plain(message.body)).toBe(
      "Hoje: Fatura Nubank R$ 800,00, Internet R$ 120,00\nAmanhã: Aluguel R$ 1.850,00\nEm atraso: Condomínio R$ 80,00",
    );
    expect(message.due).toBe(true);
    expect(message.url).toBe("/monthly");
  });

  it("leads with what is late when nothing is due today, then with tomorrow", () => {
    const late = digestMessage(digest({ overdue: [item("Luz", 9_000)], tomorrow: [item("Água", 4_000)] }));
    expect(plain(late.title)).toBe("Em atraso: R$ 90,00");
    expect(plain(late.body)).toBe("Amanhã: Água R$ 40,00\nEm atraso: Luz R$ 90,00");

    const ahead = digestMessage(digest({ tomorrow: [item("Água", 4_000)] }));
    expect(plain(ahead.title)).toBe("Vence amanhã: R$ 40,00");
    expect(plain(ahead.body)).toBe("Amanhã: Água R$ 40,00");
  });

  it("names three items of a long list and counts the rest", () => {
    const many = ["A", "B", "C", "D", "E"].map((label) => item(label, 1_000));
    const message = digestMessage(digest({ today: many }));
    expect(plain(message.body)).toBe("Hoje: A R$ 10,00, B R$ 10,00, C R$ 10,00 e mais 2");
    expect(plain(message.title)).toBe("Vence hoje: R$ 50,00");
  });

  it("still has something to say on a quiet day", () => {
    expect(digestMessage(digest({}))).toEqual({
      title: "FinCore",
      body: "Tudo em dia: nada vence hoje nem amanhã.",
      url: "/monthly",
      due: false,
    });
  });
});

describe("getPushMessage", () => {
  it("reads the user's book and words what is due", async () => {
    const { repo, raw } = repoWith([boleto(12_000, TODAY), boleto(5_000, "2026-07-20", "Longe")]);
    const message = await getPushMessage(repo, "u", TODAY);
    expect(raw.loadWorkspace).toHaveBeenCalledWith("u");
    expect(plain(message.title)).toBe("Vence hoje: R$ 120,00");
    expect((await getPushMessage(repoWith([]).repo, "u", TODAY)).due).toBe(false);
  });
});

describe("registerPushDevice / forgetPushDevice", () => {
  it("stores a device whose endpoint is a known push service", async () => {
    const { repo, raw } = repoWith([]);
    const input = { endpoint: PHONE, p256dh: "key", auth: "secret" };
    expect(await registerPushDevice(repo, "u", input)).toEqual({ ok: true, value: undefined });
    expect(raw.savePushDevice).toHaveBeenCalledWith("u", input);
  });

  it("refuses, and never stores, an endpoint that is not one", async () => {
    const { repo, raw } = repoWith([]);
    for (const endpoint of ["https://example.com/hook", "http://localhost:5432", "nonsense"]) {
      const result = await registerPushDevice(repo, "u", { endpoint, p256dh: "key", auth: "secret" });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("invalid-endpoint");
    }
    expect(raw.savePushDevice).not.toHaveBeenCalled();
  });

  it("forgets a device by its endpoint", async () => {
    const { repo, raw } = repoWith([]);
    await forgetPushDevice(repo, "u", PHONE);
    expect(raw.deletePushDevice).toHaveBeenCalledWith("u", PHONE);
  });
});

describe("notifyDue", () => {
  it("does nothing, and reads nothing else, for a user with no device", async () => {
    const { repo, raw } = repoWith([boleto(12_000, TODAY)]);
    const { sender, send } = senderAnswering({});
    expect(await notifyDue(repo, sender, "u", TODAY)).toEqual({ devices: 0, sent: 0, removed: 0, failed: 0 });
    expect(raw.loadWorkspace).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("stays quiet when there is nothing to pay", async () => {
    const { repo } = repoWith([boleto(12_000, "2026-07-20")], [device(PHONE)]);
    const { sender, send } = senderAnswering({});
    expect(await notifyDue(repo, sender, "u", TODAY)).toEqual({ devices: 1, sent: 0, removed: 0, failed: 0 });
    expect(send).not.toHaveBeenCalled();
  });

  it("pushes to every device when something is due, and forgets the ones that are gone", async () => {
    const gone = "https://updates.push.services.mozilla.com/wpush/v2/old";
    const { repo, raw } = repoWith([boleto(12_000, TODAY)], [device(PHONE), device(LAPTOP), device(gone)]);
    const { sender, send } = senderAnswering({ [LAPTOP]: "failed", [gone]: "gone" });
    expect(await notifyDue(repo, sender, "u", TODAY)).toEqual({ devices: 3, sent: 1, removed: 1, failed: 1 });
    expect(send.mock.calls.map((call) => call[0])).toEqual([PHONE, LAPTOP, gone]);
    // A push that merely failed keeps its device: tomorrow is another day.
    expect(raw.deletePushDevice).toHaveBeenCalledTimes(1);
    expect(raw.deletePushDevice).toHaveBeenCalledWith("u", gone);
  });
});

describe("sendTestPush", () => {
  it("pushes to the device that asked, whatever there is to pay", async () => {
    const { repo } = repoWith([], [device(PHONE), device(LAPTOP)]);
    const { sender, send } = senderAnswering({});
    expect(await sendTestPush(repo, sender, "u", PHONE)).toEqual({ ok: true, value: undefined });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(PHONE);
  });

  it("only ever pushes to one of the user's own devices", async () => {
    const { repo } = repoWith([], [device(PHONE)]);
    const { sender, send } = senderAnswering({});
    const result = await sendTestPush(repo, sender, "u", LAPTOP);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("unknown-device");
    expect(send).not.toHaveBeenCalled();
  });

  it("forgets a device that is gone, and says so; a failure keeps it", async () => {
    const lost = repoWith([], [device(PHONE)]);
    const goneResult = await sendTestPush(lost.repo, senderAnswering({ [PHONE]: "gone" }).sender, "u", PHONE);
    expect(goneResult.ok).toBe(false);
    if (!goneResult.ok) expect(goneResult.error.code).toBe("gone");
    expect(lost.raw.deletePushDevice).toHaveBeenCalledWith("u", PHONE);

    const away = repoWith([], [device(PHONE)]);
    const failed = await sendTestPush(away.repo, senderAnswering({ [PHONE]: "failed" }).sender, "u", PHONE);
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.error.code).toBe("failed");
    expect(away.raw.deletePushDevice).not.toHaveBeenCalled();
  });
});
