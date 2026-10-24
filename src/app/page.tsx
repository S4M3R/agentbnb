import type { Metadata } from "next";
import { Chat } from "./chat";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

export default function Home() {
  return <Chat />;
}
