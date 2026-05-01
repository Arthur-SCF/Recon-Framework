import * as Tabs from "@radix-ui/react-tabs";
import { PageTransition } from "@/components/PageTransition";
import { cn } from "@/lib/utils";
import { AppearanceTab } from "@/pages/settings/AppearanceTab";
import { TelegramTab } from "@/pages/settings/TelegramTab";
import { ApiKeysTab } from "@/pages/settings/ApiKeysTab";
import { GeneralTab } from "@/pages/settings/GeneralTab";
import { ToolsTab } from "@/pages/settings/ToolsTab";
import { WordlistsTab } from "@/pages/settings/WordlistsTab";
import { TemplatesTab } from "@/pages/settings/TemplatesTab";
import { StorageTab } from "@/pages/settings/StorageTab";
import { WebhooksTab } from "@/pages/settings/WebhooksTab";
import { ReportsTab } from "@/pages/settings/ReportsTab";

const tabs = [
  { id: "appearance", label: "Appearance" },
  { id: "telegram",   label: "Telegram" },
  { id: "webhooks",   label: "Webhooks" },
  { id: "api-keys",   label: "API Keys" },
  { id: "general",    label: "General" },
  { id: "tools",      label: "Tools" },
  { id: "wordlists",  label: "Wordlists" },
  { id: "templates",  label: "Templates" },
  { id: "storage",    label: "Storage" },
  { id: "reports",    label: "Reports" },
];

export function Settings() {
  return (
    <PageTransition>
      <div className="flex flex-col gap-6 p-3 sm:p-6 max-w-3xl mx-auto w-full">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Settings</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Configure the engine, notifications, and API keys
          </p>
        </div>

        <Tabs.Root defaultValue="appearance">
          <div className="overflow-x-auto pb-px -mx-0.5 px-0.5">
            <Tabs.List className="flex gap-1 border-b border-border min-w-max">
              {tabs.map(({ id, label }) => (
                <Tabs.Trigger
                  key={id}
                  value={id}
                  className={cn(
                    "px-3 py-2 text-sm transition-colors border-b-2 -mb-px whitespace-nowrap",
                    "text-muted-foreground border-transparent",
                    "data-[state=active]:text-foreground data-[state=active]:border-primary",
                    "hover:text-foreground",
                  )}
                >
                  {label}
                </Tabs.Trigger>
              ))}
            </Tabs.List>
          </div>

          <Tabs.Content value="appearance"><AppearanceTab /></Tabs.Content>
          <Tabs.Content value="telegram"><TelegramTab /></Tabs.Content>
          <Tabs.Content value="webhooks"><WebhooksTab /></Tabs.Content>
          <Tabs.Content value="api-keys"><ApiKeysTab /></Tabs.Content>
          <Tabs.Content value="general"><GeneralTab /></Tabs.Content>
          <Tabs.Content value="tools"><ToolsTab /></Tabs.Content>
          <Tabs.Content value="wordlists"><WordlistsTab /></Tabs.Content>
          <Tabs.Content value="templates"><TemplatesTab /></Tabs.Content>
          <Tabs.Content value="storage"><StorageTab /></Tabs.Content>
          <Tabs.Content value="reports"><ReportsTab /></Tabs.Content>
        </Tabs.Root>
      </div>
    </PageTransition>
  );
}
