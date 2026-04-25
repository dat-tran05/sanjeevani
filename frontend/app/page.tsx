import { Chat } from "@/components/chat/Chat";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-slate-50">
      <div className="border-b bg-white">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <h1 className="text-xl font-semibold">Sanjeevani</h1>
          <p className="text-sm text-slate-500">
            Agentic healthcare intelligence for India
          </p>
        </div>
      </div>
      <Chat />
    </main>
  );
}
