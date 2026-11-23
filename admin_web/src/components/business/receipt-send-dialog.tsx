import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { httpsCallable } from "firebase/functions";
import { collection, getDocs, query, where } from "firebase/firestore";
import { ExternalLink, Mail, MessageCircle, MessageSquare, QrCode, Receipt, X } from "lucide-react";

import { db, functions } from "@/lib/firebase";
import { cardQr } from "@/lib/business-card";
import { currentLanguage, text } from "@/lib/format";
import { overlayDismiss } from "@/lib/overlay-dismiss";
import {
  RECEIPT_LINK_ERROR,
  looksLikeEmail,
  receiptEmailSubject,
  receiptErrorText,
  receiptMailtoHref,
  receiptMessageBody,
  receiptPhoneTarget,
  receiptSendState,
  receiptSmsHref,
} from "@/lib/package-receipt";

type ReceiptLinkResult = {
  success?: boolean;
  link: string;
  filename?: string;
  expiresAtMs?: number;
  smsReady?: boolean;
  sender?: { name?: string; phone?: string; email?: string };
};

type Method = "whatsapp" | "sms" | "email" | "qr";

async function callLine<T>(data: Record<string, unknown>): Promise<T> {
  const response = await httpsCallable<Record<string, unknown>, T>(functions, "updateContainerLine", { timeout: 30_000 })(data);
  return response.data;
}

/**
 * "Send receipt" on a package: WhatsApp first, then a text, an email, the QR
 * or the PDF itself. The receipt goes to the sender only.
 */
