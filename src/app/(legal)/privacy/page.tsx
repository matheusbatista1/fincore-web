import type { Metadata } from "next";
import { LegalDoc, type LegalSection } from "@/presentation/components/legal/legal-doc";

export const metadata: Metadata = {
  title: "Política de Privacidade · FinCore",
  description: "Como o FinCore coleta, usa e protege seus dados.",
};

// NOTE: template copy — not legal advice. Have it reviewed by a lawyer.
const SECTIONS: readonly LegalSection[] = [
  {
    heading: "Dados que coletamos",
    body: [
      "Dados de conta: seu e-mail e uma senha (armazenada de forma cifrada pelo provedor de autenticação).",
      "Dados de perfil: nome de exibição e, opcionalmente, uma foto de perfil que você escolher enviar.",
      "Dados financeiros que você insere: contas, cartões, lançamentos, categorias, pessoas, orçamentos e metas. Esses dados são fornecidos por você e usados apenas para operar o aplicativo.",
      "Histórico de alterações: quando um lançamento é criado, editado, pago ou excluído, guardamos como ele era antes e como ficou depois, para você consultar no detalhe do lançamento.",
      "Avisos no celular, se você ativar: o endereço de notificação que o navegador do aparelho fornece e as chaves públicas desse aparelho (detalhes na seção Avisos no celular, abaixo).",
      "Dados técnicos mínimos necessários para autenticação e segurança da sessão (por exemplo, cookies de sessão).",
      "Relatórios de erro: quando algo falha no navegador, enviamos aos registros do servidor a mensagem técnica do erro, a página em que ele aconteceu e a identificação do navegador, para corrigir a falha. O relatório não inclui seu e-mail nem a identificação da sua conta.",
    ],
  },
  {
    heading: "Como usamos seus dados",
    body: [
      "Usamos seus dados exclusivamente para fornecer o serviço: autenticar seu acesso, exibir e calcular seus saldos, faturas e relatórios, guardar suas preferências e enviar os avisos que você ativar.",
      "Não usamos seus dados financeiros para publicidade e não os vendemos a terceiros.",
    ],
  },
  {
    heading: "Onde seus dados ficam armazenados",
    body: [
      "Os dados são armazenados no Supabase (banco de dados PostgreSQL) e a foto de perfil no serviço de armazenamento do Supabase. A aplicação é hospedada na Vercel, onde também ficam os registros do servidor (incluindo os relatórios de erro).",
      "Cada conta é isolada por políticas de segurança em nível de linha (Row Level Security) no banco de dados: você só acessa os seus próprios dados.",
    ],
  },
  {
    heading: "Compartilhamento",
    body: [
      "Não compartilhamos nem vendemos seus dados pessoais. Utilizamos provedores de infraestrutura (Supabase e Vercel) estritamente para hospedar e operar o serviço, na qualidade de operadores de dados.",
      "Se você ativar os avisos no celular, o serviço de notificações do navegador do aparelho (da Apple no iPhone; do Google, da Mozilla ou da Microsoft em outros navegadores) recebe apenas um sinal vazio para acordar o aparelho, sem nenhum dado financeiro.",
    ],
  },
  {
    heading: "Avisos no celular (opcional)",
    body: [
      "Os avisos só funcionam se você os ativar, aparelho por aparelho, em Configurações › Pagamentos › Avisos no celular. Para recebê-los, o navegador registra um pequeno programa do FinCore (service worker) que só cuida desses avisos e não guarda dados. O endereço e as chaves de cada aparelho são usados apenas para enviar os avisos.",
      "O sinal enviado ao serviço de notificações não tem conteúdo: ao recebê-lo, o próprio aparelho pede o texto ao FinCore com a sua sessão. Por isso nomes e valores não passam por esse serviço.",
      "O aviso mostra nomes e valores na tela do aparelho, inclusive com ela bloqueada. Se outras pessoas costumam ver o seu celular, você pode ocultar a pré-visualização das notificações nos ajustes do aparelho ou desativar os avisos.",
      "Ao desativar os avisos, ou ao excluir a conta, o registro do aparelho é apagado. Um aparelho que deixa de aceitar avisos (por exemplo, quando o app é removido da tela de início) também é apagado, no envio seguinte.",
    ],
  },
  {
    heading: "Seus direitos (LGPD)",
    body: [
      "Você pode acessar, corrigir e excluir seus dados a qualquer momento dentro do próprio aplicativo. Um lançamento excluído deixa de aparecer, mas continua guardado, com o seu histórico de alterações, até a exclusão da conta.",
      "Você pode solicitar a exclusão da sua conta e de todos os dados associados pelo canal de contato abaixo. Ao excluir a conta, os dados vinculados são removidos.",
    ],
  },
  {
    heading: "Segurança",
    body: [
      "O tráfego é protegido por criptografia em trânsito (HTTPS). Você pode ativar a autenticação em duas etapas (2FA) nas configurações para uma camada extra de proteção.",
      "Apesar dos cuidados, nenhum sistema é 100% seguro. Use uma senha forte e mantenha seu dispositivo protegido.",
    ],
  },
  {
    heading: "Cookies",
    body: [
      "Utilizamos apenas cookies essenciais para manter sua sessão autenticada. Não usamos cookies de rastreamento publicitário.",
    ],
  },
  {
    heading: "Contato",
    body: [
      "Dúvidas sobre privacidade ou solicitações relativas aos seus dados podem ser enviadas para matheusbatista.tech@gmail.com.",
    ],
  },
];

export default function PrivacyPage() {
  return (
    <LegalDoc
      title="Política de Privacidade"
      updatedAt="13 de novembro de 2026"
      intro="Esta política explica quais dados o FinCore coleta, como eles são usados e protegidos, e quais são os seus direitos. O FinCore é um aplicativo de finanças pessoais e leva a sério a privacidade dos seus dados financeiros."
      sections={SECTIONS}
    />
  );
}
