import AppShell from "@/components/AppShell";
import { Suspense } from "react";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <Suspense><AppShell>{children}</AppShell></Suspense>;
}
