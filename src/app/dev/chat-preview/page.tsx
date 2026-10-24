import { notFound } from "next/navigation";
import { Chat } from "../../chat";
import { previewMessages } from "./fixture";

/** Development only: the chat rendered with a sample conversation, for working on the UI. */
export default function ChatPreview() {
  if (process.env.NODE_ENV === "production") notFound();
  return <Chat initialMessages={previewMessages} />;
}
