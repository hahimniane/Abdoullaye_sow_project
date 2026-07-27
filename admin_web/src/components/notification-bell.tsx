"use client";

import { useEffect, useRef, useState } from "react";
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
} from "firebase/firestore";
import { Bell } from "lucide-react";

import { db } from "@/lib/firebase";
import { formatDate, text } from "@/lib/format";

type NotificationItem = {
  id: string;
  title: string;
  body: string;
  data: Record<string, string>;
  read: boolean;
  createdAt: unknown;
};

type NotificationBellProps = {
  uid: string;
  enabled: boolean;
  onSelect?: (data: Record<string, string>) => void;
};

export function NotificationBell({ uid, enabled, onSelect }: NotificationBellProps) {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!enabled || !uid) {
      setItems([]);
      return undefined;
    }
    const request = query(
      collection(db, "users", uid, "notifications"),
      orderBy("createdAt", "desc"),
      limit(30),
    );
    return onSnapshot(request, (snapshot) => {
      setItems(
        snapshot.docs.map((item) => ({
          id: item.id,
          ...(item.data() as Omit<NotificationItem, "id">),
        })),
      );
    });
  }, [enabled, uid]);

  useEffect(() => {
    if (!open) return undefined;
    function handlePointer(event: MouseEvent) {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const unreadCount = items.filter((item) => !item.read).length;

  function markRead(item: NotificationItem) {
    if (item.read) return;
    void updateDoc(doc(db, "users", uid, "notifications", item.id), {
      read: true,
      readAt: new Date(),
    });
  }

  function handleItemClick(item: NotificationItem) {
    markRead(item);
    setOpen(false);
    onSelect?.(item.data ?? {});
  }

  function markAllRead() {
    items
      .filter((item) => !item.read)
      .forEach((item) => markRead(item));
  }

  return (
    <div className="notification-bell" ref={wrapperRef}>
      <button
        aria-label="Notifications"
        className="icon-button"
        onClick={() => setOpen((value) => !value)}
        title="Notifications"
        type="button"
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className="notification-badge">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>
      {open && (
        <div className="notification-dropdown" role="menu">
          <div className="notification-dropdown-header">
            <span>Notifications</span>
            {unreadCount > 0 && (
              <button
                className="link-button"
                onClick={markAllRead}
                type="button"
              >
                Mark all read
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <div className="notification-empty">No notifications yet</div>
          ) : (
            <ul className="notification-list">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    className="notification-item"
                    data-unread={!item.read}
                    onClick={() => handleItemClick(item)}
                    type="button"
                  >
                    <span className="notification-item-title">
                      {text(item.title, "Notification")}
                    </span>
                    <span className="notification-item-body">{item.body}</span>
                    <span className="notification-item-time">
                      {formatDate(item.createdAt)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
