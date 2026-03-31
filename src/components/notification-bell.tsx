"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { WorkspaceNotification } from "@/lib/data";

type NotificationBellProps = {
  initialNotifications: WorkspaceNotification[];
};

type NotificationEventDetail = {
  notifications: WorkspaceNotification[];
};

function formatNotificationTime(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Just now";
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    day: "numeric"
  }).format(parsed);
}

function NotificationGlyph({ changeType }: { changeType: WorkspaceNotification["changeType"] }) {
  if (changeType === "removed") {
    return <span className="workspace-notification-glyph remove">×</span>;
  }

  if (changeType === "updated") {
    return <span className="workspace-notification-glyph update">↺</span>;
  }

  return <span className="workspace-notification-glyph add">✓</span>;
}

export function NotificationBell({ initialNotifications }: NotificationBellProps) {
  const [notifications, setNotifications] = useState(initialNotifications);
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const notificationCount = notifications.length;
  const buttonLabel = useMemo(() => {
    if (!notificationCount) {
      return "Open notifications";
    }

    return `Open notifications (${notificationCount})`;
  }, [notificationCount]);

  useEffect(() => {
    function handleOutsideClick(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleOutsideClick);
    window.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      window.removeEventListener("keydown", handleEscape);
    };
  }, []);

  useEffect(() => {
    function handleNotificationEvent(event: Event) {
      const detail = (event as CustomEvent<NotificationEventDetail>).detail;
      if (!detail?.notifications?.length) {
        return;
      }

      setNotifications((current) => {
        const merged = [...detail.notifications, ...current];
        const seen = new Set<string>();
        return merged.filter((notification) => {
          if (seen.has(notification.id)) {
            return false;
          }

          seen.add(notification.id);
          return true;
        }).slice(0, 30);
      });
    }

    window.addEventListener("trader:notifications:add", handleNotificationEvent as EventListener);
    return () => {
      window.removeEventListener(
        "trader:notifications:add",
        handleNotificationEvent as EventListener
      );
    };
  }, []);

  return (
    <div className="workspace-notification-wrap" ref={rootRef}>
      <button
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-label={buttonLabel}
        className={`workspace-icon-button workspace-notification-button ${
          isOpen ? "active" : ""
        }`}
        onClick={() => setIsOpen((current) => !current)}
        type="button"
      >
        <svg aria-hidden="true" className="workspace-notification-icon" viewBox="0 0 24 24">
          <path d="M12 4.5a4 4 0 0 1 4 4v1.3c0 .9.3 1.8.8 2.5l1.1 1.4c.5.6.1 1.5-.7 1.5H6.8c-.8 0-1.2-.9-.7-1.5l1.1-1.4c.5-.7.8-1.6.8-2.5V8.5a4 4 0 0 1 4-4Z" />
          <path d="M10 18a2 2 0 0 0 4 0" />
        </svg>
        {notificationCount ? (
          <span className="workspace-notification-count">
            {notificationCount > 9 ? "9+" : notificationCount}
          </span>
        ) : null}
      </button>

      <div className={`workspace-notification-popover ${isOpen ? "open" : ""}`}>
        <div className="workspace-notification-header">
          <div>
            <p className="workspace-notification-kicker">Desk notifications</p>
            <h3>Desk updates</h3>
          </div>
          {notificationCount ? (
            <span className="workspace-notification-total">{notificationCount}</span>
          ) : null}
        </div>

        <div className="workspace-notification-list">
          {notifications.length ? (
            notifications.map((notification) => (
              <article className="workspace-notification-item" key={notification.id}>
                <div className="workspace-notification-item-top">
                  <NotificationGlyph changeType={notification.changeType} />
                  <div className="workspace-notification-copy">
                    <h4>{notification.title}</h4>
                    {notification.detail ? <p>{notification.detail}</p> : null}
                  </div>
                </div>
                <span className="workspace-notification-time">
                  {formatNotificationTime(notification.createdAt)}
                </span>
              </article>
            ))
          ) : (
            <div className="workspace-notification-empty">
              trAIder will log profile saves and P&amp;L calendar updates here as they happen.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