export function ReceiptSendDialog({ businessId, lineId, onClose }: { businessId: string; lineId: string; onClose: () => void }) {
  const [method, setMethod] = useState<Method>("whatsapp");
  const [link, setLink] = useState<ReceiptLinkResult | null>(null);
  const [linkBusy, setLinkBusy] = useState(true);
  const [linkError, setLinkError] = useState("");
  const [sendBusy, setSendBusy] = useState(false);
  const [sendError, setSendError] = useState("");
  const [sendDone, setSendDone] = useState("");
  const [rows, setRows] = useState<unknown[]>([]);
  const [email, setEmail] = useState("");
  const lang = currentLanguage() === "fr" ? "fr" : "en";

  const loadRows = useCallback(async () => {
    try {
      const snap = await getDocs(query(collection(db, "containerUpdates"), where("businessId", "==", businessId), where("lineId", "==", lineId)));
      setRows(snap.docs.map((doc) => doc.data()));
    } catch {
      setRows([]);
    }
  }, [businessId, lineId]);

  useEffect(() => {
    let live = true;
    // Always resolves: the call has its own timeout and the finally clears the spinner.
    callLine<ReceiptLinkResult>({ action: "receipt_link", businessId, lineId })
      .then((result) => { if (live) setLink(result); })
      .catch((error) => { if (live) setLinkError(receiptErrorText(error, RECEIPT_LINK_ERROR)); })
      .finally(() => { if (live) setLinkBusy(false); });
    void loadRows();
    return () => { live = false; };
  }, [businessId, lineId, loadRows]);

  const sender = link?.sender ?? {};
  const senderPhone = text(sender.phone, "");
  const knownEmail = text(sender.email, "");
  const emailTo = knownEmail || email.trim();
  const url = link?.link ?? "";
  const body = useMemo(() => receiptMessageBody(url, text(sender.name, ""), ""), [url, sender.name]);
  const state = receiptSendState(rows, lang);
  const qr = useMemo(() => (url ? cardQr(url) : null), [url]);

  async function send(channel: "whatsapp" | "sms") {
    if (sendBusy) return;
    setSendBusy(true);
    setSendError("");
    setSendDone("");
    try {
      await callLine({ action: "receipt_send", businessId, lineId, channel });
      setSendDone(channel === "sms" ? "Text sent." : "Receipt sent on WhatsApp.");
      void loadRows();
    } catch (error) {
      setSendError(receiptErrorText(error));
      void loadRows();
    } finally {
      setSendBusy(false);
    }
  }

  const methods: Array<{ id: Method; label: string; icon: ReactNode }> = [
    { id: "whatsapp", label: "WhatsApp", icon: <MessageCircle size={15} aria-hidden="true" /> },
    { id: "sms", label: "Text message", icon: <MessageSquare size={15} aria-hidden="true" /> },
    { id: "email", label: "Email", icon: <Mail size={15} aria-hidden="true" /> },
    { id: "qr", label: "Show QR", icon: <QrCode size={15} aria-hidden="true" /> },
  ];
  const noPhone = !senderPhone;

  return (
    <div className="lst-modal-overlay" role="dialog" aria-modal="true" aria-label="Send receipt" {...overlayDismiss(onClose)}>
      <div className="lst-modal" onClick={(event) => event.stopPropagation()} style={{ maxWidth: 520 }}>
        <header className="lst-modal-head">
          <div>
            <h3>Send receipt</h3>
            <p>The receipt goes to the sender{text(sender.name, "") ? <>: <span data-no-translate>{text(sender.name, "")}</span></> : ""}.</p>
          </div>
          <button aria-label="Close" className="lst-icon-btn" onClick={onClose} type="button"><X size={18} /></button>
        </header>
        <div className="lst-modal-body rcp-body">
          {state.kind !== "none" && (
            <p className={`rcp-state ${state.kind === "sent" ? "ok" : state.kind === "waiting" ? "wait" : "bad"}`} role="status" data-no-translate>{state.text}</p>
          )}
          <div className="rcp-methods" role="tablist" aria-label="How to send">
            {methods.map((item) => (
              <button
                aria-selected={method === item.id}
                className={`rcp-method${method === item.id ? " on" : ""}`}
                key={item.id}
                onClick={() => { setMethod(item.id); setSendError(""); setSendDone(""); }}
                role="tab"
                type="button"
              >{item.icon} <span>{item.label}</span></button>
            ))}
          </div>

          {method === "whatsapp" && (
            <section className="rcp-pane">
              {noPhone && !linkBusy
                ? <p className="lst-hint">This package has no sender phone number. Add one, or use Email or Show QR.</p>
                : <p className="lst-hint">Sends the receipt PDF to the sender on WhatsApp{senderPhone ? <>: <span data-no-translate>{senderPhone}</span></> : ""}.</p>}
              <button className="lst-add" data-loading={sendBusy} disabled={sendBusy || linkBusy || noPhone} onClick={() => void send("whatsapp")} type="button">
                <Receipt size={15} aria-hidden="true" /> {sendBusy ? "Sending…" : state.kind === "sent" && state.channel === "whatsapp" ? "Send again on WhatsApp" : "Send on WhatsApp"}
              </button>
            </section>
          )}

          {method === "sms" && (
            <section className="rcp-pane">
              {linkBusy && <p className="lst-hint">Getting the receipt link…</p>}
              {link?.smsReady ? (
                <>
                  <p className="lst-hint">Laawol sends the text with the receipt link.</p>
                  <button className="lst-add" data-loading={sendBusy} disabled={sendBusy || noPhone} onClick={() => void send("sms")} type="button">
                    {sendBusy ? "Sending…" : "Send text message"}
                  </button>
                </>
              ) : link ? (
                <>
                  <p className="lst-hint">Opens your Messages app with the text and the receipt link filled in.</p>
                  {receiptPhoneTarget(senderPhone)
                    ? <a className="lst-add" href={receiptSmsHref(senderPhone, body)}>Text from this phone</a>
                    : <p className="lst-hint">This package has no sender phone number. Add one, or use Email or Show QR.</p>}
                </>
              ) : null}
            </section>
          )}

          {method === "email" && (
            <section className="rcp-pane">
              {knownEmail ? (
                <p className="lst-hint">Opens your mail app with a message to <span data-no-translate>{knownEmail}</span> and the receipt link.</p>
              ) : (
                <label className="rcp-field">
                  <span>Sender email</span>
                  <input autoComplete="off" inputMode="email" onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" type="email" value={email} />
                </label>
              )}
              {link && looksLikeEmail(emailTo)
                ? <a className="lst-add" href={receiptMailtoHref(emailTo, receiptEmailSubject(""), body)}>Write the email</a>
                : <button className="lst-add" disabled type="button">Write the email</button>}
            </section>
          )}

          {method === "qr" && (
            <section className="rcp-pane rcp-qr">
              {qr ? (
                <>
                  <svg aria-label="QR code of the receipt link" className="rcp-qr-img" role="img" viewBox={`-2 -2 ${qr.size + 4} ${qr.size + 4}`}>
                    <rect fill="#fff" height={qr.size + 4} width={qr.size + 4} x="-2" y="-2" />
                    <path d={qr.path} fill="#000" />
                  </svg>
                  <p className="lst-hint">The customer scans this with the phone camera to open the receipt.</p>
                </>
              ) : <p className="lst-hint">{linkBusy ? "Getting the receipt link…" : ""}</p>}
            </section>
          )}

          {url && (
            <div className="rcp-link">
              <label>
                <span>Receipt link</span>
                <input onFocus={(event) => event.currentTarget.select()} readOnly value={url} />
              </label>
              <a className="lst-btn ghost" href={url} rel="noopener noreferrer" target="_blank"><ExternalLink size={14} aria-hidden="true" /> Open / Print</a>
            </div>
          )}
          {linkBusy && method !== "sms" && method !== "qr" && <p className="lst-hint">Getting the receipt link…</p>}
          {linkError && <div className="lst-form-error" role="alert">{linkError}</div>}
          {sendError && <div className="lst-form-error" role="alert">{sendError}</div>}
          {sendDone && <p className="rcp-state ok" role="status">{sendDone}</p>}
        </div>
        <footer className="lst-modal-foot">
          <button className="lst-btn ghost" onClick={onClose} type="button">Close</button>
        </footer>
      </div>
    </div>
  );
}

/** The "Send receipt" button that opens the dialog. */
export function SendReceiptButton({ businessId, lineId }: { businessId: string; lineId: string }) {
  const [open, setOpen] = useState(false);
  if (!businessId || !lineId) return null;
  return (
    <>
      <button className="ctn-receipt-button" onClick={() => setOpen(true)} type="button">
        <Receipt size={11} aria-hidden="true" /> <span>Send receipt</span>
      </button>
      {open && <ReceiptSendDialog businessId={businessId} lineId={lineId} onClose={() => setOpen(false)} />}
    </>
  );
}
