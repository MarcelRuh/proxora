"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { ConfirmAction } from "@/components/confirm-action";
import { api } from "@/lib/api";
import { useI18n } from "@/components/i18n/locale-provider";
import { NOTIFICATION_TOPICS, type NotificationTopic } from "@/lib/notification-topics";
import type { MessageKey } from "@/lib/i18n/messages";

type Channel = {
  id: string;
  type: string;
  name: string;
  enabled: boolean;
  events: NotificationTopic[] | null;
};

function topicKey(topic: NotificationTopic): MessageKey {
  return `notify.topic.${topic}` as MessageKey;
}

function EventChecks({
  value,
  onChange,
}: {
  value: NotificationTopic[];
  onChange: (next: NotificationTopic[]) => void;
}) {
  const { t } = useI18n();
  function toggle(topic: NotificationTopic) {
    onChange(value.includes(topic) ? value.filter((item) => item !== topic) : [...value, topic]);
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{t("settings.notifyEvents")}</p>
        <div className="flex gap-1">
          <Button type="button" size="sm" variant="outline" onClick={() => onChange([...NOTIFICATION_TOPICS])}>
            {t("settings.selectAll")}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => onChange([])}>
            {t("settings.selectNone")}
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{t("settings.eventsHint")}</p>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {NOTIFICATION_TOPICS.map((topic) => (
          <label key={topic} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={value.includes(topic)} onChange={() => toggle(topic)} />
            {t(topicKey(topic))}
          </label>
        ))}
      </div>
    </div>
  );
}

export function NotificationsSection() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api<{ channels: Channel[] }>("/api/notifications"),
  });
  const [form, setForm] = useState({ name: "Discord", url: "", events: [...NOTIFICATION_TOPICS] });
  const create = useMutation({
    mutationFn: () =>
      api("/api/notifications", {
        method: "POST",
        body: JSON.stringify({
          type: "discord",
          name: form.name,
          events: form.events,
          config: { url: form.url, events: form.events },
        }),
      }),
    onSuccess: () => {
      toast.success(t("settings.channelSaved"));
      setForm({ name: "Discord", url: "", events: [...NOTIFICATION_TOPICS] });
      void qc.invalidateQueries({ queryKey: ["notifications"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.channels")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {(data?.channels ?? []).map((channel) => (
            <ChannelEditor key={channel.id} channel={channel} />
          ))}
          {(data?.channels ?? []).length === 0 ? <p className="text-muted-foreground">{t("settings.noChannels")}</p> : null}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.addWebhook")}</CardTitle>
        </CardHeader>
        <CardContent className="grid max-w-xl gap-3">
          <div className="space-y-1">
            <Label>{t("create.name")}</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label>{t("settings.webhookUrl")}</Label>
            <Input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
          </div>
          <EventChecks value={form.events} onChange={(events) => setForm({ ...form, events })} />
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => create.mutate()} disabled={create.isPending || !form.url}>
              {t("settings.saveChannel")}
            </Button>
            <TestUrlButton url={form.url} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ChannelEditor({ channel }: { channel: Channel }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [events, setEvents] = useState<NotificationTopic[]>(channel.events ?? [...NOTIFICATION_TOPICS]);
  const [enabled, setEnabled] = useState(channel.enabled);

  async function save(next?: { events?: NotificationTopic[]; enabled?: boolean }) {
    const payload = {
      events: next?.events ?? events,
      enabled: next?.enabled ?? enabled,
    };
    await api(`/api/notifications/${channel.id}`, { method: "PATCH", body: JSON.stringify(payload) });
    toast.success(t("settings.channelUpdated"));
    void qc.invalidateQueries({ queryKey: ["notifications"] });
  }

  return (
    <div className="space-y-3 rounded-[4px] border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">
          {channel.name} · {channel.type}
        </p>
        <div className="flex flex-wrap gap-2">
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => {
                const next = e.target.checked;
                setEnabled(next);
                void save({ enabled: next }).catch((err: unknown) => {
                  setEnabled(!next);
                  toast.error(err instanceof Error ? err.message : t("common.failed"));
                });
              }}
            />
            {enabled ? t("settings.enabled") : t("settings.disabled")}
          </label>
          <ConfirmAction
            title={t("settings.deleteChannel")}
            description={t("settings.deleteChannelBody", { name: channel.name })}
            actionLabel={t("settings.deleteChannel")}
            destructive
            onConfirm={async () => {
              await api(`/api/notifications/${channel.id}`, { method: "DELETE" });
              toast.success(t("settings.channelDeleted"));
              void qc.invalidateQueries({ queryKey: ["notifications"] });
            }}
          >
            <Button size="sm" variant="destructive">
              {t("settings.deleteChannel")}
            </Button>
          </ConfirmAction>
        </div>
      </div>
      <EventChecks
        value={events}
        onChange={setEvents}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={() =>
            void save().catch((err: unknown) => {
              toast.error(err instanceof Error ? err.message : t("common.failed"));
            })
          }
        >
          {t("common.save")}
        </Button>
        <TestChannelButton channelId={channel.id} />
      </div>
    </div>
  );
}

function TestUrlButton({ url }: { url: string }) {
  const { t } = useI18n();
  const test = useMutation({
    mutationFn: () =>
      api("/api/notifications/test", {
        method: "POST",
        body: JSON.stringify({ url, type: "discord" }),
      }),
    onSuccess: () => toast.success(t("settings.testSent")),
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Button
      type="button"
      variant="outline"
      disabled={test.isPending || url.trim().length < 12}
      onClick={() => test.mutate()}
    >
      {test.isPending ? t("common.loading") : t("settings.testChannel")}
    </Button>
  );
}

function TestChannelButton({ channelId }: { channelId: string }) {
  const { t } = useI18n();
  const test = useMutation({
    mutationFn: () => api(`/api/notifications/${channelId}/test`, { method: "POST" }),
    onSuccess: () => toast.success(t("settings.testSent")),
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Button type="button" size="sm" variant="outline" disabled={test.isPending} onClick={() => test.mutate()}>
      {test.isPending ? t("common.loading") : t("settings.testChannel")}
    </Button>
  );
}
