import type { ReactNode } from "react";

import Header from "./Header";
import Sidebar from "./Sidebar";

interface LayoutProps {
  children: ReactNode;
}

function Layout({ children }: LayoutProps) {
  return (
    <div className="min-h-screen bg-dark-900 text-slate-100">
      <div className="flex min-h-screen">
        <Sidebar />

        <main className="ml-[240px] flex min-h-screen flex-1 flex-col overflow-hidden">
          <Header />
          <div className="flex-1 overflow-y-auto p-6">{children}</div>
        </main>
      </div>
    </div>
  );
}

export default Layout;