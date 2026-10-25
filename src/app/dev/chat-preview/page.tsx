import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { Chat } from "../../chat";
import { applicationMessages, loginAskMessages, previewMessages } from "./fixture";

/**
 * Development only: the chat rendered with a sample conversation, for working on the UI.
 * `?login=1` ends it with the askForLogin card; `?app=<uuid>` with one of your applications' cards.
 */
export default function ChatPreview({ searchParams }: PageProps<"/dev/chat-preview">) {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <Suspense fallback={null}>
      <Preview searchParams={searchParams} />
    </Suspense>
  );
}

async function Preview({ searchParams }: Pick<PageProps<"/dev/chat-preview">, "searchParams">) {
  const params = await searchParams;
  const app = z.uuid().safeParse(params.app);
  const messages = [
    ...previewMessages,
    ...(params.login ? loginAskMessages : []),
    ...(app.success ? applicationMessages(app.data) : []),
  ];
  return <Chat initialMessages={messages} />;
}
