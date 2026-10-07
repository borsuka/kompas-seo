/** Reads emails sent by the app from Mailpit (local SMTP catcher). */
const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025';

interface MailpitSearch {
  messages: { ID: string; Subject: string; To: { Address: string }[] }[];
}

export async function waitForEmailLink(
  to: string,
  pathFragment: string,
  timeoutMs = 20_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
    const data = (await res.json()) as MailpitSearch;
    for (const msg of data.messages ?? []) {
      const full = (await (await fetch(`${MAILPIT}/api/v1/message/${msg.ID}`)).json()) as {
        Text: string;
      };
      const link = full.Text.match(/https?:\/\/\S+/g)?.find((u) => u.includes(pathFragment));
      if (link) return link;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No email to ${to} containing "${pathFragment}" within ${timeoutMs}ms`);
}

export function uniqueEmail(prefix: string) {
  return `${prefix}.${Date.now()}.${Math.random().toString(36).slice(2, 7)}@e2e.test`;
}
