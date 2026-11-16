import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useState } from "react";
import { useUi } from "../lib/ui";
import { openAccountPage } from "../lib/cloud";
import { getAiSettings, isTauri, setAiSettings } from "../lib/tauri";

const PROVIDERS = [
  ["", "Harfsaz AI (hosted)"],
  ["openai", "OpenAI"],
  ["anthropic", "Anthropic"],
  ["gemini", "Google Gemini"],
  ["deepseek", "DeepSeek"],
  ["mistral", "Mistral"],
  ["custom", "OpenAI-compatible endpoint"],
  ["claude-cli", "Claude CLI"],
];
const field = "w-full rounded-lg border border-line bg-paper p-2";

export function SettingsDialog() {
  const open = useUi(s => s.settingsOpen), setOpen = useUi(s => s.setSettingsOpen);
  return <Dialog.Root open={open} onOpenChange={setOpen}><Dialog.Portal>
    <Dialog.Overlay className="fixed inset-0 z-50 bg-black/30" />
    <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[460px] max-w-[94vw] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-line bg-surface p-6 shadow-harfsaz">
      <Dialog.Title className="text-lg font-semibold">Settings</Dialog.Title>
      <Dialog.Description className="mt-2 text-sm text-ink-soft">
        {isTauri() ? "Choose how the editor connects to AI and manage your account." : "Manage your personal information, password, Google sign-in, and connected devices."}
      </Dialog.Description>
      {isTauri() && <DesktopAiSettings onSaved={() => setOpen(false)} />}
      <div className="mt-5 flex flex-wrap gap-3">
        <button className="rounded-lg border border-line px-4 py-2" onClick={() => void openAccountPage()}>Manage account ↗</button>
        <Dialog.Close className="rounded-lg border border-line px-4 py-2">Close</Dialog.Close>
      </div>
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}

function DesktopAiSettings({ onSaved }: { onSaved: () => void }) {
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [saved, setSaved] = useState<Awaited<ReturnType<typeof getAiSettings>> | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let active = true;
    getAiSettings().then(settings => {
      if (!active) return;
      setSaved(settings);
      setProvider(settings.provider);
      setModel(settings.model);
      setEndpoint(settings.endpoint);
      setSystemPrompt(settings.system_prompt);
    }).catch(error => { if (active) setError(String(error)); });
    return () => { active = false; };
  }, []);

  const needsKey = !!provider && provider !== "claude-cli";
  const hasKey = saved?.has_key && saved.provider === provider &&
    (provider !== "custom" || saved.endpoint === endpoint.trim());

  return <form className="mt-5 grid gap-3 text-sm" onSubmit={async e => {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      await setAiSettings(provider, apiKey, model, endpoint, systemPrompt);
      onSaved();
    } catch (error) {
      setError(String(error));
    } finally {
      setSaving(false);
    }
  }}>
    <fieldset disabled={!saved || saving} className="grid gap-3">
      <label className="grid gap-1">AI provider
        <select className={field} value={provider} onChange={e => {
          const next = e.target.value;
          setProvider(next);
          setApiKey("");
          setModel(saved?.provider === next ? saved?.model ?? "" : "");
          setEndpoint(saved?.provider === next ? saved?.endpoint ?? "" : "");
        }}>
          {PROVIDERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      {provider === "custom" && <label className="grid gap-1">Chat completions URL
        <input className={field} type="url" value={endpoint} onChange={e => {
          setEndpoint(e.target.value);
          setApiKey("");
        }} required placeholder="https://example.com/v1/chat/completions" />
      </label>}
      {needsKey && <label className="grid gap-1">API key
        <input className={field} type="password" autoComplete="off" value={apiKey}
          onChange={e => setApiKey(e.target.value)} required={!hasKey}
          placeholder={hasKey ? "Saved key on this device" : "Enter provider key"} />
      </label>}
      {provider && <>
        <label className="grid gap-1">Model ID
          <input className={field} value={model} onChange={e => setModel(e.target.value)} required={provider === "custom"}
            placeholder="Provider default" />
        </label>
        <label className="grid gap-1">Custom system instructions for chat and writing
          <textarea className={field} rows={3} value={systemPrompt} onChange={e => setSystemPrompt(e.target.value)} />
        </label>
        <p className="text-xs text-ink-soft">AI requests go directly to the selected provider using your account and its billing.</p>
      </>}
      <button className="justify-self-start rounded-lg bg-accent px-4 py-2 text-white" type="submit">
        {saving ? "Saving…" : "Save AI settings"}
      </button>
    </fieldset>
    {error && <p role="alert" className="text-danger">{error}</p>}
  </form>;
}
